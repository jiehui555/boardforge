import {
  LIMITS,
  MAX_HOLES,
  PRESETS,
  analyseHoles,
  formatNumber,
  isPlainObject,
  maxCornerRadius,
  round,
} from './schema.js';
import {
  CASE_LIMITS,
  MAX_OPENINGS,
  OPENING_SHAPES,
  OPENING_SIDES,
  SIDE_LABELS,
  caseFileStem,
  createCaseFromPreset,
  createDefaultCaseState,
  createOpening,
  deriveCaseDimensions,
  normalizeCaseState,
  toCaseDocument,
} from './case-schema.js';
import {
  buildAssemblyGeometry,
  buildCaseModel,
  disposeCaseModel,
} from './case-geometry.js';
import { BoardPreview } from './preview.js';
import { createBinaryStl } from './stl-export.js';
import { buildCutDxf, buildCutSvg } from './vector-export.js';
import {
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_MODE,
  THEME_PRESETS,
  applyTheme,
  applyThemeMode,
  clearThemeColor,
  normalizeThemeColor,
  normalizeThemeMode,
  readThemeColor,
  readThemeMode,
  saveThemeColor,
  saveThemeMode,
} from './theme.js';

const STORAGE_KEY = 'boardforge.case-autosave.v2';
const LEGACY_CASE_STORAGE_KEY = 'boardforge.case-autosave.v1';
const LEGACY_STORAGE_KEY = 'boardforge.autosave.v1';
const PROJECTION_STORAGE_KEY = 'boardforge.projection.v1';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const dom = {
  caseName: document.querySelector('#caseName'),
  presetRow: document.querySelector('#presetRow'),
  autosaveLabel: document.querySelector('#autosaveLabel'),

  panelThicknessInput: document.querySelector('#panelThicknessInput'),
  clearanceInput: document.querySelector('#clearanceInput'),
  bottomGapInput: document.querySelector('#bottomGapInput'),
  topGapInput: document.querySelector('#topGapInput'),
  screwClearanceInput: document.querySelector('#screwClearanceInput'),
  fitInput: document.querySelector('#fitInput'),
  ventEnabledInput: document.querySelector('#ventEnabledInput'),
  ventCountInput: document.querySelector('#ventCountInput'),
  ventWidthInput: document.querySelector('#ventWidthInput'),
  ventLengthInput: document.querySelector('#ventLengthInput'),
  ventFields: document.querySelector('#ventFields'),
  hardwareNote: document.querySelector('#hardwareNote'),
  outerDimensions: document.querySelector('#outerDimensions'),
  innerHeight: document.querySelector('#innerHeight'),
  enclosureNote: document.querySelector('#enclosureNote'),

  openingList: document.querySelector('#openingList'),
  openingCount: document.querySelector('#openingCount'),
  openingsHint: document.querySelector('#openingsHint'),
  addOpeningButton: document.querySelector('#addOpeningButton'),

  boardDetails: document.querySelector('#boardDetails'),
  boardSummary: document.querySelector('#boardSummary'),
  lengthInput: document.querySelector('#lengthInput'),
  widthInput: document.querySelector('#widthInput'),
  thicknessInput: document.querySelector('#thicknessInput'),
  cornerInput: document.querySelector('#cornerInput'),
  colorInput: document.querySelector('#colorInput'),
  colorSwatch: document.querySelector('#colorSwatch'),
  colorHex: document.querySelector('#colorHex'),
  holeList: document.querySelector('#holeList'),
  holeCount: document.querySelector('#holeCount'),
  holeNote: document.querySelector('#holeNote'),
  addHoleButton: document.querySelector('#addHoleButton'),

  modeButton: document.querySelector('#modeButton'),
  modeButtonLabel: document.querySelector('#modeButtonLabel'),
  themeButton: document.querySelector('#themeButton'),
  themeMenu: document.querySelector('#themeMenu'),
  themePresets: document.querySelector('#themePresets'),
  themeColorInput: document.querySelector('#themeColorInput'),
  themeColorHex: document.querySelector('#themeColorHex'),
  themeColorPreview: document.querySelector('#themeColorPreview'),
  themeCloseButton: document.querySelector('#themeCloseButton'),
  resetThemeButton: document.querySelector('#resetThemeButton'),

  newButton: document.querySelector('#newButton'),
  importButton: document.querySelector('#importButton'),
  fileInput: document.querySelector('#fileInput'),
  exportFilename: document.querySelector('#exportFilename'),
  exportStatus: document.querySelector('#exportStatus'),
  exportJsonButton: document.querySelector('#exportJsonButton'),
  exportSvgButton: document.querySelector('#exportSvgButton'),
  exportDxfButton: document.querySelector('#exportDxfButton'),
  exportStlButton: document.querySelector('#exportStlButton'),

  previewCanvas: document.querySelector('#previewCanvas'),
  previewName: document.querySelector('#previewName'),
  modelStatus: document.querySelector('#modelStatus'),
  modelStatusText: document.querySelector('#modelStatusText'),
  statSize: document.querySelector('#statSize'),
  statInner: document.querySelector('#statInner'),
  statMaterial: document.querySelector('#statMaterial'),
  statTime: document.querySelector('#statTime'),
  sceneNotices: document.querySelector('#sceneNotices'),
  canvasLoading: document.querySelector('#canvasLoading'),
  dropOverlay: document.querySelector('#dropOverlay'),
  fatalCard: document.querySelector('#fatalCard'),
  fatalMessage: document.querySelector('#fatalMessage'),
  toastRoot: document.querySelector('#toastRoot'),

  viewButtons: Array.from(document.querySelectorAll('[data-view]')),
  projectionButton: document.querySelector('#projectionButton'),
  projectionButtonLabel: document.querySelector('#projectionButtonLabel'),
  explodeButton: document.querySelector('#explodeButton'),
};

const boardInputs = Array.from(document.querySelectorAll('input[data-path]'));
const caseInputs = Array.from(document.querySelectorAll('input[data-case]'));

let state = createDefaultCaseState();
let currentThemeColor = DEFAULT_THEME_COLOR;
let currentMode = DEFAULT_THEME_MODE;
let selectedPresetId = null;
let savedStateRestored = false;
let preview = null;
let model = null;
let previewFailed = false;
let isBuilding = false;
let modelDirty = true;
let buildTimer = null;
let buildVersion = 0;
let pendingFit = true;
let saveTimer = null;
let savedLabelTimer = null;
let dragDepth = 0;
let activeView = 'iso';
let exploded = false;
let currentProjection = readProjectionMode();
const pendingInvalid = new Set();

/* ── Boot ───────────────────────────────────────────────────────────────── */

bootstrap();

