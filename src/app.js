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
  SCREW_SPECS,
  SIDE_LABELS,
  caseFileStem,
  createCaseFromPreset,
  createDefaultCaseState,
  createOpening,
  deriveCaseDimensions,
  normalizeCaseState,
  openingSafeMargins,
  openingToPanelLocal,
  panelLocalToOpening,
  screwSpecById,
  screwSpecForClearance,
  sidePanelWidth,
  toCaseDocument,
} from './case-schema.js';
import {
  buildAssemblyGeometry,
  buildCaseModel,
  disposeCaseModel,
} from './case-geometry.js';
import { buildBoardModel } from './board-geometry.js';
import { BoardPreview } from './preview.js';
import { createBinaryStl } from './stl-export.js';
import { buildCutDxf, buildCutSvg, cutSheetBounds } from './vector-export.js';
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
const PROJECTS_STORAGE_KEY = 'boardforge.projects.v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'boardforge.active-project.v1';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_SAVED_PROJECTS = 50;

const SIDE_VIEWS = Object.freeze(['front', 'back', 'left', 'right']);
const SIDE_VIEW_LABELS = Object.freeze({
  front: '前视',
  back: '后视',
  left: '左视',
  right: '右视',
});

const OPENING_PRESETS = Object.freeze([
  { id: 'usb-c', label: 'USB-C', shape: 'rect', width: 9, height: 3.6 },
  { id: 'usb-a', label: 'USB-A', shape: 'rect', width: 14, height: 6.5 },
  { id: 'hdmi', label: 'HDMI', shape: 'rect', width: 15, height: 6 },
  { id: 'rj45', label: 'RJ45 网口', shape: 'rect', width: 16, height: 13 },
  { id: 'dc', label: 'DC 5.5 电源孔', shape: 'circle', diameter: 9 },
  { id: 'audio', label: '3.5 mm 音频孔', shape: 'circle', diameter: 6 },
]);

const dom = {
  caseName: document.querySelector('#caseName'),
  presetRow: document.querySelector('#presetRow'),
  autosaveLabel: document.querySelector('#autosaveLabel'),

  panelThicknessInput: document.querySelector('#panelThicknessInput'),
  clearanceInput: document.querySelector('#clearanceInput'),
  bottomGapInput: document.querySelector('#bottomGapInput'),
  topGapInput: document.querySelector('#topGapInput'),
  screwSpecSelect: document.querySelector('#screwSpecSelect'),
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
  enclosureSummary: document.querySelector('#enclosureSummary'),
  mechanicalSummary: document.querySelector('#mechanicalSummary'),

  openingList: document.querySelector('#openingList'),
  openingCount: document.querySelector('#openingCount'),
  openingsHint: document.querySelector('#openingsHint'),
  addOpeningButton: document.querySelector('#addOpeningButton'),
  openingSideTabs: document.querySelector('#openingSideTabs'),
  panelMap: document.querySelector('#panelMap'),
  panelMapTitle: document.querySelector('#panelMapTitle'),
  panelMapDims: document.querySelector('#panelMapDims'),
  openingPresetSelect: document.querySelector('#openingPresetSelect'),
  addPresetOpeningButton: document.querySelector('#addPresetOpeningButton'),
  hardwareSummary: document.querySelector('#hardwareSummary'),
  bomList: document.querySelector('#bomList'),
  bomNote: document.querySelector('#bomNote'),
  copyBomButton: document.querySelector('#copyBomButton'),

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

  saveProjectButton: document.querySelector('#saveProjectButton'),
  projectsButton: document.querySelector('#projectsButton'),
  launcherModal: document.querySelector('#projectLauncher'),
  launcherCloseButton: document.querySelector('#launcherCloseButton'),
  launcherCurrentName: document.querySelector('#launcherCurrentName'),
  launcherCurrentMeta: document.querySelector('#launcherCurrentMeta'),
  launcherSaveButton: document.querySelector('#launcherSaveButton'),
  launcherPresets: document.querySelector('#launcherPresets'),
  launcherNewButton: document.querySelector('#launcherNewButton'),
  launcherProjectCount: document.querySelector('#launcherProjectCount'),
  launcherProjects: document.querySelector('#launcherProjects'),
  launcherImportButton: document.querySelector('#launcherImportButton'),
  launcherContinueButton: document.querySelector('#launcherContinueButton'),
  importButton: document.querySelector('#importButton'),
  fileInput: document.querySelector('#fileInput'),
  exportFilename: document.querySelector('#exportFilename'),
  exportStatus: document.querySelector('#exportStatus'),
  previewCutButton: document.querySelector('#previewCutButton'),
  exportJsonButton: document.querySelector('#exportJsonButton'),
  exportSvgButton: document.querySelector('#exportSvgButton'),
  exportDxfButton: document.querySelector('#exportDxfButton'),
  exportStlButton: document.querySelector('#exportStlButton'),
  sheetModal: document.querySelector('#sheetModal'),
  sheetCloseButton: document.querySelector('#sheetCloseButton'),
  sheetSize: document.querySelector('#sheetSize'),
  sheetPreview: document.querySelector('#sheetPreview'),
  sheetExportSvgButton: document.querySelector('#sheetExportSvgButton'),
  sheetExportDxfButton: document.querySelector('#sheetExportDxfButton'),
  projectModal: document.querySelector('#projectModal'),
  projectDialogTitle: document.querySelector('#projectDialogTitle'),
  projectDialogText: document.querySelector('#projectDialogText'),
  projectDialogSummary: document.querySelector('#projectDialogSummary'),
  projectCloseButton: document.querySelector('#projectCloseButton'),
  projectCancelButton: document.querySelector('#projectCancelButton'),
  projectDirectButton: document.querySelector('#projectDirectButton'),
  projectExportButton: document.querySelector('#projectExportButton'),

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
  viewMenuButton: document.querySelector('#viewMenuButton'),
  viewMenuLabel: document.querySelector('#viewMenuLabel'),
  viewMenu: document.querySelector('#viewMenu'),
  projectionButton: document.querySelector('#projectionButton'),
  projectionButtonLabel: document.querySelector('#projectionButtonLabel'),
  explodeButton: document.querySelector('#explodeButton'),
  accordionSections: Array.from(document.querySelectorAll('.accordion-section')),
};

const boardInputs = Array.from(document.querySelectorAll('input[data-path]'));
const caseInputs = Array.from(document.querySelectorAll('input[data-case]'));

let state = createDefaultCaseState();
let currentThemeColor = DEFAULT_THEME_COLOR;
let currentMode = DEFAULT_THEME_MODE;
let selectedPresetId = null;
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
let activeOpeningSide = 'front';
let selectedOpeningIndex = null;
let openingDrag = null;
let currentBomText = '';
let sheetReturnFocus = null;
let projectReturnFocus = null;
let pendingProjectAction = null;
let safeProjectSignatures = null;
let activeProjectId = null;
let launcherReturnFocus = null;
let pendingDeleteProjectId = null;
let boardCache = null;
const pendingInvalid = new Set();