function bootstrap() {
  initializeTheme();
  const restored = readStoredState();
  if (restored) {
    state = restored.state;
    savedStateRestored = true;
  }
  selectedPresetId = detectPresetId(state);

  renderPresets();
  syncFormFromState();
  syncProjectionUi();
  bindEvents();
  exposeDebugApi();

  requestAnimationFrame(() => {
    try {
      preview = new BoardPreview(dom.previewCanvas, {
        onContextLost: (message) => showFatal(message),
      });
      preview.setMode(currentMode);
      preview.setProjection(currentProjection);
      preview.setBoardColor(state.board.color);
    } catch (error) {
      showFatal(error?.message || '无法创建 WebGL 上下文。');
      setModelStatus('error', 'WebGL 不可用');
      setExportStatus('3D 预览不可用', 'error');
      return;
    }

    buildNow({ fit: true, initial: true });
    if (savedStateRestored) {
      window.setTimeout(() => {
        toast('已恢复上次外壳参数', '本地自动保存已恢复', 'success');
      }, 550);
    }
  });
}

/* ── UI theme ───────────────────────────────────────────────────────────── */

function initializeTheme() {
  renderThemePresets();
  currentMode = applyThemeMode(readThemeMode());
  applyThemeColor(readThemeColor(), { persist: false });
  syncModeUi();
}

function renderThemePresets() {
  dom.themePresets.innerHTML = THEME_PRESETS.map(
    (preset) => `
      <button class="theme-preset" type="button" data-theme-preset="${preset.id}"
        data-theme-color="${preset.color}" aria-label="${preset.label}主题"
        title="${preset.label}">
        <span class="theme-preset-dot" style="background:${preset.color}"></span>
      </button>`,
  ).join('');
}

function applyThemeColor(value, { persist = true } = {}) {
  currentThemeColor = normalizeThemeColor(value);
  const tokens = applyTheme(currentThemeColor, { mode: currentMode });
  if (persist) saveThemeColor(currentThemeColor);
  syncThemeUi(tokens);
}

function syncThemeUi(tokens) {
  dom.themeColorInput.value = currentThemeColor;
  dom.themeColorHex.textContent = currentThemeColor.toUpperCase();
  dom.themeColorPreview.style.background = tokens.accent;
  dom.themePresets.querySelectorAll('[data-theme-color]').forEach((button) => {
    const active = normalizeThemeColor(button.dataset.themeColor) === currentThemeColor;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function resetTheme() {
  const color = clearThemeColor();
  applyThemeColor(color, { persist: false });
}

function setThemeMode(value, { persist = true } = {}) {
  currentMode = normalizeThemeMode(value);
  applyThemeMode(currentMode);
  if (persist) saveThemeMode(currentMode);
  applyThemeColor(currentThemeColor, { persist: false });
  syncModeUi();
  if (preview) preview.setMode(currentMode);
}

function syncModeUi() {
  const isDark = currentMode === 'dark';
  const actionLabel = isDark ? '切换到浅色模式' : '切换到深色模式';
  dom.modeButton.setAttribute('title', actionLabel);
  dom.modeButton.setAttribute('aria-label', actionLabel);
  dom.modeButtonLabel.textContent = isDark ? '深色' : '浅色';
}

function setThemeMenuOpen(open) {
  dom.themeMenu.hidden = !open;
  dom.themeButton.setAttribute('aria-expanded', String(open));
  if (open) {
    document.addEventListener('pointerdown', handleThemeOutsidePointer, true);
    document.addEventListener('keydown', handleThemeEscape);
  } else {
    document.removeEventListener('pointerdown', handleThemeOutsidePointer, true);
    document.removeEventListener('keydown', handleThemeEscape);
  }
}

function handleThemeOutsidePointer(event) {
  if (
    dom.themeMenu.contains(event.target) ||
    dom.themeButton.contains(event.target)
  ) {
    return;
  }
  setThemeMenuOpen(false);
}

function handleThemeEscape(event) {
  if (event.key === 'Escape') {
    setThemeMenuOpen(false);
    dom.themeButton.focus();
  }
}

/* ── Form sync ──────────────────────────────────────────────────────────── */

function syncFormFromState() {
  dom.caseName.value = state.name;
  dom.lengthInput.value = inputValue(state.board.length);
  dom.widthInput.value = inputValue(state.board.width);
  dom.thicknessInput.value = inputValue(state.board.thickness);
  dom.cornerInput.value = inputValue(state.board.corner_radius);
  dom.colorInput.value = state.board.color;

  dom.panelThicknessInput.value = inputValue(state.enclosure.panel_thickness);
  dom.clearanceInput.value = inputValue(state.enclosure.clearance);
  dom.bottomGapInput.value = inputValue(state.enclosure.bottom_gap);
  dom.topGapInput.value = inputValue(state.enclosure.top_gap);
  dom.screwClearanceInput.value = inputValue(state.enclosure.screw_clearance);
  dom.fitInput.value = inputValue(state.enclosure.fit);
  dom.ventEnabledInput.checked = state.enclosure.vent.enabled;
  dom.ventCountInput.value = inputValue(state.enclosure.vent.count);
  dom.ventWidthInput.value = inputValue(state.enclosure.vent.slot_width);
  dom.ventLengthInput.value = inputValue(state.enclosure.vent.slot_length);

  updateCornerLimit({ clampValue: false });
  updateColorUi();
  updateVentUi();
  updateDerivedUi();
  updateNameUi();
  renderHoles();
  renderOpenings();
  clearAllFieldErrors();
  refreshPresetActive();
  setExportStatus('准备就绪');
}
function updateNameUi() {
  const name = state.name.trim() || '未命名开发板外壳';
  dom.previewName.textContent = name;
  updateFilenameUi();
}

function updateColorUi() {
  dom.colorSwatch.style.background = state.board.color;
  dom.colorHex.textContent = state.board.color.toUpperCase();
  dom.colorInput.value = state.board.color;
}

function updateFilenameUi() {
  const dims = deriveCaseDimensions(state);
  dom.exportFilename.textContent = caseFileStem(state, dims);
}

function updateDerivedUi() {
  const dims = deriveCaseDimensions(state);
  dom.outerDimensions.textContent =
    `${formatNumber(dims.outerWidth)} × ${formatNumber(dims.outerDepth)} × ` +
    `${formatNumber(dims.outerHeight)}`;
  dom.innerHeight.textContent = `${formatNumber(dims.innerHeight)} mm`;
  dom.enclosureNote.textContent =
    `内腔 ${formatNumber(dims.innerWidth)} × ${formatNumber(dims.innerDepth)} × ` +
    `${formatNumber(dims.innerHeight)} mm · 6 块 ${formatNumber(dims.panelThickness)} mm 亚克力`;
  dom.boardSummary.textContent =
    `${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} × ` +
    `${formatNumber(state.board.thickness)} mm · ${state.holes.length} 孔`;
  dom.holeCount.textContent = `${state.holes.length} / ${MAX_HOLES}`;
  updateHardwareNote();
  updateFilenameUi();
}

function updateHardwareNote() {
  const clearance = Number(state.enclosure.screw_clearance);
  const analysis = analyseHoles(state);
  const usable = analysis.printable;

  if (state.holes.length === 0) {
    dom.hardwareNote.textContent =
      '开发板没有安装孔，无法生成一体固定柱和顶/底面板螺丝。';
    dom.hardwareNote.classList.add('is-warning');
    return;
  }
  if (usable.length === 0) {
    dom.hardwareNote.textContent =
      '没有可用的开发板安装孔，无法生成固定柱；请修正板孔位置。';
    dom.hardwareNote.classList.add('is-warning');
    return;
  }

  const smallest = Math.min(...usable.map((hole) => hole.diameter));
  if (clearance - smallest > 0.4) {
    dom.hardwareNote.textContent =
      `板孔最小 ${formatNumber(smallest)} mm，小于 ${formatNumber(clearance)} mm ` +
      `固定柱过孔；请扩孔或将过孔改为约 ${formatNumber(smallest + 0.2)} mm。`;
    dom.hardwareNote.classList.add('is-warning');
    return;
  }

  dom.hardwareNote.textContent =
    `${usable.length} 组固定柱穿过开发板孔位，上下锁紧顶板与底板。`;
  dom.hardwareNote.classList.remove('is-warning');
}

function updateVentUi() {
  const enabled = state.enclosure.vent.enabled;
  dom.ventFields.classList.toggle('is-disabled', !enabled);
  dom.ventCountInput.disabled = !enabled;
  dom.ventWidthInput.disabled = !enabled;
  dom.ventLengthInput.disabled = !enabled;
}

function inputValue(value) {
  const numeric = round(Number(value), 3);
  return String(Object.is(numeric, -0) ? 0 : numeric);
}

function updateCornerLimit({ clampValue = true } = {}) {
  const maximum = Math.max(
    0,
    round(maxCornerRadius(Number(state.board.length), Number(state.board.width)), 2),
  );
  dom.cornerInput.max = String(maximum);
  if (clampValue && state.board.corner_radius > maximum) {
    state.board.corner_radius = maximum;
    dom.cornerInput.value = inputValue(maximum);
    pendingInvalid.delete('board.corner_radius');
    markFieldInvalid(dom.cornerInput, false);
  }
}

function markFieldInvalid(input, invalid) {
  if (!input) return;
  input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  const shell = input.closest('.input-shell') || input.closest('.hole-field');
  if (shell) shell.classList.toggle('is-invalid', invalid);
}

function clearAllFieldErrors() {
  pendingInvalid.clear();
  document.querySelectorAll('[aria-invalid="true"]').forEach((element) => {
    element.setAttribute('aria-invalid', 'false');
  });
  document.querySelectorAll('.is-invalid').forEach((element) => {
    element.classList.remove('is-invalid');
  });
}

/* ── Board input ────────────────────────────────────────────────────────── */

function boardLimitForPath(path) {
  if (path === 'board.length') return LIMITS.length;
  if (path === 'board.width') return LIMITS.width;
  if (path === 'board.thickness') return LIMITS.thickness;
  if (path === 'board.corner_radius') {
    return {
      min: 0,
      max: maxCornerRadius(Number(state.board.length), Number(state.board.width)),
      step: LIMITS.cornerRadius.step,
    };
  }
  return null;
}

function readBoardNumber(path) {
  return Number(state.board[path.split('.').pop()]);
}

function setBoardNumber(path, value) {
  state.board[path.split('.').pop()] = value;
}

function handleBoardInput(input) {
  const path = input.dataset.path;
  const limit = boardLimitForPath(path);
  if (!limit) return;
  const raw = input.value.trim();
  const value = Number(raw);
  const valid =
    raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;

  if (!valid) {
    pendingInvalid.add(path);
    markFieldInvalid(input, true);
    stateChanged({ rebuild: false });
    updateBlockedUi();
    return;
  }

  pendingInvalid.delete(path);
  markFieldInvalid(input, false);
  setBoardNumber(path, value);
  if (path === 'board.length' || path === 'board.width') {
    updateCornerLimit({ clampValue: true });
  }
  selectedPresetId = detectPresetId(state);
  refreshPresetActive();
  updateDerivedUi();
  stateChanged();
}

function normalizeBoardInput(input) {
  const path = input.dataset.path;
  const limit = boardLimitForPath(path);
  if (!limit) return;
  const raw = input.value.trim();
  let value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) value = readBoardNumber(path);
  value = round(Math.min(limit.max, Math.max(limit.min, value)), 3);

  input.value = inputValue(value);
  pendingInvalid.delete(path);
  markFieldInvalid(input, false);
  setBoardNumber(path, value);
  if (path === 'board.length' || path === 'board.width') {
    updateCornerLimit({ clampValue: true });
  }
  selectedPresetId = detectPresetId(state);
  refreshPresetActive();
  updateDerivedUi();
  stateChanged();
}

/* ── Enclosure input ────────────────────────────────────────────────────── */

function caseLimitForPath(path) {
  if (path === 'panel_thickness') return CASE_LIMITS.panelThickness;
  if (path === 'clearance') return CASE_LIMITS.clearance;
  if (path === 'bottom_gap') return CASE_LIMITS.bottomGap;
  if (path === 'top_gap') return CASE_LIMITS.topGap;
  if (path === 'screw_clearance') return CASE_LIMITS.screwClearance;
  if (path === 'fit') return CASE_LIMITS.fit;
  if (path === 'vent.count') return CASE_LIMITS.ventCount;
  if (path === 'vent.slot_width') return CASE_LIMITS.ventWidth;
  if (path === 'vent.slot_length') return CASE_LIMITS.ventLength;
  return null;
}

function readCaseNumber(path) {
  if (path.startsWith('vent.')) {
    return Number(state.enclosure.vent[path.split('.')[1]]);
  }
  return Number(state.enclosure[path]);
}

function setCaseNumber(path, value) {
  if (path.startsWith('vent.')) {
    state.enclosure.vent[path.split('.')[1]] = value;
  } else {
    state.enclosure[path] = value;
  }
}

function handleCaseInput(input) {
  const path = input.dataset.case;
  const limit = caseLimitForPath(path);
  if (!limit) return;
  const raw = input.value.trim();
  const value = Number(raw);
  const valid =
    raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;

  if (!valid) {
    pendingInvalid.add(`case.${path}`);
    markFieldInvalid(input, true);
    stateChanged({ rebuild: false });
    updateBlockedUi();
    return;
  }

  pendingInvalid.delete(`case.${path}`);
  markFieldInvalid(input, false);
  setCaseNumber(path, value);
  updateDerivedUi();
  stateChanged();
}

function normalizeCaseInput(input) {
  const path = input.dataset.case;
  const limit = caseLimitForPath(path);
  if (!limit) return;
  const raw = input.value.trim();
  let value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) value = readCaseNumber(path);
  value = Math.min(limit.max, Math.max(limit.min, value));
  if (path === 'vent.count') value = Math.round(value);
  else value = round(value, 3);

  input.value = inputValue(value);
  pendingInvalid.delete(`case.${path}`);
  markFieldInvalid(input, false);
  setCaseNumber(path, value);
  updateDerivedUi();
  stateChanged();
}

/* ── Board holes ────────────────────────────────────────────────────────── */

function renderHoles() {
  if (state.holes.length === 0) {
    dom.holeList.innerHTML = `
      <div class="hole-empty">
        <strong>还没有安装孔</strong>
        <span>留空时不会生成板子固定柱</span>
      </div>`;
  } else {
    dom.holeList.innerHTML = state.holes
      .map(
        (hole, index) => `
        <div class="hole-row" data-index="${index}">
          <span class="hole-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <label class="hole-field">
            <span>X</span>
            <input type="number" data-hole="x" step="0.1" inputmode="decimal"
              value="${inputValue(hole.x)}" aria-label="第 ${index + 1} 个孔的 X 坐标，单位毫米" />
          </label>
          <label class="hole-field">
            <span>Y</span>
            <input type="number" data-hole="y" step="0.1" inputmode="decimal"
              value="${inputValue(hole.y)}" aria-label="第 ${index + 1} 个孔的 Y 坐标，单位毫米" />
          </label>
          <label class="hole-field">
            <span>⌀</span>
            <input type="number" data-hole="diameter" min="0.1" max="100" step="0.1" inputmode="decimal"
              value="${inputValue(hole.diameter)}" aria-label="第 ${index + 1} 个孔的直径，单位毫米" />
          </label>
          <button class="hole-delete" type="button" data-delete-hole="${index}"
            aria-label="删除第 ${index + 1} 个安装孔" title="删除安装孔">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 3.5h4M6 6l.5 10h7L14 6M8.5 9v4.5M11.5 9v4.5"/></svg>
          </button>
        </div>`,
      )
      .join('');
  }

  dom.holeCount.textContent = `${state.holes.length} / ${MAX_HOLES}`;
  dom.addHoleButton.disabled = state.holes.length >= MAX_HOLES;
  refreshHoleWarnings();
}

function holeLimit(field) {
  if (field === 'x') return LIMITS.holeX;
  if (field === 'y') return LIMITS.holeY;
  return LIMITS.holeDiameter;
}

function handleHoleInput(input) {
  const row = input.closest('.hole-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  const field = input.dataset.hole;
  const hole = state.holes[index];
  if (!hole || !['x', 'y', 'diameter'].includes(field)) return;

  const limit = holeLimit(field);
  const raw = input.value.trim();
  const value = Number(raw);
  const valid =
    raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;
  const path = `holes.${index}.${field}`;

  if (!valid) {
    pendingInvalid.add(path);
    markFieldInvalid(input, true);
    stateChanged({ rebuild: false });
    updateBlockedUi();
    return;
  }

  pendingInvalid.delete(path);
  markFieldInvalid(input, false);
  hole[field] = value;
  selectedPresetId = detectPresetId(state);
  refreshPresetActive();
  refreshHoleWarnings();
  updateDerivedUi();
  stateChanged();
}

function normalizeHoleInput(input) {
  const row = input.closest('.hole-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  const field = input.dataset.hole;
  const hole = state.holes[index];
  if (!hole) return;

  const limit = holeLimit(field);
  const raw = input.value.trim();
  let value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) value = Number(hole[field]);
  value = round(Math.min(limit.max, Math.max(limit.min, value)), 3);

  input.value = inputValue(value);
  hole[field] = value;
  pendingInvalid.delete(`holes.${index}.${field}`);
  markFieldInvalid(input, false);
  selectedPresetId = detectPresetId(state);
  refreshPresetActive();
  refreshHoleWarnings();
  updateDerivedUi();
  stateChanged();
}

function clearPendingHoleFields() {
  for (const path of [...pendingInvalid]) {
    if (path.startsWith('holes.')) pendingInvalid.delete(path);
  }
}

function addHole() {
  if (state.holes.length >= MAX_HOLES) return;
  state.holes.push({ x: 0, y: 0, diameter: 2.7 });
  selectedPresetId = null;
  clearPendingHoleFields();
  renderHoles();
  refreshPresetActive();
  updateDerivedUi();
  stateChanged();
  requestAnimationFrame(() => {
    const lastRow = dom.holeList.querySelector('.hole-row:last-of-type');
    lastRow?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    lastRow?.querySelector('input[data-hole="x"]')?.focus();
  });
}

function deleteHole(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.holes.length) return;
  state.holes.splice(index, 1);
  selectedPresetId = null;
  clearPendingHoleFields();
  renderHoles();
  refreshPresetActive();
  updateDerivedUi();
  stateChanged();
}

function refreshHoleWarnings() {
  const analysis = analyseHoles(state);
  const outside = new Set(analysis.outside.map((item) => item.index));
  dom.holeList.querySelectorAll('.hole-row').forEach((row) => {
    const index = Number(row.dataset.index);
    row.classList.toggle('has-warning', outside.has(index));
    row.title = outside.has(index)
      ? '这个孔超出板边，无法用于固定柱。'
      : '';
  });
  const notes = [];
  if (outside.size > 0) {
    notes.push(`${outside.size} 个板孔超出板边，未生成固定柱。`);
  }
  if (state.holes.length === 0) {
    notes.push('开发板没有安装孔，外壳不包含板子固定柱。');
  }
  dom.holeNote.textContent = notes.join(' ') || '板孔用于生成底部固定柱和底板过孔。';
  dom.holeNote.classList.toggle('is-warning', notes.length > 0);
}

/* ── Side-panel openings ────────────────────────────────────────────────── */

function renderOpenings() {
  if (state.openings.length === 0) {
    dom.openingList.innerHTML = `
      <div class="opening-empty">
        <strong>还没有接口开孔</strong>
        <span>可以添加 USB、HDMI、Type-C 等侧板开口</span>
      </div>`;
  } else {
    dom.openingList.innerHTML = state.openings
      .map((opening, index) => {
        const isCircle = opening.shape === 'circle';
        const sizeFields = isCircle
          ? `<label class="hole-field"><span>⌀</span><input type="number" data-opening-field="diameter" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.diameter)}" aria-label="第 ${index + 1} 个开孔的直径" /></label>`
          : `<label class="hole-field"><span>宽</span><input type="number" data-opening-field="width" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.width)}" aria-label="第 ${index + 1} 个开孔的宽度" /></label>
             <label class="hole-field"><span>高</span><input type="number" data-opening-field="height" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.height)}" aria-label="第 ${index + 1} 个开孔的高度" /></label>`;
        return `
          <div class="opening-card" data-opening-index="${index}">
            <div class="opening-head">
              <span class="hole-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
              <select class="opening-select" data-opening-field="side" aria-label="第 ${index + 1} 个开孔所在面板">
                ${OPENING_SIDES.map(
                  (side) =>
                    `<option value="${side}" ${opening.side === side ? 'selected' : ''}>${SIDE_LABELS[side]}</option>`,
                ).join('')}
              </select>
              <select class="opening-select" data-opening-field="shape" aria-label="第 ${index + 1} 个开孔形状">
                ${OPENING_SHAPES.map(
                  (shape) =>
                    `<option value="${shape}" ${opening.shape === shape ? 'selected' : ''}>${shape === 'circle' ? '圆形' : '矩形'}</option>`,
                ).join('')}
              </select>
              <button class="hole-delete" type="button" data-delete-opening="${index}" aria-label="删除第 ${index + 1} 个开孔" title="删除开孔">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 3.5h4M6 6l.5 10h7L14 6M8.5 9v4.5M11.5 9v4.5"/></svg>
              </button>
            </div>
            <div class="opening-fields">
              <label class="hole-field"><span>U</span><input type="number" data-opening-field="u" min="-300" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.u)}" aria-label="第 ${index + 1} 个开孔的水平位置" /></label>
              <label class="hole-field"><span>V</span><input type="number" data-opening-field="v" min="-200" max="200" step="0.5" inputmode="decimal" value="${inputValue(opening.v)}" aria-label="第 ${index + 1} 个开孔的垂直位置" /></label>
              ${sizeFields}
            </div>
          </div>`;
      })
      .join('');
  }
  dom.openingCount.textContent = `${state.openings.length} / ${MAX_OPENINGS}`;
  dom.addOpeningButton.disabled = state.openings.length >= MAX_OPENINGS;
}

function clearPendingOpeningFields() {
  for (const path of [...pendingInvalid]) {
    if (path.startsWith('openings.')) pendingInvalid.delete(path);
  }
}

function addOpening() {
  if (state.openings.length >= MAX_OPENINGS) return;
  state.openings.push(createOpening('front', 'rect'));
  clearPendingOpeningFields();
  renderOpenings();
  stateChanged();
  requestAnimationFrame(() => {
    const lastCard = dom.openingList.querySelector('.opening-card:last-of-type');
    lastCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    lastCard?.querySelector('input[data-opening-field="u"]')?.focus();
  });
}

function deleteOpening(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.openings.length) return;
  state.openings.splice(index, 1);
  clearPendingOpeningFields();
  renderOpenings();
  stateChanged();
}