/* ── Boot ───────────────────────────────────────────────────────────────── */

bootstrap();

function bootstrap() {
  initializeTheme();
  const restored = readStoredState();
  if (restored) {
    state = restored.state;
  }
  activeProjectId = readActiveProjectId();
  selectedPresetId = detectPresetId(state);

  renderPresets();
  renderHardwareSpecOptions();
  renderOpeningPresetOptions();
  syncFormFromState();
  syncProjectionUi();
  setActiveView(activeView);
  initializeAccordions();
  bindEvents();
  exposeDebugApi();

  requestAnimationFrame(() => {
    try {
      preview = new BoardPreview(dom.previewCanvas, {
        onContextLost: (message) => showFatal(message),
        onViewChange: (view) => setActiveView(view),
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
    openProjectLauncher({ startup: true });
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

/* ── Sidebar accordions ─────────────────────────────────────────────────── */

function scrollAccordionIntoView(section) {
  const reducedMotion = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  )?.matches;
  requestAnimationFrame(() => {
    section.scrollIntoView({
      block: 'start',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  });
}

function initializeAccordions() {
  for (const section of dom.accordionSections) {
    section.addEventListener('toggle', () => {
      if (!section.open) return;
      for (const other of dom.accordionSections) {
        if (other !== section && other.open) other.open = false;
      }
    });

    // The initially open section also emits a deferred toggle event during
    // boot. Only user clicks and invalid-field reveals should scroll the page.
    section.querySelector(':scope > summary')?.addEventListener('click', () => {
      requestAnimationFrame(() => {
        if (section.open) scrollAccordionIntoView(section);
      });
    });
  }
}

function revealAccordionFor(element) {
  const section = element?.closest?.('.accordion-section');
  if (!section || section.open) return;
  section.open = true;
  scrollAccordionIntoView(section);
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
  dom.screwSpecSelect.value = screwSpecForClearance(
    state.enclosure.screw_clearance,
  ).id;
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
  activeOpeningSide = 'front';
  selectedOpeningIndex = null;
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
  dom.enclosureSummary.textContent =
    `${formatNumber(dims.outerWidth)} × ${formatNumber(dims.outerDepth)} × ` +
    `${formatNumber(dims.outerHeight)} mm`;
  dom.enclosureNote.textContent =
    `内腔 ${formatNumber(dims.innerWidth)} × ${formatNumber(dims.innerDepth)} × ` +
    `${formatNumber(dims.innerHeight)} mm · 6 块 ${formatNumber(dims.panelThickness)} mm 亚克力`;
  dom.boardSummary.textContent =
    `${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} × ` +
    `${formatNumber(state.board.thickness)} mm · ${state.holes.length} 孔`;
  dom.holeCount.textContent = `${state.holes.length} / ${MAX_HOLES}`;
  updateHardwareNote();
  updateBom();
  renderOpeningMap();
  updateFilenameUi();
}

function fittingScrewSpec(smallestHole) {
  return [...SCREW_SPECS]
    .reverse()
    .find((spec) => spec.clearance - smallestHole <= 0.4) || null;
}

function updateHardwareNote() {
  const clearance = Number(state.enclosure.screw_clearance);
  const spec = screwSpecForClearance(clearance);
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
    const smaller = fittingScrewSpec(smallest);
    dom.hardwareNote.textContent =
      `板孔最小 ${formatNumber(smallest)} mm，小于 ${spec.label} 的 ` +
      `${formatNumber(clearance)} mm 标准过孔；` +
      (smaller
        ? `请扩孔，或改用 ${smaller.label}（${formatNumber(smaller.clearance)} mm 过孔）。`
        : '请扩孔后再使用标准五金。');
    dom.hardwareNote.classList.add('is-warning');
    return;
  }

  dom.hardwareNote.textContent =
    `${spec.label} 标准过孔 ${formatNumber(clearance)} mm；` +
    `${usable.length} 组固定柱穿过开发板孔位，上下锁紧顶板与底板。`;
  dom.hardwareNote.classList.remove('is-warning');
}

function updateBom(actualMountCount = null) {
  const dims = deriveCaseDimensions(state);
  const usable = analyseHoles(state).printable;
  const count = actualMountCount ?? usable.length;
  const t = dims.panelThickness;
  const clearance = Number(state.enclosure.screw_clearance);
  const spec = screwSpecForClearance(clearance);
  const screwLabel = spec.label;
  const lowerLength = dims.bottomGap;
  const upperLength = dims.topGap;
  const panelScrewLength = Math.max(6, Math.ceil(t + 5));
  const smallest = count > 0
    ? Math.min(...usable.map((hole) => hole.diameter))
    : 0;
  const rows = [
    [`${formatNumber(t)} mm 亚克力板`, '6 块'],
    [`${screwLabel} 下六角固定柱（双内螺纹）`, `${count} × ${formatNumber(lowerLength)} mm`],
    [`${screwLabel} 上六角固定柱（内外螺纹）`, `${count} × ${formatNumber(upperLength)} mm`],
    [`${screwLabel} 顶/底面板螺丝`, `${count * 2} × ${formatNumber(panelScrewLength)}–${formatNumber(panelScrewLength + 2)} mm`],
    [`${screwLabel} 标准过孔`, `${formatNumber(clearance)} mm`],
    [`${screwLabel} 平垫圈`, `${count * 2} 个（建议）`],
  ];

  dom.hardwareSummary.textContent =
    count > 0
      ? `${count} 组 ${screwLabel} 六角固定柱 · ${count * 2} 颗 ${screwLabel} 螺丝`
      : '暂无可用固定柱';
  const vent = state.enclosure.vent;
  dom.mechanicalSummary.textContent =
    `${count} 组六角固定柱 · ` +
    (vent.enabled ? `${formatNumber(vent.count)} 条通风槽` : '通风关闭');
  dom.bomList.innerHTML = rows
    .map(
      ([label, value]) =>
        `<li><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></li>`,
    )
    .join('');

  const incompatible = count > 0 && clearance - smallest > 0.4;
  if (count === 0) {
    dom.bomNote.textContent =
      '缺少有效板孔，无法生成一体固定柱。也可以在板子参考中增加安装孔。';
    dom.bomNote.classList.add('is-warning');
  } else if (incompatible) {
    const smaller = fittingScrewSpec(smallest);
    dom.bomNote.textContent =
      `开发板最小板孔为 ${formatNumber(smallest)} mm，${spec.label} 标准过孔为 ` +
      `${formatNumber(clearance)} mm。` +
      (smaller
        ? `建议扩孔，或改用 ${smaller.label} 五金。`
        : '建议扩孔后使用标准五金。');
    dom.bomNote.classList.add('is-warning');
  } else {
    dom.bomNote.textContent =
      `下柱从底板拧入，上柱的螺纹穿过开发板孔与下柱对锁；顶/底各一颗 ${screwLabel} 面板螺丝。${screwLabel} 采用 ${formatNumber(clearance)} mm 标准过孔，螺丝长度按固定柱螺纹深度和面板厚度微调。`;
    dom.bomNote.classList.remove('is-warning');
  }

  currentBomText = [
    'BoardForge 亚克力外壳五金清单',
    `外壳：${formatNumber(dims.outerWidth)} × ${formatNumber(dims.outerDepth)} × ${formatNumber(dims.outerHeight)} mm`,
    `亚克力板：6 块 × ${formatNumber(t)} mm`,
    `五金规格：${screwLabel}，标准过孔 ${formatNumber(clearance)} mm`,
    `${screwLabel} 下六角固定柱（双内螺纹）：${count} × ${formatNumber(lowerLength)} mm`,
    `${screwLabel} 上六角固定柱（内外螺纹）：${count} × ${formatNumber(upperLength)} mm`,
    `${screwLabel} 顶/底面板螺丝：${count * 2} × ${formatNumber(panelScrewLength)}–${formatNumber(panelScrewLength + 2)} mm`,
    `${screwLabel} 平垫圈：${count * 2} 个（建议）`,
    `开发板固定柱过孔：${formatNumber(clearance)} mm`,
  ].join('\n');
}

async function copyBomText() {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(currentBomText);
    } else {
      const area = document.createElement('textarea');
      area.value = currentBomText;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('五金清单已复制', '可直接粘贴到采购或装配记录。');
  } catch {
    toast('复制失败', '浏览器未授予剪贴板权限。', 'error');
  }
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
  if (invalid) revealAccordionFor(input);
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

function renderHardwareSpecOptions() {
  dom.screwSpecSelect.innerHTML = SCREW_SPECS.map(
    (spec) =>
      `<option value="${spec.id}">${spec.label} · 过孔 ${formatNumber(spec.clearance)} mm</option>`,
  ).join('');
}

function renderOpeningPresetOptions() {
  dom.openingPresetSelect.innerHTML = OPENING_PRESETS.map((preset) => {
    const size =
      preset.shape === 'circle'
        ? `⌀${formatNumber(preset.diameter)}`
        : `${formatNumber(preset.width)}×${formatNumber(preset.height)}`;
    return `<option value="${preset.id}">${preset.label} · ${size}</option>`;
  }).join('');
}

function renderOpeningSideTabs() {
  const counts = Object.fromEntries(OPENING_SIDES.map((side) => [side, 0]));
  for (const opening of state.openings) counts[opening.side] += 1;
  const errorSides = new Set();
  for (const path of pendingInvalid) {
    if (!path.startsWith('openings.')) continue;
    const index = Number(path.split('.')[1]);
    const opening = state.openings[index];
    if (opening) errorSides.add(opening.side);
  }

  dom.openingSideTabs.innerHTML = OPENING_SIDES.map((side) => {
    const active = side === activeOpeningSide;
    return `
      <button class="panel-side-tab${active ? ' active' : ''}${errorSides.has(side) ? ' has-error' : ''}" type="button"
        role="tab" aria-selected="${active}" data-opening-side="${side}"
        title="${SIDE_LABELS[side]}${errorSides.has(side) ? ' · 有参数待修正' : ''}">
        <span>${SIDE_LABELS[side].replace('面板', '')}</span>
        <span class="panel-side-tab-count">${counts[side]}</span>
      </button>`;
  }).join('');
}

function chooseGridStep(width, height) {
  const longest = Math.max(width, height);
  if (longest > 300) return 50;
  if (longest > 150) return 20;
  return 10;
}

function openingDisplayCenter(opening, panelWidth, panelHeight) {
  const center = openingToPanelLocal(opening, panelWidth, panelHeight);
  const mirroredView =
    opening.side === 'left' || opening.side === 'right';
  return {
    x: mirroredView ? panelWidth - center.x : center.x,
    y: panelHeight - center.y,
  };
}

function renderOpeningMap() {
  const side = activeOpeningSide;
  const dims = deriveCaseDimensions(state);
  const width = sidePanelWidth(side, dims);
  const height = dims.innerHeight;
  const margins = openingSafeMargins(state, dims);
  const pad = Math.max(10, Math.min(30, Math.min(width, height) * 0.28));
  const step = chooseGridStep(width, height);
  const majorStep = step * 5;
  const grid = [];

  for (let x = step; x < width; x += step) {
    const major = Math.abs(x % majorStep) < 1e-6;
    grid.push(
      `<line class="panel-grid-line${major ? ' major' : ''}" x1="${x}" y1="0" x2="${x}" y2="${height}" />`,
    );
  }
  for (let y = step; y < height; y += step) {
    const major = Math.abs(y % majorStep) < 1e-6;
    grid.push(
      `<line class="panel-grid-line${major ? ' major' : ''}" x1="0" y1="${y}" x2="${width}" y2="${y}" />`,
    );
  }

  const openings = state.openings
    .map((opening, index) => ({ opening, index }))
    .filter(({ opening }) => opening.side === side)
    .map(({ opening, index }) => {
      const center = openingDisplayCenter(opening, width, height);
      const selected = index === selectedOpeningIndex;
      const className = `opening-shape${selected ? ' selected' : ''}`;
      const labelY = Math.max(-pad * 0.65, Math.min(height + pad * 0.72, center.y + 3));
      const shape =
        opening.shape === 'circle'
          ? `<circle class="${className}" data-map-opening="${index}" cx="${center.x}" cy="${center.y}" r="${opening.diameter / 2}" />`
          : `<rect class="${className}" data-map-opening="${index}" x="${center.x - opening.width / 2}" y="${center.y - opening.height / 2}" width="${opening.width}" height="${opening.height}" rx="${Math.min(2, opening.width / 4, opening.height / 4)}" />`;
      return `
        <g>
          ${shape}
          <text class="opening-map-tag" x="${center.x}" y="${center.y}" pointer-events="none">${index + 1}</text>
          <title>第 ${index + 1} 个开孔 · U ${formatNumber(opening.u)} · V ${formatNumber(opening.v)}</title>
        </g>`;
    })
    .join('');

  dom.panelMapTitle.textContent = SIDE_LABELS[side];
  dom.panelMapDims.textContent = `${formatNumber(width)} × ${formatNumber(height)} mm`;
  dom.panelMap.innerHTML = `
    <svg viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}"
      role="img" aria-label="${SIDE_LABELS[side]}开孔平面图">
      <rect class="panel-outline" x="0" y="0" width="${width}" height="${height}" rx="1.5" />
      ${grid.join('')}
      <line class="panel-axis" x1="${width / 2}" y1="0" x2="${width / 2}" y2="${height}" />
      <line class="panel-axis" x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" />
      <text class="panel-axis-label" x="${width - 8}" y="${height / 2 - 5}">U+</text>
      <text class="panel-axis-label" x="${width / 2 + 9}" y="8">V+</text>
      <rect class="panel-safe-zone" x="${margins.x}" y="${margins.y}"
        width="${Math.max(0, width - margins.x * 2)}"
        height="${Math.max(0, height - margins.y * 2)}" rx="1.5" />
      ${openings}
      <text class="panel-dimension-label" x="${width}" y="${height + pad * 0.78}" text-anchor="end">${formatNumber(width)} mm</text>
      <text class="panel-dimension-label" x="${-pad * 0.35}" y="${height / 2}" text-anchor="middle"
        transform="rotate(-90 ${-pad * 0.35} ${height / 2})">${formatNumber(height)} mm</text>
    </svg>`;
}

function updateSelectedOpeningUi() {
  dom.openingList.querySelectorAll('.opening-card').forEach((card) => {
    card.classList.toggle(
      'is-selected',
      Number(card.dataset.openingIndex) === selectedOpeningIndex,
    );
  });
  dom.panelMap.querySelectorAll('[data-map-opening]').forEach((shape) => {
    shape.classList.toggle(
      'selected',
      Number(shape.dataset.mapOpening) === selectedOpeningIndex,
    );
  });
}

function selectOpening(index, { focusCard = false } = {}) {
  selectedOpeningIndex = Number.isInteger(index) ? index : null;
  updateSelectedOpeningUi();
  if (focusCard && selectedOpeningIndex !== null) {
    const card = dom.openingList.querySelector(
      `.opening-card[data-opening-index="${selectedOpeningIndex}"]`,
    );
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function renderOpenings() {
  renderOpeningSideTabs();
  renderOpeningMap();

  const visible = state.openings
    .map((opening, index) => ({ opening, index }))
    .filter(({ opening }) => opening.side === activeOpeningSide);

  if (visible.length === 0) {
    dom.openingList.innerHTML = `
      <div class="opening-empty">
        <strong>${SIDE_LABELS[activeOpeningSide]}还没有开孔</strong>
        <span>可以添加常用接口预设或自定义开孔</span>
      </div>`;
  } else {
    dom.openingList.innerHTML = visible
      .map(({ opening, index }) => {
        const isCircle = opening.shape === 'circle';
        const sizeFields = isCircle
          ? `<label class="hole-field"><span>⌀</span><input type="number" data-opening-field="diameter" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.diameter)}" aria-label="第 ${index + 1} 个开孔的直径" /></label>`
          : `<label class="hole-field"><span>宽</span><input type="number" data-opening-field="width" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.width)}" aria-label="第 ${index + 1} 个开孔的宽度" /></label>
             <label class="hole-field"><span>高</span><input type="number" data-opening-field="height" min="1" max="300" step="0.5" inputmode="decimal" value="${inputValue(opening.height)}" aria-label="第 ${index + 1} 个开孔的高度" /></label>`;
        return `
          <div class="opening-card${index === selectedOpeningIndex ? ' is-selected' : ''}" data-opening-index="${index}">
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
  dom.addPresetOpeningButton.disabled = state.openings.length >= MAX_OPENINGS;
  dom.openingPresetSelect.disabled = state.openings.length >= MAX_OPENINGS;
  updateSelectedOpeningUi();
}

function clearPendingOpeningFields() {
  for (const path of [...pendingInvalid]) {
    if (path.startsWith('openings.')) pendingInvalid.delete(path);
  }
}

function setActiveOpeningSide(side, { syncView = true } = {}) {
  if (!OPENING_SIDES.includes(side)) return;
  activeOpeningSide = side;
  if (
    selectedOpeningIndex !== null &&
    state.openings[selectedOpeningIndex]?.side !== side
  ) {
    selectedOpeningIndex = null;
  }
  renderOpenings();
  if (syncView) requestView(side);
  requestAnimationFrame(() => {
    dom.openingSideTabs
      .querySelector(`[data-opening-side="${side}"]`)
      ?.focus();
  });
}

function addOpening() {
  if (state.openings.length >= MAX_OPENINGS) return;
  clearPendingOpeningFields();
  state.openings.push(createOpening(activeOpeningSide, 'rect'));
  selectedOpeningIndex = state.openings.length - 1;
  renderOpenings();
  stateChanged();
  requestAnimationFrame(() => {
    const card = dom.openingList.querySelector(
      `.opening-card[data-opening-index="${selectedOpeningIndex}"]`,
    );
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card?.querySelector('input[data-opening-field="u"]')?.focus();
  });
}

function addPresetOpening() {
  if (state.openings.length >= MAX_OPENINGS) return;
  const preset = OPENING_PRESETS.find(
    (item) => item.id === dom.openingPresetSelect.value,
  );
  if (!preset) return;
  clearPendingOpeningFields();
  const opening = createOpening(activeOpeningSide, preset.shape);
  if (preset.shape === 'circle') {
    opening.diameter = preset.diameter;
  } else {
    opening.width = preset.width;
    opening.height = preset.height;
  }
  opening.u = 0;
  opening.v = 0;
  state.openings.push(opening);
  selectedOpeningIndex = state.openings.length - 1;
  renderOpenings();
  stateChanged();
  requestAnimationFrame(() => {
    const card = dom.openingList.querySelector(
      `.opening-card[data-opening-index="${selectedOpeningIndex}"]`,
    );
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function deleteOpening(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.openings.length) return;
  state.openings.splice(index, 1);
  clearPendingOpeningFields();
  if (selectedOpeningIndex === index) selectedOpeningIndex = null;
  else if (selectedOpeningIndex !== null && selectedOpeningIndex > index) {
    selectedOpeningIndex -= 1;
  }
  renderOpenings();
  stateChanged();
}

function mapPointFromEvent(event) {
  const svg = dom.panelMap.querySelector('svg');
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  return matrix ? point.matrixTransform(matrix.inverse()) : null;
}

function startOpeningDrag(event) {
  if (event.button !== 0) return;
  const shape = event.target.closest('[data-map-opening]');
  if (!shape) return;
  const index = Number(shape.dataset.mapOpening);
  const opening = state.openings[index];
  if (!opening) return;

  const dims = deriveCaseDimensions(state);
  const width = sidePanelWidth(activeOpeningSide, dims);
  const height = dims.innerHeight;
  const point = mapPointFromEvent(event);
  if (!point) return;
  const center = openingDisplayCenter(opening, width, height);
  for (const field of ['u', 'v']) {
    pendingInvalid.delete(`openings.${index}.${field}`);
  }
  const card = dom.openingList.querySelector(
    `.opening-card[data-opening-index="${index}"]`,
  );
  for (const field of ['u', 'v']) {
    const input = card?.querySelector(`[data-opening-field="${field}"]`);
    if (input) markFieldInvalid(input, false);
  }
  openingDrag = {
    index,
    pointerId: event.pointerId,
    offsetX: center.x - point.x,
    offsetY: center.y - point.y,
    moved: false,
  };
  selectOpening(index);
  dom.panelMap.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveOpeningDrag(event) {
  if (!openingDrag || event.pointerId !== openingDrag.pointerId) return;
  const opening = state.openings[openingDrag.index];
  if (!opening) return;
  const point = mapPointFromEvent(event);
  if (!point) return;

  const dims = deriveCaseDimensions(state);
  const width = sidePanelWidth(activeOpeningSide, dims);
  const height = dims.innerHeight;
  const margins = openingSafeMargins(state, dims);
  const halfWidth = opening.shape === 'circle' ? opening.diameter / 2 : opening.width / 2;
  const halfHeight = opening.shape === 'circle' ? opening.diameter / 2 : opening.height / 2;
  const minX = margins.x + halfWidth;
  const maxX = width - margins.x - halfWidth;
  const minY = margins.y + halfHeight;
  const maxY = height - margins.y - halfHeight;
  if (minX > maxX || minY > maxY) return;

  const displayX = Math.min(maxX, Math.max(minX, point.x + openingDrag.offsetX));
  const displayY = Math.min(maxY, Math.max(minY, point.y + openingDrag.offsetY));
  const mirroredView =
    activeOpeningSide === 'left' || activeOpeningSide === 'right';
  const localX = mirroredView ? width - displayX : displayX;
  const localY = height - displayY;
  const next = panelLocalToOpening(activeOpeningSide, localX, localY, width, height);
  const nextU = round(next.u, 1);
  const nextV = round(next.v, 1);
  if (nextU === opening.u && nextV === opening.v) return;

  opening.u = nextU;
  opening.v = nextV;
  openingDrag.moved = true;

  const shape = dom.panelMap.querySelector(
    `[data-map-opening="${openingDrag.index}"]`,
  );
  if (shape) {
    if (opening.shape === 'circle') {
      shape.setAttribute('cx', String(displayX));
      shape.setAttribute('cy', String(displayY));
    } else {
      shape.setAttribute('x', String(displayX - opening.width / 2));
      shape.setAttribute('y', String(displayY - opening.height / 2));
    }
    const tag = shape.parentElement?.querySelector('.opening-map-tag');
    if (tag) {
      tag.setAttribute('x', String(displayX));
      tag.setAttribute('y', String(displayY));
    }
  }

  const card = dom.openingList.querySelector(
    `.opening-card[data-opening-index="${openingDrag.index}"]`,
  );
  const uInput = card?.querySelector('[data-opening-field="u"]');
  const vInput = card?.querySelector('[data-opening-field="v"]');
  if (uInput && document.activeElement !== uInput) uInput.value = inputValue(nextU);
  if (vInput && document.activeElement !== vInput) vInput.value = inputValue(nextV);
  event.preventDefault();
}

function endOpeningDrag(event) {
  if (!openingDrag || event.pointerId !== openingDrag.pointerId) return;
  const { index, moved } = openingDrag;
  openingDrag = null;
  dom.panelMap.releasePointerCapture?.(event.pointerId);
  if (moved) {
    selectedOpeningIndex = index;
    stateChanged();
  }
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
    renderOpeningSideTabs();
    stateChanged({ rebuild: false });
    updateBlockedUi();
    return;
  }

  pendingInvalid.delete(path);
  markFieldInvalid(input, false);
  opening[field] = value;
  selectedOpeningIndex = index;
  renderOpeningSideTabs();
  renderOpeningMap();
  updateSelectedOpeningUi();
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
  selectedOpeningIndex = index;
  renderOpeningSideTabs();
  renderOpeningMap();
  updateSelectedOpeningUi();
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
    for (const path of [...pendingInvalid]) {
      if (path.startsWith(`openings.${index}.`)) pendingInvalid.delete(path);
    }
    activeOpeningSide = opening.side;
    selectedOpeningIndex = index;
    renderOpenings();
    requestView(opening.side);
    stateChanged();
  } else if (field === 'shape') {
    const next = createOpening(opening.side, select.value);
    next.u = opening.u;
    next.v = opening.v;
    state.openings[index] = next;
    clearPendingOpeningFields();
    activeOpeningSide = next.side;
    selectedOpeningIndex = index;
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
  activeProjectId = null;
  writeActiveProjectId(null);
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
  closeProjectLauncher({ restoreFocus: false });
  toast(`已载入 ${preset.label}`, `${preset.detail} mm · 外壳参数已重置`);
}

function applyNewProject() {
  pendingInvalid.clear();
  state = createDefaultCaseState();
  activeProjectId = null;
  writeActiveProjectId(null);
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
  closeProjectLauncher({ restoreFocus: false });
  toast('已新建默认外壳', '六面板榫卯 · 3 mm 亚克力 · M3 五金');
}

function readActiveProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeActiveProjectId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id);
    else localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    // The in-memory active project still works without storage.
  }
}

function makeProjectId() {
  if (globalThis.crypto?.randomUUID) return `prj-${globalThis.crypto.randomUUID()}`;
  return `prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readProjectLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) || 'null');
    const list = Array.isArray(raw) ? raw : raw?.projects;
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (project) =>
          isPlainObject(project) &&
          typeof project.id === 'string' &&
          typeof project.name === 'string' &&
          isPlainObject(project.document),
      )
      .map((project) => ({ ...project }));
  } catch {
    return [];
  }
}

function writeProjectLibrary(projects) {
  try {
    localStorage.setItem(
      PROJECTS_STORAGE_KEY,
      JSON.stringify({ version: 1, projects }),
    );
    return true;
  } catch {
    toast('项目库保存失败', '浏览器本地存储空间不足或被禁用。', 'error');
    return false;
  }
}

function projectDocumentSummary(document) {
  const board = document?.board;
  const boardText = board
    ? `${formatNumber(board.length)} × ${formatNumber(board.width)} × ` +
      `${formatNumber(board.thickness)} mm`
    : '未知板尺寸';
  const holes = Array.isArray(document?.holes) ? document.holes.length : 0;
  const openings = Array.isArray(document?.openings)
    ? document.openings.length
    : 0;
  return `${boardText} · ${holes} 孔 · ${openings} 开孔`;
}

function formatProjectDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function renderProjectLauncher() {
  const projects = readProjectLibrary();
  if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
    activeProjectId = null;
    writeActiveProjectId(null);
  }

  const dims = deriveCaseDimensions(state);
  const linkedProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  let saveState = '草稿未保存';
  if (linkedProject) {
    try {
      saveState =
        projectSignature(linkedProject.document) === projectSignature(state)
          ? '已保存到项目库'
          : '项目库有未保存修改';
    } catch {
      saveState = '已关联项目库';
    }
  }
  dom.launcherCurrentName.textContent = state.name.trim() || '未命名开发板外壳';
  dom.launcherCurrentMeta.textContent =
    `${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} × ` +
    `${formatNumber(state.board.thickness)} mm · ${state.holes.length} 孔 · ` +
    `${state.openings.length} 开孔 · ${formatNumber(dims.outerWidth)} × ` +
    `${formatNumber(dims.outerDepth)} × ${formatNumber(dims.outerHeight)} mm · ` +
    saveState;

  dom.launcherPresets.innerHTML = PRESETS.map(
    (preset) => `
      <button class="launcher-preset" type="button" data-launcher-preset="${preset.id}">
        <strong>${escapeHtml(preset.label)}</strong>
        <span>${escapeHtml(preset.detail)} mm</span>
      </button>`,
  ).join('');

  dom.launcherProjectCount.textContent = String(projects.length);
  if (projects.length === 0) {
    dom.launcherProjects.innerHTML = `
      <div class="launcher-empty">
        还没有保存的项目。点击「保存」把当前编辑加入项目库。
      </div>`;
    return;
  }

  const sorted = [...projects].sort(
    (a, b) => new Date(b.updated || 0) - new Date(a.updated || 0),
  );
  dom.launcherProjects.innerHTML = sorted
    .map((project) => {
      const pendingDelete = project.id === pendingDeleteProjectId;
      return `
        <div class="project-entry" data-project-id="${escapeHtml(project.id)}">
          <div class="project-entry-copy">
            <strong>${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(projectDocumentSummary(project.document))} · ${escapeHtml(formatProjectDate(project.updated))}</span>
          </div>
          <div class="project-entry-actions">
            ${
              pendingDelete
                ? `<button class="project-action is-danger" type="button" data-confirm-delete="${escapeHtml(project.id)}">确认删除</button>
                   <button class="project-action" type="button" data-cancel-delete="${escapeHtml(project.id)}">取消</button>`
                : `<button class="project-action" type="button" data-open-project="${escapeHtml(project.id)}">打开</button>
                   <button class="project-action" type="button" data-delete-project="${escapeHtml(project.id)}">删除</button>`
            }
          </div>
        </div>`;
    })
    .join('');
}

function openProjectLauncher() {
  pendingDeleteProjectId = null;
  renderProjectLauncher();
  launcherReturnFocus = document.activeElement;
  dom.launcherModal.hidden = false;
  dom.launcherModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('launcher-open');
  requestAnimationFrame(() => dom.launcherContinueButton.focus());
}

function closeProjectLauncher({ restoreFocus = true } = {}) {
  if (dom.launcherModal.hidden) return;
  dom.launcherModal.hidden = true;
  dom.launcherModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('launcher-open');
  pendingDeleteProjectId = null;
  if (restoreFocus && launcherReturnFocus?.focus) launcherReturnFocus.focus();
  launcherReturnFocus = null;
}

function saveCurrentProject() {
  if (pendingInvalid.size > 0) {
    toast('请先修正参数', '高亮字段的数值无效或超出范围。', 'error');
    return false;
  }
  const projects = readProjectLibrary();
  let index = projects.findIndex((project) => project.id === activeProjectId);
  if (index < 0 && activeProjectId) {
    activeProjectId = null;
    writeActiveProjectId(null);
  }
  if (index < 0 && projects.length >= MAX_SAVED_PROJECTS) {
    toast('项目数量已满', `最多保存 ${MAX_SAVED_PROJECTS} 个项目。`, 'warning');
    return false;
  }

  const documentData = touchDocument();
  const now = documentData.meta.updated;
  const existing = index >= 0 ? projects[index] : null;
  const id = existing?.id || makeProjectId();
  const entry = {
    id,
    name: documentData.name,
    created: existing?.created || documentData.meta.created,
    updated: now,
    document: documentData,
  };
  if (existing) projects[index] = entry;
  else projects.push(entry);

  if (!writeProjectLibrary(projects)) return false;
  activeProjectId = id;
  writeActiveProjectId(id);
  saveNow();
  if (!dom.launcherModal.hidden) renderProjectLauncher();
  toast('项目已保存', `「${documentData.name}」已加入项目库。`, 'success');
  return true;
}

function openProjectById(id) {
  const project = readProjectLibrary().find((entry) => entry.id === id);
  if (!project) {
    toast('项目不存在', '它可能已经被删除。', 'error');
    return false;
  }

  let normalized;
  try {
    normalized = normalizeCaseState(project.document);
  } catch (error) {
    toast('项目无法打开', error?.message || String(error), 'error');
    return false;
  }

  pendingInvalid.clear();
  state = normalized.state;
  activeProjectId = id;
  writeActiveProjectId(id);
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
  closeProjectLauncher({ restoreFocus: false });
  if (normalized.warnings.length > 0) {
    toast('项目已打开，部分字段已修正', normalized.warnings[0], 'warning');
  } else {
    toast('项目已打开', project.name);
  }
  return true;
}

function requestOpenProject(id) {
  if (id === activeProjectId) {
    closeProjectLauncher({ restoreFocus: false });
    return;
  }
  const project = readProjectLibrary().find((entry) => entry.id === id);
  if (!project) return;
  if (projectIsSafeToReplace()) {
    openProjectById(id);
    return;
  }
  openProjectDialog({ type: 'library', project });
}

function deleteProjectFromLibrary(id) {
  const projects = readProjectLibrary();
  const index = projects.findIndex((project) => project.id === id);
  if (index < 0) return;
  const wasActive = id === activeProjectId;
  projects.splice(index, 1);
  if (!writeProjectLibrary(projects)) return;
  if (wasActive) {
    activeProjectId = null;
    writeActiveProjectId(null);
  }
  pendingDeleteProjectId = null;
  renderProjectLauncher();
  toast(
    '项目已删除',
    wasActive
      ? '当前编辑仍保留为草稿，可继续保存。'
      : '已从本机项目库移除。',
    wasActive ? 'warning' : 'success',
  );
}

function requestDeleteProject(id) {
  if (pendingDeleteProjectId === id) {
    deleteProjectFromLibrary(id);
    return;
  }
  pendingDeleteProjectId = id;
  renderProjectLauncher();
}

function projectSignature(candidate) {
  const documentData = toCaseDocument(candidate, { touch: false });
  delete documentData.meta;
  return JSON.stringify(documentData);
}

function projectIsSafeToReplace() {
  if (!safeProjectSignatures) {
    safeProjectSignatures = new Set([
      projectSignature(createDefaultCaseState()),
      ...PRESETS.map((preset) =>
        projectSignature(createCaseFromPreset(preset)),
      ),
    ]);
  }
  const current = projectSignature(state);
  if (safeProjectSignatures.has(current)) return true;
  try {
    return readProjectLibrary().some(
      (project) => projectSignature(project.document) === current,
    );
  } catch {
    return false;
  }
}

function requestPresetLoad(id) {
  const preset = PRESETS.find((entry) => entry.id === id);
  if (!preset) return;
  if (projectIsSafeToReplace()) {
    loadPreset(id);
    return;
  }
  openProjectDialog({ type: 'preset', preset });
}

function requestNewProject() {
  if (projectIsSafeToReplace()) {
    applyNewProject();
    return;
  }
  openProjectDialog({ type: 'new' });
}

function projectSummaryItem(label, value) {
  return `
    <div class="confirm-stat">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
    </div>`;
}

function openProjectDialog(action) {
  const isPreset = action.type === 'preset';
  const isLibrary = action.type === 'library';
  const dims = deriveCaseDimensions(state);
  dom.projectDialogTitle.textContent = isLibrary
    ? `打开「${action.project.name}」？`
    : isPreset
      ? `载入「${action.preset.label}」？`
      : '新建项目？';
  dom.projectDialogText.textContent = isLibrary
    ? `打开项目会替换当前项目「${state.name}」的板子、孔位、开孔和外壳参数。`
    : isPreset
      ? `载入预设会替换当前项目「${state.name}」的板子、孔位、开孔和外壳参数。`
      : `新建会替换当前项目「${state.name}」的所有参数。`;
  dom.projectDialogSummary.innerHTML = [
    projectSummaryItem('当前项目', state.name),
    projectSummaryItem(
      '开发板',
      `${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} × ` +
        `${formatNumber(state.board.thickness)} mm`,
    ),
    projectSummaryItem(
      '安装孔 / 开孔',
      `${state.holes.length} / ${state.openings.length}`,
    ),
    projectSummaryItem(
      '外壳外形',
      `${formatNumber(dims.outerWidth)} × ${formatNumber(dims.outerDepth)} × ` +
        `${formatNumber(dims.outerHeight)} mm`,
    ),
  ].join('');
  dom.projectDirectButton.textContent = isLibrary
    ? '直接打开'
    : isPreset
      ? '直接载入'
      : '直接新建';
  dom.projectExportButton.textContent = isLibrary
    ? '导出并打开'
    : isPreset
      ? '导出并载入'
      : '导出并新建';

  pendingProjectAction = action;
  projectReturnFocus = document.activeElement;
  dom.projectModal.hidden = false;
  dom.projectModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('project-open');
  dom.projectCancelButton.focus();
}

function closeProjectDialog({ restoreFocus = true } = {}) {
  if (dom.projectModal.hidden) return;
  dom.projectModal.hidden = true;
  dom.projectModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('project-open');
  pendingProjectAction = null;
  if (restoreFocus && projectReturnFocus?.focus) projectReturnFocus.focus();
  projectReturnFocus = null;
}

function performProjectAction(action) {
  if (!action) return;
  closeProjectLauncher({ restoreFocus: false });
  if (action.type === 'preset') loadPreset(action.preset.id);
  else if (action.type === 'new') applyNewProject();
  else if (action.type === 'library') openProjectById(action.project.id);
}

function confirmProjectDirect() {
  const action = pendingProjectAction;
  if (!action) return;
  closeProjectDialog({ restoreFocus: false });
  performProjectAction(action);
}

function confirmProjectWithExport() {
  const action = pendingProjectAction;
  if (!action) return;
  if (!exportCaseJson()) return;
  closeProjectDialog({ restoreFocus: false });
  performProjectAction(action);
}

/* ── Build ──────────────────────────────────────────────────────────────── */

function stateChanged({ rebuild = true } = {}) {
  queueSave();
  if (rebuild) scheduleBuild();
  else updateBlockedUi();
}

function boardModelKey() {
  return JSON.stringify({
    length: state.board.length,
    width: state.board.width,
    thickness: state.board.thickness,
    cornerRadius: state.board.corner_radius,
    holes: state.holes.map((hole) => [hole.x, hole.y, hole.diameter]),
  });
}

function getBoardModelForBuild() {
  const key = boardModelKey();
  const reused = boardCache?.key === key;
  if (!reused) {
    if (boardCache) boardCache.model.geometry.dispose();
    boardCache = {
      key,
      model: buildBoardModel(state),
    };
  }
  return { model: boardCache.model, reused };
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
      const board = getBoardModelForBuild();
      nextModel = buildCaseModel(state, { boardModel: board.model });
      nextModel.boardFromCache = board.reused;
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
  updateBom(result.mounts.length);
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
  dom.previewCutButton.disabled = unavailable;
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

  const isSideView = SIDE_VIEWS.includes(view);
  dom.viewMenuLabel.textContent = isSideView ? SIDE_VIEW_LABELS[view] : '侧视';
  dom.viewMenuButton.classList.toggle('is-active', isSideView);
  const actionLabel = isSideView
    ? `当前${SIDE_VIEW_LABELS[view]}，选择其他侧视方向`
    : '选择侧视方向';
  dom.viewMenuButton.setAttribute('aria-label', actionLabel);
  dom.viewMenuButton.title = actionLabel;
}

function setViewMenuOpen(open, { focusFirst = false } = {}) {
  const next = Boolean(open);
  dom.viewMenu.hidden = !next;
  dom.viewMenuButton.setAttribute('aria-expanded', String(next));
  if (next && focusFirst) {
    const activeItem = dom.viewMenu.querySelector('.view-menu-item.active');
    const firstItem = dom.viewMenu.querySelector('.view-menu-item');
    requestAnimationFrame(() => (activeItem || firstItem)?.focus());
  }
}

function requestView(view) {
  setActiveView(view);
  setViewMenuOpen(false);
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

/* ── Cut-sheet preview ──────────────────────────────────────────────────── */

function openSheetPreview() {
  if (!ensureModelReady()) return;
  try {
    const bounds = cutSheetBounds(model);
    dom.sheetSize.textContent =
      `${formatNumber(bounds.sheetWidth)} × ${formatNumber(bounds.sheetHeight)} mm`;
    const svg = buildCutSvg(model).replace(/^<\?xml[^>]*\?>\s*/i, '');
    dom.sheetPreview.innerHTML = svg;
    sheetReturnFocus = document.activeElement;
    dom.sheetModal.hidden = false;
    dom.sheetModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    dom.sheetCloseButton.focus();
  } catch (error) {
    toast('切割排版预览失败', error?.message || String(error), 'error');
  }
}

function closeSheetPreview() {
  if (dom.sheetModal.hidden) return;
  dom.sheetModal.hidden = true;
  dom.sheetModal.setAttribute('aria-hidden', 'true');
  dom.sheetPreview.innerHTML = '';
  document.body.classList.remove('sheet-open');
  if (sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') {
    sheetReturnFocus.focus();
  }
  sheetReturnFocus = null;
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
    return false;
  }
  try {
    const documentData = touchDocument();
    const json = `${JSON.stringify(documentData, null, 2)}\n`;
    const filename = `${caseFileStem(state)}.case.json`;
    downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
    saveNow();
    toast('参数文件已导出', `${filename} · ${formatBytes(new Blob([json]).size)}`);
    return true;
  } catch (error) {
    toast('参数导出失败', error?.message || String(error), 'error');
    return false;
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
    activeProjectId = null;
    writeActiveProjectId(null);
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
    closeProjectLauncher({ restoreFocus: false });

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
  dom.autosaveLabel.textContent = '正在保存草稿…';
  dom.autosaveLabel.classList.remove('is-saved');
  saveTimer = window.setTimeout(saveNow, 320);
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    const documentData = toCaseDocument(state, { touch: false });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documentData));
    dom.autosaveLabel.textContent = '草稿已保存';
    dom.autosaveLabel.classList.add('is-saved');
    clearTimeout(savedLabelTimer);
    savedLabelTimer = window.setTimeout(() => {
      dom.autosaveLabel.textContent = '草稿自动保存';
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

  dom.screwSpecSelect.addEventListener('change', () => {
    const spec = screwSpecById(dom.screwSpecSelect.value);
    if (!spec || state.enclosure.screw_clearance === spec.clearance) return;
    state.enclosure.screw_clearance = spec.clearance;
    updateDerivedUi();
    stateChanged();
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
  dom.openingList.addEventListener('focusin', (event) => {
    const card = event.target.closest('.opening-card');
    if (card) selectOpening(Number(card.dataset.openingIndex));
  });
  dom.addOpeningButton.addEventListener('click', addOpening);
  dom.addPresetOpeningButton.addEventListener('click', addPresetOpening);
  dom.openingSideTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-opening-side]');
    if (tab) setActiveOpeningSide(tab.dataset.openingSide);
  });
  dom.panelMap.addEventListener('pointerdown', startOpeningDrag);
  dom.panelMap.addEventListener('pointermove', moveOpeningDrag);
  dom.panelMap.addEventListener('pointerup', endOpeningDrag);
  dom.panelMap.addEventListener('pointercancel', endOpeningDrag);
  dom.copyBomButton.addEventListener('click', copyBomText);

  dom.presetRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset-id]');
    if (button) requestPresetLoad(button.dataset.presetId);
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

  dom.saveProjectButton.addEventListener('click', saveCurrentProject);
  dom.projectsButton.addEventListener('click', openProjectLauncher);
  dom.launcherCloseButton.addEventListener('click', () => closeProjectLauncher());
  dom.launcherContinueButton.addEventListener('click', () => closeProjectLauncher());
  dom.launcherModal.addEventListener('click', (event) => {
    if (event.target === dom.launcherModal) closeProjectLauncher();
  });
  dom.launcherSaveButton.addEventListener('click', saveCurrentProject);
  dom.launcherNewButton.addEventListener('click', requestNewProject);
  dom.launcherImportButton.addEventListener('click', () => dom.fileInput.click());
  dom.launcherPresets.addEventListener('click', (event) => {
    const button = event.target.closest('[data-launcher-preset]');
    if (button) requestPresetLoad(button.dataset.launcherPreset);
  });
  dom.launcherProjects.addEventListener('click', (event) => {
    const open = event.target.closest('[data-open-project]');
    if (open) {
      requestOpenProject(open.dataset.openProject);
      return;
    }
    const remove = event.target.closest('[data-delete-project]');
    if (remove) {
      requestDeleteProject(remove.dataset.deleteProject);
      return;
    }
    const confirmDelete = event.target.closest('[data-confirm-delete]');
    if (confirmDelete) {
      deleteProjectFromLibrary(confirmDelete.dataset.confirmDelete);
      return;
    }
    if (event.target.closest('[data-cancel-delete]')) {
      pendingDeleteProjectId = null;
      renderProjectLauncher();
    }
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
  dom.projectCancelButton.addEventListener('click', () => closeProjectDialog());
  dom.projectCloseButton.addEventListener('click', () => closeProjectDialog());
  dom.projectDirectButton.addEventListener('click', confirmProjectDirect);
  dom.projectExportButton.addEventListener('click', confirmProjectWithExport);
  dom.projectModal.addEventListener('click', (event) => {
    if (event.target === dom.projectModal) closeProjectDialog();
  });
  dom.previewCutButton.addEventListener('click', openSheetPreview);
  dom.sheetCloseButton.addEventListener('click', closeSheetPreview);
  dom.sheetModal.addEventListener('click', (event) => {
    if (event.target === dom.sheetModal) closeSheetPreview();
  });
  dom.sheetExportSvgButton.addEventListener('click', exportCutSvg);
  dom.sheetExportDxfButton.addEventListener('click', exportCutDxf);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dom.projectModal.hidden) {
      event.preventDefault();
      closeProjectDialog();
      return;
    }
    if (!dom.launcherModal.hidden) {
      event.preventDefault();
      closeProjectLauncher();
      return;
    }
    if (!dom.sheetModal.hidden) {
      event.preventDefault();
      closeSheetPreview();
      return;
    }
    if (!dom.viewMenu.hidden) {
      event.preventDefault();
      setViewMenuOpen(false);
      dom.viewMenuButton.focus();
    }
  });

  dom.viewButtons.forEach((button) => {
    button.addEventListener('click', () => requestView(button.dataset.view));
  });
  dom.viewMenuButton.addEventListener('click', () => {
    setViewMenuOpen(dom.viewMenu.hidden, { focusFirst: true });
  });
  dom.viewMenu.addEventListener('keydown', (event) => {
    const items = [...dom.viewMenu.querySelectorAll('.view-menu-item')];
    const current = items.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      next = (current + 1) % items.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      next = (current - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = items.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (dom.viewMenu.hidden) return;
    if (!event.target.closest('.view-switch')) setViewMenuOpen(false);
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
              connectorShaftCount: model.hardware.connectorShafts.length,
              screwShaftCount: model.hardware.screwHeads.length,
              boardFromCache: model.boardFromCache,
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