function handleOpeningInput(input) {
  const card = input.closest('.opening-card');
  if (!card) return;
  const index = Number(card.dataset.openingIndex);
  const opening = state.openings[index];
  const field = input.dataset.openingField;
  if (!opening || !field) return;

  const limit = field === 'u'
    ? CASE_LIMITS.openingU
    : field === 'v'
      ? CASE_LIMITS.openingV
      : CASE_LIMITS.openingSize;
  const raw = input.value.trim();
  const value = Number(raw);
  const valid =
    raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;
  const path = `openings.${index}.${field}`;

  if (!valid) {
    pendingInvalid.add(path);
    markFieldInvalid(input, true);
    stateChanged({ rebuild: false });
    updateBlockedUi();
    return;
  }

  pendingInvalid.delete(path);
  markFieldInvalid(input, false);
  opening[field] = value;
  stateChanged();
}

function normalizeOpeningInput(input) {
  const card = input.closest('.opening-card');
  if (!card) return;
  const index = Number(card.dataset.openingIndex);
  const opening = state.openings[index];
  const field = input.dataset.openingField;
  if (!opening || !field) return;

  const limit = field === 'u'
    ? CASE_LIMITS.openingU
    : field === 'v'
      ? CASE_LIMITS.openingV
      : CASE_LIMITS.openingSize;
  const raw = input.value.trim();
  let value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) value = Number(opening[field]);
  value = round(Math.min(limit.max, Math.max(limit.min, value)), 3);
  input.value = inputValue(value);
  opening[field] = value;
  pendingInvalid.delete(`openings.${index}.${field}`);
  markFieldInvalid(input, false);
  stateChanged();
}

function handleOpeningSelect(select) {
  const card = select.closest('.opening-card');
  if (!card) return;
  const index = Number(card.dataset.openingIndex);
  const opening = state.openings[index];
  const field = select.dataset.openingField;
  if (!opening || !field) return;

  if (field === 'side') {
    opening.side = select.value;
    stateChanged();
  } else if (field === 'shape') {
    const next = createOpening(opening.side, select.value);
    next.u = opening.u;
    next.v = opening.v;
    state.openings[index] = next;
    clearPendingOpeningFields();
    renderOpenings();
    stateChanged();
  }
}

/* ── Presets ────────────────────────────────────────────────────────────── */

function renderPresets() {
  dom.presetRow.innerHTML = PRESETS.map(
    (preset) => `
      <button type="button" class="preset-chip" data-preset-id="${preset.id}"
        title="载入 ${preset.label} 尺寸">
        <strong>${preset.label}</strong>
        <span>${preset.detail}</span>
      </button>`,
  ).join('');
}

function refreshPresetActive() {
  dom.presetRow.querySelectorAll('[data-preset-id]').forEach((button) => {
    button.classList.toggle('active', button.dataset.presetId === selectedPresetId);
  });
}

function detectPresetId(candidate) {
  for (const preset of PRESETS) {
    const board = preset.board;
    if (
      round(candidate.board.length, 2) === round(board.length, 2) &&
      round(candidate.board.width, 2) === round(board.width, 2) &&
      round(candidate.board.thickness, 2) === round(board.thickness, 2) &&
      round(candidate.board.corner_radius, 2) === round(board.corner_radius, 2) &&
      candidate.holes.length === preset.holes.length &&
      candidate.holes.every(
        (hole, index) =>
          round(hole.x, 2) === round(preset.holes[index].x, 2) &&
          round(hole.y, 2) === round(preset.holes[index].y, 2) &&
          round(hole.diameter, 2) === round(preset.holes[index].diameter, 2),
      )
    ) {
      return preset.id;
    }
  }
  return null;
}

function loadPreset(id) {
  const preset = PRESETS.find((entry) => entry.id === id);
  if (!preset) return;
  pendingInvalid.clear();
  state = createCaseFromPreset(preset);
  selectedPresetId = preset.id;
  syncFormFromState();
  selectedPresetId = preset.id;
  refreshPresetActive();
  if (preview) {
    preview.setBoardColor(state.board.color);
    preview.setExploded(false);
  }
  exploded = false;
  syncExplodeUi();
  scheduleBuild({ fit: true, immediate: true });
  queueSave();
  toast(`已载入 ${preset.label}`, `${preset.detail} mm · 外壳参数已重置`);
}

/* ── Build ──────────────────────────────────────────────────────────────── */

function stateChanged({ rebuild = true } = {}) {
  queueSave();
  if (rebuild) scheduleBuild();
  else updateBlockedUi();
}

function scheduleBuild({ fit = false, immediate = false } = {}) {
  if (previewFailed) return;
  if (pendingInvalid.size > 0) {
    updateBlockedUi();
    return;
  }
  if (fit) pendingFit = true;
  modelDirty = true;
  clearTimeout(buildTimer);
  buildVersion += 1;
  const generation = buildVersion;
  setBuilding(true);
  updateActionButtons();

  buildTimer = window.setTimeout(
    () => {
      if (generation !== buildVersion) return;
      buildNow({ fit: pendingFit, generation, initial: false });
    },
    immediate ? 0 : 55,
  );
}

function buildNow({ fit = false, generation = buildVersion, initial = false } = {}) {
  if (!preview || previewFailed) return;
  const requestGeneration = generation;
  isBuilding = true;
  if (initial) setModelStatus('busy', '正在生成六面板外壳');
  setExportStatus('正在生成外壳…');

  requestAnimationFrame(() => {
    if (requestGeneration !== buildVersion && !initial) return;

    let nextModel = null;
    try {
      nextModel = buildCaseModel(state);
      preview.setModel(nextModel, { fit: fit || initial });
      preview.setBoardColor(state.board.color);
      model = nextModel;
      modelDirty = false;
      pendingFit = false;
      updateModelUi(nextModel);
      dom.canvasLoading.classList.add('is-hidden');
    } catch (error) {
      console.error('[BoardForge] enclosure build failed', error);
      if (nextModel && model !== nextModel) disposeCaseModel(nextModel);
      modelDirty = true;
      setModelStatus('error', '外壳生成失败 · 请检查参数');
      setExportStatus('生成失败', 'error');
      dom.canvasLoading.classList.add('is-hidden');
      toast('外壳生成失败', error?.message || String(error), 'error');
    } finally {
      isBuilding = false;
      updateActionButtons();
      if (!initial) setExportStatusFromModel();
    }
  });
}

function setBuilding(building) {
  isBuilding = building;
  if (building) {
    if (!model) setModelStatus('busy', '正在生成六面板外壳');
    setExportStatus('正在计算…');
  }
  updateActionButtons();
}

function updateBlockedUi() {
  if (pendingInvalid.size === 0) return;
  clearTimeout(buildTimer);
  buildVersion += 1;
  isBuilding = false;
  setModelStatus('warning', '参数待修正 · 当前显示上次结果');
  setExportStatus('请修正高亮参数', 'error');
  updateActionButtons();
}

function updateModelUi(result) {
  const dims = result.dimensions;
  dom.statSize.textContent =
    `${formatNumber(dims.outerWidth)} × ${formatNumber(dims.outerDepth)} × ` +
    `${formatNumber(dims.outerHeight)} mm`;
  dom.statInner.textContent =
    `${formatNumber(dims.innerWidth)} × ${formatNumber(dims.innerDepth)} × ` +
    `${formatNumber(dims.innerHeight)} mm`;
  dom.statMaterial.textContent =
    `${formatNumber(dims.panelThickness)} mm · ${result.columnCount} 组固定柱`;
  dom.statTime.textContent = `${Math.round(result.buildMs)} ms`;

  if (result.warnings.length > 0) {
    setModelStatus('warning', `6 面板 · ${result.warnings.length} 条提醒`);
    setExportStatus(`可导出 · ${result.warnings.length} 条提醒`, 'warning');
  } else {
    setModelStatus('good', '6 面板 · 榫卯互锁');
    setExportStatus('可导出 DXF / SVG / STL');
  }

  renderSceneNotices(result);
  updateOpeningsHint(result);
  updateDerivedUi();
  updateActionButtons();
}

function renderSceneNotices(result) {
  if (!result.warnings.length) {
    dom.sceneNotices.hidden = true;
    dom.sceneNotices.innerHTML = '';
    return;
  }
  const visible = result.warnings.slice(0, 3);
  dom.sceneNotices.innerHTML = visible
    .map((message) => `<span class="scene-notice">${escapeHtml(message)}</span>`)
    .join('');
  dom.sceneNotices.hidden = false;
}

function updateOpeningsHint(result) {
  const openingWarnings = result.warnings.filter((warning) => warning.includes('开孔'));
  if (openingWarnings.length > 0) {
    dom.openingsHint.hidden = false;
    dom.openingsHint.textContent = openingWarnings.join(' ');
  } else {
    dom.openingsHint.hidden = true;
    dom.openingsHint.textContent = '';
  }
}

function setModelStatus(tone, text) {
  dom.modelStatus.className = `model-status is-${tone}`;
  dom.modelStatusText.textContent = text;
}

function setExportStatus(text, tone = 'ok') {
  dom.exportStatus.textContent = text;
  dom.exportStatus.className = 'export-status';
  if (tone === 'warning') dom.exportStatus.classList.add('is-warning');
  if (tone === 'error') dom.exportStatus.classList.add('is-error');
}

function setExportStatusFromModel() {
  if (pendingInvalid.size > 0) {
    setExportStatus('请修正高亮参数', 'error');
    return;
  }
  if (!model) {
    setExportStatus('等待外壳生成', 'warning');
    return;
  }
  if (modelDirty || isBuilding) {
    setExportStatus('正在更新…');
    return;
  }
  if (model.warnings.length > 0) {
    setExportStatus(`可导出 · ${model.warnings.length} 条提醒`, 'warning');
  } else {
    setExportStatus('可导出 DXF / SVG / STL');
  }
}

function updateActionButtons() {
  const blocked = pendingInvalid.size > 0;
  dom.exportJsonButton.disabled = blocked;
  const unavailable =
    blocked || !model || modelDirty || isBuilding || previewFailed;
  dom.exportSvgButton.disabled = unavailable;
  dom.exportDxfButton.disabled = unavailable;
  dom.exportStlButton.disabled = unavailable;
}

/* ── Views / projection / explosion ─────────────────────────────────────── */

function readProjectionMode() {
  try {
    return localStorage.getItem(PROJECTION_STORAGE_KEY) === 'orthographic'
      ? 'orthographic'
      : 'perspective';
  } catch {
    return 'perspective';
  }
}

function syncProjectionUi() {
  const orthographic = currentProjection === 'orthographic';
  const actionLabel = orthographic ? '切换到透视投影' : '切换到正交投影';
  dom.projectionButton.setAttribute('aria-pressed', String(orthographic));
  dom.projectionButton.title = actionLabel;
  dom.projectionButton.setAttribute('aria-label', actionLabel);
  dom.projectionButtonLabel.textContent = orthographic ? '正交' : '透视';
}

function toggleProjection() {
  currentProjection =
    currentProjection === 'perspective' ? 'orthographic' : 'perspective';
  try {
    localStorage.setItem(PROJECTION_STORAGE_KEY, currentProjection);
  } catch {
    // The in-memory setting still works without storage.
  }
  syncProjectionUi();
  if (preview && !previewFailed) preview.setProjection(currentProjection);
}

function setActiveView(view) {
  activeView = view;
  dom.viewButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

function requestView(view) {
  setActiveView(view);
  if (preview && !previewFailed) preview.setView(view, true);
}

function syncExplodeUi() {
  dom.explodeButton.setAttribute('aria-pressed', String(exploded));
}

function toggleExploded() {
  exploded = !exploded;
  syncExplodeUi();
  if (preview && !previewFailed) preview.setExploded(exploded);
}

/* ── Exports ────────────────────────────────────────────────────────────── */

function ensureModelReady() {
  if (pendingInvalid.size > 0) {
    toast('请先修正参数', '高亮字段的数值无效或超出范围。', 'error');
    return false;
  }
  if (!model || modelDirty || isBuilding) {
    toast('外壳尚未更新完成', '请稍等片刻再导出。', 'warning');
    return false;
  }
  return true;
}

function touchDocument() {
  const documentData = toCaseDocument(state);
  state.meta.updated = documentData.meta.updated;
  return documentData;
}

function exportCaseJson() {
  if (pendingInvalid.size > 0) {
    toast('请先修正参数', '高亮字段的数值无效或超出范围。', 'error');
    return;
  }
  try {
    const documentData = touchDocument();
    const json = `${JSON.stringify(documentData, null, 2)}\n`;
    const filename = `${caseFileStem(state)}.case.json`;
    downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
    saveNow();
    toast('参数文件已导出', `${filename} · ${formatBytes(new Blob([json]).size)}`);
  } catch (error) {
    toast('参数导出失败', error?.message || String(error), 'error');
  }
}

function exportCutSvg() {
  if (!ensureModelReady()) return;
  try {
    const svg = buildCutSvg(model);
    const filename = `${caseFileStem(state)}-cut.svg`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
    toast('SVG 切割图已导出', `${model.panelCount} 块面板 · 单位 mm`);
  } catch (error) {
    toast('SVG 导出失败', error?.message || String(error), 'error');
  }
}

function exportCutDxf() {
  if (!ensureModelReady()) return;
  try {
    const dxf = buildCutDxf(model);
    const filename = `${caseFileStem(state)}-cut.dxf`;
    downloadBlob(new Blob([dxf], { type: 'application/dxf;charset=utf-8' }), filename);
    toast('DXF 切割文件已导出', `${model.panelCount} 块面板 · CUT 图层 · 单位 mm`);
  } catch (error) {
    toast('DXF 导出失败', error?.message || String(error), 'error');
  }
}

function exportAssemblyStl() {
  if (!ensureModelReady()) return;
  try {
    const geometry = buildAssemblyGeometry(model);
    const buffer = createBinaryStl(geometry, { name: `${state.name} assembly` });
    geometry.dispose();
    const filename = `${caseFileStem(state)}-assembly.stl`;
    downloadBlob(new Blob([buffer], { type: 'model/stl' }), filename);
    toast(
      'STL 装配预览已导出',
      `${model.panelCount} 面板 + 五金 · 仅用于预览，不是可打印单体`,
      'warning',
    );
  } catch (error) {
    toast('STL 导出失败', error?.message || String(error), 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ── Import ─────────────────────────────────────────────────────────────── */

function looksLikeParameterDocument(raw) {
  return (
    isPlainObject(raw) &&
    (isPlainObject(raw.board) ||
      Array.isArray(raw.holes) ||
      isPlainObject(raw.enclosure) ||
      Array.isArray(raw.openings))
  );
}

async function importBoardFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    toast('文件过大', '参数文件应小于 2 MB。', 'error');
    return;
  }

  try {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const raw = JSON.parse(text);
    if (!looksLikeParameterDocument(raw)) {
      throw new Error('这个 JSON 不包含开发板或外壳参数，无法导入。');
    }

    const { state: importedState, warnings, migratedFromBoardOnly } =
      normalizeCaseState(raw);
    pendingInvalid.clear();
    state = importedState;
    selectedPresetId = detectPresetId(state);
    syncFormFromState();
    selectedPresetId = detectPresetId(state);
    refreshPresetActive();
    if (preview) {
      preview.setBoardColor(state.board.color);
      preview.setExploded(false);
    }
    exploded = false;
    syncExplodeUi();
    scheduleBuild({ fit: true, immediate: true });
    queueSave();

    if (warnings.length > 0) {
      toast('参数已导入，已自动修正部分字段', warnings.join(' '), 'warning');
    } else {
      toast(
        migratedFromBoardOnly ? '开发板参数已导入' : '外壳参数已导入',
        `${state.name} · ${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} mm 板子`,
      );
    }
  } catch (error) {
    toast('无法导入参数文件', error?.message || String(error), 'error');
  } finally {
    dom.fileInput.value = '';
  }
}

/* ── Autosave ───────────────────────────────────────────────────────────── */

function readStoredState() {
  for (const key of [STORAGE_KEY, LEGACY_CASE_STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) continue;
      const result = normalizeCaseState(parsed);
      if (!result.state) continue;
      if (key === LEGACY_CASE_STORAGE_KEY) tightenLegacyDefaultEnclosure(result.state);
      return result;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * The first enclosure release used a much looser default fit. Tighten that
 * exact, untouched default once when migrating the old autosave key, without
 * overriding deliberate custom values.
 */
function tightenLegacyDefaultEnclosure(candidate) {
  const enclosure = candidate.enclosure;
  const isOldDefault =
    enclosure.panel_thickness === 3 &&
    enclosure.clearance === 6 &&
    enclosure.bottom_gap === 8 &&
    enclosure.top_gap === 20 &&
    enclosure.screw_clearance === 3.4 &&
    enclosure.fit === 0.15 &&
    candidate.openings.length === 0;
  if (!isOldDefault) return;
  enclosure.clearance = 2;
  enclosure.bottom_gap = 6;
  enclosure.top_gap = 16;
}

function queueSave() {
  clearTimeout(saveTimer);
  dom.autosaveLabel.textContent = '正在保存…';
  dom.autosaveLabel.classList.remove('is-saved');
  saveTimer = window.setTimeout(saveNow, 320);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    const documentData = toCaseDocument(state, { touch: false });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documentData));
    dom.autosaveLabel.textContent = '已保存到本机';
    dom.autosaveLabel.classList.add('is-saved');
    clearTimeout(savedLabelTimer);
    savedLabelTimer = window.setTimeout(() => {
      dom.autosaveLabel.textContent = '本地自动保存';
      dom.autosaveLabel.classList.remove('is-saved');
    }, 1800);
  } catch {
    dom.autosaveLabel.textContent = '无法访问本地存储';
    dom.autosaveLabel.classList.remove('is-saved');
  }
}

/* ── Notifications / fatal ──────────────────────────────────────────────── */

function toast(title, message = '', tone = 'success') {
  const toastElement = document.createElement('div');
  toastElement.className = `toast${tone === 'error' ? ' is-error' : tone === 'warning' ? ' is-warning' : ''}`;
  toastElement.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = tone === 'error' ? '!' : tone === 'warning' ? '!' : '✓';

  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = title;
  copy.appendChild(heading);
  if (message) {
    const body = document.createElement('span');
    body.textContent = message;
    copy.appendChild(body);
  }

  toastElement.append(icon, copy);
  dom.toastRoot.appendChild(toastElement);

  const remove = () => {
    if (!toastElement.isConnected) return;
    toastElement.classList.add('is-leaving');
    window.setTimeout(() => toastElement.remove(), 210);
  };
  toastElement.addEventListener('click', remove);
  window.setTimeout(remove, tone === 'error' ? 6500 : 4400);

  while (dom.toastRoot.children.length > 4) {
    dom.toastRoot.firstElementChild?.remove();
  }
}

function showFatal(message) {
  previewFailed = true;
  dom.fatalCard.hidden = false;
  dom.fatalMessage.textContent = message;
  dom.canvasLoading.classList.add('is-hidden');
  setModelStatus('error', '3D 预览不可用');
  updateActionButtons();
}

/* ── Events ─────────────────────────────────────────────────────────────── */

function bindEvents() {
  dom.caseName.addEventListener('input', () => {
    state.name = dom.caseName.value;
    updateNameUi();
    queueSave();
  });
  dom.caseName.addEventListener('blur', () => {
    if (!state.name.trim()) state.name = '未命名开发板外壳';
    state.name = state.name.trim().slice(0, 80);
    dom.caseName.value = state.name;
    updateNameUi();
    queueSave();
  });

  boardInputs.forEach((input) => {
    input.addEventListener('input', () => handleBoardInput(input));
    input.addEventListener('blur', () => normalizeBoardInput(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
  });

  caseInputs.forEach((input) => {
    input.addEventListener('input', () => handleCaseInput(input));
    input.addEventListener('blur', () => normalizeCaseInput(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
  });

  dom.ventEnabledInput.addEventListener('change', () => {
    state.enclosure.vent.enabled = dom.ventEnabledInput.checked;
    for (const path of [...pendingInvalid]) {
      if (path.startsWith('case.vent.')) pendingInvalid.delete(path);
    }
    [dom.ventCountInput, dom.ventWidthInput, dom.ventLengthInput].forEach((input) =>
      markFieldInvalid(input, false),
    );
    updateVentUi();
    stateChanged();
  });

  dom.colorInput.addEventListener('input', () => {
    state.board.color = dom.colorInput.value;
    updateColorUi();
    if (preview) preview.setBoardColor(state.board.color);
    queueSave();
  });

  dom.holeList.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-hole]');
    if (input) handleHoleInput(input);
  });
  dom.holeList.addEventListener(
    'blur',
    (event) => {
      const input = event.target.closest('input[data-hole]');
      if (input) normalizeHoleInput(input);
    },
    true,
  );
  dom.holeList.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input[data-hole]')) {
      event.target.blur();
    }
  });
  dom.holeList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-hole]');
    if (button) deleteHole(Number(button.dataset.deleteHole));
  });
  dom.addHoleButton.addEventListener('click', addHole);

  dom.openingList.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-opening-field]');
    if (input) handleOpeningInput(input);
  });
  dom.openingList.addEventListener(
    'blur',
    (event) => {
      const input = event.target.closest('input[data-opening-field]');
      if (input) normalizeOpeningInput(input);
    },
    true,
  );
  dom.openingList.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      event.target.matches('input[data-opening-field]')
    ) {
      event.target.blur();
    }
  });
  dom.openingList.addEventListener('change', (event) => {
    const select = event.target.closest('select[data-opening-field]');
    if (select) handleOpeningSelect(select);
  });
  dom.openingList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-opening]');
    if (button) deleteOpening(Number(button.dataset.deleteOpening));
  });
  dom.addOpeningButton.addEventListener('click', addOpening);

  dom.presetRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset-id]');
    if (button) loadPreset(button.dataset.presetId);
  });

  dom.modeButton.addEventListener('click', () => {
    setThemeMode(currentMode === 'dark' ? 'light' : 'dark');
  });
  dom.themeButton.addEventListener('click', () => {
    setThemeMenuOpen(dom.themeMenu.hidden);
  });
  dom.themeCloseButton.addEventListener('click', () => setThemeMenuOpen(false));
  dom.themePresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-color]');
    if (button) applyThemeColor(button.dataset.themeColor);
  });
  dom.themeColorInput.addEventListener('input', () => {
    applyThemeColor(dom.themeColorInput.value);
  });
  dom.resetThemeButton.addEventListener('click', resetTheme);

  dom.newButton.addEventListener('click', () => {
    pendingInvalid.clear();
    state = createDefaultCaseState();
    selectedPresetId = detectPresetId(state);
    syncFormFromState();
    if (preview) {
      preview.setBoardColor(state.board.color);
      preview.setExploded(false);
    }
    exploded = false;
    syncExplodeUi();
    scheduleBuild({ fit: true, immediate: true });
    queueSave();
    toast('已新建默认外壳', '六面板榫卯 · 3 mm 亚克力 · M3 五金');
  });

  dom.importButton.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files?.[0];
    if (file) importBoardFile(file);
  });

  dom.exportJsonButton.addEventListener('click', exportCaseJson);
  dom.exportSvgButton.addEventListener('click', exportCutSvg);
  dom.exportDxfButton.addEventListener('click', exportCutDxf);
  dom.exportStlButton.addEventListener('click', exportAssemblyStl);

  dom.viewButtons.forEach((button) => {
    button.addEventListener('click', () => requestView(button.dataset.view));
  });
  dom.projectionButton.addEventListener('click', toggleProjection);
  dom.explodeButton.addEventListener('click', toggleExploded);
  dom.previewCanvas.addEventListener('dblclick', () => requestView('iso'));

  bindDragAndDrop();
  bindShortcuts();

  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
}

function bindDragAndDrop() {
  const hasFiles = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    dom.dropOverlay.classList.add('is-active');
    dom.dropOverlay.setAttribute('aria-hidden', 'false');
  });

  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dom.dropOverlay.classList.remove('is-active');
      dom.dropOverlay.setAttribute('aria-hidden', 'true');
    }
  });

  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dom.dropOverlay.classList.remove('is-active');
    dom.dropOverlay.setAttribute('aria-hidden', 'true');
    const file = event.dataTransfer?.files?.[0];
    if (file) importBoardFile(file);
  });
}

function bindShortcuts() {
  window.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (event.shiftKey) exportAssemblyStl();
      else exportCaseJson();
    } else if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      dom.fileInput.click();
    }
  });
}

/* ── Debug / test hook ──────────────────────────────────────────────────── */

function exposeDebugApi() {
  Object.defineProperty(window, 'boardForge', {
    configurable: true,
    value: Object.freeze({
      getState: () => toCaseDocument(state, { touch: false }),
      getDiagnostics: () =>
        model
          ? {
              outer: {
                width: model.dimensions.outerWidth,
                depth: model.dimensions.outerDepth,
                height: model.dimensions.outerHeight,
              },
              inner: {
                width: model.dimensions.innerWidth,
                depth: model.dimensions.innerDepth,
                height: model.dimensions.innerHeight,
              },
              panelCount: model.panelCount,
              panels: model.panels.map((panel) => ({
                id: panel.id,
                triangles: panel.triangleCount,
                holes: panel.holes.length,
                outlinePoints: panel.outline.length,
              })),
              columnCount: model.columnCount,
              mountCount: model.mounts.length,
              lowerStandoffCount: model.hardware.lowerStandoffs.length,
              upperStandoffCount: model.hardware.upperStandoffs.length,
              columns: model.mounts.map((mount) => ({
                x: mount.x,
                y: mount.y,
                panelHoleDiameter: mount.diameter,
                boardHoleDiameter: mount.boardHoleDiameter,
              })),
              triangleCount: model.triangleCount,
              buildMs: model.buildMs,
              warnings: model.warnings,
              boardWatertight: model.board.diagnostics.watertight,
            }
          : null,
      getFilename: () => caseFileStem(state),
      getTheme: () => currentThemeColor,
      getMode: () => currentMode,
      getProjection: () => currentProjection,
      getCamera: () => (preview ? preview.getCameraState() : null),
      isBusy: () => isBuilding || modelDirty,
      setView: (view) => requestView(view),
      setExploded: (value) => {
        exploded = Boolean(value);
        syncExplodeUi();
        if (preview) preview.setExploded(exploded);
      },
      getExploded: () => exploded,
      rebuild: () => scheduleBuild({ fit: true, immediate: true }),
      flushSave: saveNow,
      activeView: () => activeView,
    }),
  });
}

/* ── Utilities ──────────────────────────────────────────────────────────── */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
