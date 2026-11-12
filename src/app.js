import {
  LIMITS,
  MAX_HOLES,
  PRESETS,
  analyseHoles,
  boardFileStem,
  createDefaultState,
  createStateFromPreset,
  formatNumber,
  isPlainObject,
  localISOString,
  maxCornerRadius,
  normalizeState,
  round,
  toBoardDocument,
} from './schema.js';
import { buildBoardModel, computeVolume } from './board-geometry.js';
import { BoardPreview } from './preview.js';
import { createBinaryStl } from './stl-export.js';

const STORAGE_KEY = 'boardforge.autosave.v1';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const dom = {
  boardName: document.querySelector('#boardName'),
  presetRow: document.querySelector('#presetRow'),
  autosaveLabel: document.querySelector('#autosaveLabel'),
  lengthInput: document.querySelector('#lengthInput'),
  widthInput: document.querySelector('#widthInput'),
  thicknessInput: document.querySelector('#thicknessInput'),
  cornerInput: document.querySelector('#cornerInput'),
  colorInput: document.querySelector('#colorInput'),
  colorSwatch: document.querySelector('#colorSwatch'),
  colorHex: document.querySelector('#colorHex'),
  dimensionNote: document.querySelector('#dimensionNote'),
  holeList: document.querySelector('#holeList'),
  holeCount: document.querySelector('#holeCount'),
  holesHint: document.querySelector('#holesHint'),
  addHoleButton: document.querySelector('#addHoleButton'),
  newButton: document.querySelector('#newButton'),
  importButton: document.querySelector('#importButton'),
  fileInput: document.querySelector('#fileInput'),
  exportFilename: document.querySelector('#exportFilename'),
  exportStatus: document.querySelector('#exportStatus'),
  exportJsonButton: document.querySelector('#exportJsonButton'),
  exportStlButton: document.querySelector('#exportStlButton'),
  previewCanvas: document.querySelector('#previewCanvas'),
  previewName: document.querySelector('#previewName'),
  modelStatus: document.querySelector('#modelStatus'),
  modelStatusText: document.querySelector('#modelStatusText'),
  statSize: document.querySelector('#statSize'),
  statTriangles: document.querySelector('#statTriangles'),
  statVolume: document.querySelector('#statVolume'),
  statTime: document.querySelector('#statTime'),
  sceneNotices: document.querySelector('#sceneNotices'),
  canvasLoading: document.querySelector('#canvasLoading'),
  dropOverlay: document.querySelector('#dropOverlay'),
  fatalCard: document.querySelector('#fatalCard'),
  fatalMessage: document.querySelector('#fatalMessage'),
  toastRoot: document.querySelector('#toastRoot'),
  viewButtons: Array.from(document.querySelectorAll('[data-view]')),
};

const numericInputs = Array.from(document.querySelectorAll('input[data-path]'));
const TRASH_ICON = `
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 6h12M8 3.5h4M6 6l.5 10h7L14 6M8.5 9v4.5M11.5 9v4.5"/>
  </svg>`;

let state = createDefaultState();
let savedStateRestored = false;
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
const pendingInvalid = new Set();

/* ── Boot ───────────────────────────────────────────────────────────────── */

bootstrap();

function bootstrap() {
  const restored = readStoredState();
  if (restored) {
    state = restored.state;
    savedStateRestored = true;
  }
  selectedPresetId = detectPresetId(state);

  renderPresets();
  syncFormFromState();
  bindEvents();
  exposeDebugApi();

  requestAnimationFrame(() => {
    try {
      preview = new BoardPreview(dom.previewCanvas, {
        onContextLost: (message) => showFatal(message),
      });
      if (preview) {
        preview.setColor(state.board.color);
        preview.setDimensions(
          state.board.length,
          state.board.width,
          state.board.thickness,
        );
      }
    } catch (error) {
      showFatal(error?.message || '无法创建 WebGL 上下文。');
      setModelStatus('error', 'WebGL 不可用');
      setExportStatus('3D 预览不可用', 'error');
      return;
    }

    buildNow({ fit: true, initial: true });
    if (savedStateRestored) {
      window.setTimeout(() => {
        toast('已恢复上次参数', '数据保存在当前浏览器中', 'success');
      }, 550);
    }
  });
}

/* ── Form & state ───────────────────────────────────────────────────────── */

function syncFormFromState() {
  dom.boardName.value = state.name;
  dom.lengthInput.value = inputValue(state.board.length);
  dom.widthInput.value = inputValue(state.board.width);
  dom.thicknessInput.value = inputValue(state.board.thickness);
  dom.cornerInput.value = inputValue(state.board.corner_radius);
  dom.colorInput.value = state.board.color;
  updateColorUi();
  updateCornerLimit({ clampValue: false });
  renderHoles();
  updateNameUi();
  updateFilenameUi();
  refreshPresetActive();
  setExportStatus('准备就绪');
  clearAllFieldErrors();
}

function updateNameUi() {
  const name = state.name.trim() || '未命名开发板';
  dom.previewName.textContent = name;
  updateFilenameUi();
}

function updateFilenameUi() {
  dom.exportFilename.textContent = boardFileStem(state);
}

function updateColorUi() {
  dom.colorSwatch.style.background = state.board.color;
  dom.colorHex.textContent = state.board.color.toUpperCase();
  dom.colorInput.value = state.board.color;
}

function updateCornerLimit({ clampValue = true } = {}) {
  const maximum = Math.max(0, round(maxCornerRadius(
    Number(state.board.length),
    Number(state.board.width),
  ), 2));
  dom.cornerInput.max = String(maximum);
  dom.dimensionNote.textContent = `圆角上限 ${formatNumber(maximum)} mm，取短边的一半。`;

  if (clampValue && state.board.corner_radius > maximum) {
    state.board.corner_radius = maximum;
    dom.cornerInput.value = inputValue(maximum);
    pendingInvalid.delete('board.corner_radius');
    markFieldInvalid(dom.cornerInput, false);
    stateChanged();
  }
}

function inputValue(value) {
  const numeric = round(Number(value), 3);
  return String(Object.is(numeric, -0) ? 0 : numeric);
}

function limitForPath(path) {
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

function setBoardNumber(path, value) {
  const key = path.split('.').pop();
  state.board[key] = value;
}

function readBoardNumber(path) {
  return Number(state.board[path.split('.').pop()]);
}

function handleNumericInput(input) {
  const path = input.dataset.path;
  const limit = limitForPath(path);
  if (!limit) return;
  const raw = input.value.trim();
  const value = Number(raw);
  const valid = raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;

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
  updateFilenameUi();
  stateChanged();
}

function normalizeNumericInput(input) {
  const path = input.dataset.path;
  const limit = limitForPath(path);
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
  updateFilenameUi();
  stateChanged();
}

function markFieldInvalid(input, invalid) {
  if (!input) return;
  input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
  const shell = input.closest('.input-shell') || input.closest('.hole-field');
  if (shell) shell.classList.toggle('is-invalid', invalid);
}

function clearAllFieldErrors() {
  pendingInvalid.clear();
  numericInputs.forEach((input) => markFieldInvalid(input, false));
  dom.holeList.querySelectorAll('input').forEach((input) => markFieldInvalid(input, false));
}

/* ── Holes ──────────────────────────────────────────────────────────────── */

function renderHoles() {
  if (state.holes.length === 0) {
    dom.holeList.innerHTML = `
      <div class="hole-empty">
        <strong>还没有安装孔</strong>
        <span>可以留空，或添加安装孔用于固定板子</span>
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
            ${TRASH_ICON}
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
  const valid = raw !== '' && Number.isFinite(value) && value >= limit.min && value <= limit.max;
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
  stateChanged();
}

function addHole() {
  if (state.holes.length >= MAX_HOLES) return;
  state.holes.push({ x: 0, y: 0, diameter: 2.7 });
  selectedPresetId = null;
  clearPendingHoleFields();
  renderHoles();
  refreshPresetActive();
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
  stateChanged();
}

function clearPendingHoleFields() {
  for (const path of [...pendingInvalid]) {
    if (path.startsWith('holes.')) pendingInvalid.delete(path);
  }
}

function refreshHoleWarnings() {
  const analysis = analyseHoles(state);
  const outsideIndices = new Set(analysis.outside.map((item) => item.index));
  const overlapIndices = new Set();
  for (const overlap of analysis.overlaps) {
    overlapIndices.add(overlap.a);
    overlapIndices.add(overlap.b);
  }

  dom.holeList.querySelectorAll('.hole-row').forEach((row) => {
    const index = Number(row.dataset.index);
    const warning = outsideIndices.has(index)
      ? '这个孔超出板边，生成时会被跳过。'
      : overlapIndices.has(index)
        ? '这个孔与其它孔重叠，会在模型上合并。'
        : '';
    row.classList.toggle('has-warning', Boolean(warning));
    row.title = warning;
  });

  const messages = [];
  if (analysis.outside.length > 0) {
    messages.push(`${analysis.outside.length} 个孔超出板边，生成时已跳过。`);
  }
  if (analysis.overlaps.length > 0) {
    messages.push(`${analysis.overlaps.length} 组孔位重叠，将在模型上合并为一个开孔。`);
  }
  dom.holesHint.hidden = messages.length === 0;
  dom.holesHint.textContent = messages.join(' ');
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
  state = createStateFromPreset(preset);
  selectedPresetId = preset.id;
  syncFormFromState();
  selectedPresetId = preset.id;
  refreshPresetActive();
  if (preview) preview.setColor(state.board.color);
  scheduleBuild({ fit: true, immediate: true });
  queueSave();
  toast(`已载入 ${preset.label}`, `${preset.detail} mm · ${preset.holes.length} 个安装孔`);
}

/* ── Build & preview ────────────────────────────────────────────────────── */

function stateChanged({ rebuild = true } = {}) {
  queueSave();
  if (rebuild) {
    scheduleBuild();
  } else {
    updateBlockedUi();
  }
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
    immediate ? 0 : 48,
  );
}

function buildNow({ fit = false, generation = buildVersion, initial = false } = {}) {
  if (!preview || previewFailed) return;
  const requestGeneration = generation;
  isBuilding = true;
  if (initial) setModelStatus('busy', '正在生成模型');
  setExportStatus('正在生成模型…');

  requestAnimationFrame(() => {
    if (requestGeneration !== buildVersion && !initial) {
      return;
    }

    try {
      const nextModel = buildBoardModel(state);
      model = nextModel;
      modelDirty = false;
      pendingFit = false;
      preview.setGeometry(nextModel.geometry, {
        length: state.board.length,
        width: state.board.width,
        thickness: state.board.thickness,
        fit: fit || initial,
      });
      preview.setColor(state.board.color);
      updateModelUi(nextModel);
      dom.canvasLoading.classList.add('is-hidden');
    } catch (error) {
      console.error('[BoardForge] model build failed', error);
      modelDirty = true;
      setModelStatus('error', '模型生成失败 · 请检查参数');
      setExportStatus('生成失败', 'error');
      dom.canvasLoading.classList.add('is-hidden');
      dom.fatalCard.hidden = true;
      toast('模型生成失败', error?.message || String(error), 'error');
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
    if (!model) setModelStatus('busy', '正在生成模型');
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
  const analysis = result.analysis;
  const outsideCount = analysis.outside.length;
  const overlapCount = analysis.overlaps.length;
  const volume = Math.abs(computeVolume(result.geometry)) / 1000;

  dom.statSize.textContent =
    `${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} × ` +
    `${formatNumber(state.board.thickness)} mm`;
  dom.statTriangles.textContent = result.triangles.toLocaleString('zh-CN');
  dom.statVolume.textContent = `${volume.toFixed(2)} cm³`;
  dom.statTime.textContent = `${Math.round(result.buildMs)} ms`;

  if (!result.watertight) {
    setModelStatus('error', '几何未通过水密检查 · 已阻止 STL 导出');
    setExportStatus('模型异常', 'error');
  } else if (outsideCount > 0) {
    setModelStatus('warning', `${outsideCount} 个孔越界 · 已跳过`, 'warning');
    setExportStatus(`${outsideCount} 个孔已跳过`, 'warning');
  } else if (overlapCount > 0) {
    setModelStatus('warning', '孔位重叠 · 已合并开孔', 'warning');
    setExportStatus('孔位已合并 · 可导出', 'warning');
  } else {
    setModelStatus('good', '水密 · 可打印');
    setExportStatus('可导出 · STL / JSON');
  }

  renderSceneNotices(result);
  refreshHoleWarnings();
  updateFilenameUi();
  refreshPresetActive();
  updateActionButtons();
}

function renderSceneNotices(result) {
  const notices = [];
  if (result.analysis.outside.length > 0) {
    notices.push(...result.analysis.outside.slice(0, 2).map((item) => item.message));
  }
  if (result.analysis.overlaps.length > 0) {
    notices.push(
      ...result.analysis.overlaps.slice(0, 2).map((item) => item.message),
    );
  }
  if (result.fallbackReason && result.fallbackReason !== '') {
    notices.push(result.fallbackReason);
  }

  if (notices.length === 0) {
    dom.sceneNotices.hidden = true;
    dom.sceneNotices.innerHTML = '';
    return;
  }

  const visible = notices.slice(0, 3);
  dom.sceneNotices.innerHTML = visible
    .map((message) => `<span class="scene-notice">${escapeHtml(message)}</span>`)
    .join('');
  dom.sceneNotices.hidden = false;
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
    setExportStatus('等待模型', 'warning');
    return;
  }
  if (!model.watertight) {
    setExportStatus('模型异常 · 禁止 STL 导出', 'error');
    return;
  }
  if (modelDirty || isBuilding) {
    setExportStatus('正在更新…');
    return;
  }
  if (model.analysis.outside.length > 0) {
    setExportStatus(`${model.analysis.outside.length} 个孔已跳过`, 'warning');
  } else if (model.analysis.overlaps.length > 0) {
    setExportStatus('孔位已合并 · 可导出', 'warning');
  } else {
    setExportStatus('可导出 · STL / JSON');
  }
}

function updateActionButtons() {
  const blocked = pendingInvalid.size > 0;
  dom.exportJsonButton.disabled = blocked;
  dom.exportStlButton.disabled =
    blocked || !model || !model.watertight || modelDirty || isBuilding || previewFailed;
}

/* ── Views ──────────────────────────────────────────────────────────────── */

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

/* ── Exports ────────────────────────────────────────────────────────────── */

function exportBoardJson() {
  if (pendingInvalid.size > 0) {
    toast('请先修正参数', '高亮字段的数值无效或超出范围。', 'error');
    return;
  }
  try {
    const documentData = toBoardDocument(state, { now: localISOString() });
    state.meta.updated = documentData.meta.updated;
    const json = `${JSON.stringify(documentData, null, 2)}\n`;
    const filename = `${boardFileStem(state)}.board.json`;
    downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), filename);
    saveNow();
    toast('参数文件已导出', `${filename} · ${formatBytes(new Blob([json]).size)}`);
  } catch (error) {
    toast('参数导出失败', error?.message || String(error), 'error');
  }
}

function exportStl() {
  if (pendingInvalid.size > 0) {
    toast('请先修正参数', '高亮字段的数值无效或超出范围。', 'error');
    return;
  }
  if (!model || !model.watertight) {
    toast('无法导出 STL', '当前模型没有通过水密检查。', 'error');
    return;
  }
  if (modelDirty || isBuilding) {
    toast('模型尚未更新完成', '请稍等片刻再导出。', 'warning');
    return;
  }

  try {
    const buffer = createBinaryStl(model.geometry, { name: state.name });
    const filename = `${boardFileStem(state)}.stl`;
    downloadBlob(new Blob([buffer], { type: 'model/stl' }), filename);
    const notes = model.analysis.outside.length > 0
      ? ` · 已跳过 ${model.analysis.outside.length} 个越界孔`
      : '';
    toast(
      'STL 已导出',
      `${model.triangles.toLocaleString('zh-CN')} 个三角面 · ${formatBytes(buffer.byteLength)}${notes}`,
      model.analysis.outside.length > 0 ? 'warning' : 'success',
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ── Import ─────────────────────────────────────────────────────────────── */

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
    if (!isPlainObject(raw)) {
      throw new Error('参数文件的根节点必须是一个 JSON 对象。');
    }
    if (!isPlainObject(raw.board) && !Array.isArray(raw.holes)) {
      throw new Error('这个 JSON 不包含 board 或 holes 字段，不像是 .board.json 参数文件。');
    }

    const { state: importedState, warnings } = normalizeState(raw);
    pendingInvalid.clear();
    state = importedState;
    selectedPresetId = detectPresetId(state);
    syncFormFromState();
    if (preview) preview.setColor(state.board.color);
    scheduleBuild({ fit: true, immediate: true });
    queueSave();

    if (warnings.length > 0) {
      toast('参数已导入，已自动修正部分字段', warnings.join(' '), 'warning');
    } else {
      toast(
        '参数已导入',
        `${state.name} · ${formatNumber(state.board.length)} × ${formatNumber(state.board.width)} mm`,
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    const result = normalizeState(parsed, { emptyHoles: true });
    return result.state ? result : null;
  } catch {
    return null;
  }
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
    const documentData = toBoardDocument(state, { touch: false });
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

/* ── Toasts & fatal state ───────────────────────────────────────────────── */

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
  dom.boardName.addEventListener('input', () => {
    state.name = dom.boardName.value;
    updateNameUi();
    queueSave();
  });
  dom.boardName.addEventListener('blur', () => {
    if (!state.name.trim()) {
      state.name = '未命名开发板';
      dom.boardName.value = state.name;
    }
    state.name = state.name.trim().slice(0, 80);
    dom.boardName.value = state.name;
    updateNameUi();
    queueSave();
  });

  numericInputs.forEach((input) => {
    input.addEventListener('input', () => handleNumericInput(input));
    input.addEventListener('blur', () => normalizeNumericInput(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
  });

  dom.cornerInput.addEventListener('wheel', (event) => event.preventDefault(), {
    passive: false,
  });

  dom.colorInput.addEventListener('input', () => {
    state.board.color = dom.colorInput.value;
    updateColorUi();
    if (preview) preview.setColor(state.board.color);
    queueSave();
  });

  dom.holeList.addEventListener('input', (event) => {
    const input = event.target.closest('input[data-hole]');
    if (input) handleHoleInput(input);
  });
  dom.holeList.addEventListener('blur', (event) => {
    const input = event.target.closest('input[data-hole]');
    if (input) normalizeHoleInput(input);
  }, true);
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

  dom.presetRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset-id]');
    if (button) loadPreset(button.dataset.presetId);
  });

  dom.newButton.addEventListener('click', () => {
    pendingInvalid.clear();
    state = createDefaultState();
    selectedPresetId = detectPresetId(state);
    syncFormFromState();
    if (preview) preview.setColor(state.board.color);
    scheduleBuild({ fit: true, immediate: true });
    queueSave();
    toast('已新建默认板型', '85 × 56 × 1.6 mm · 四个安装孔');
  });

  dom.importButton.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files?.[0];
    if (file) importBoardFile(file);
  });

  dom.exportJsonButton.addEventListener('click', exportBoardJson);
  dom.exportStlButton.addEventListener('click', exportStl);

  dom.viewButtons.forEach((button) => {
    button.addEventListener('click', () => requestView(button.dataset.view));
  });
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
      if (event.shiftKey) exportStl();
      else exportBoardJson();
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
      getState: () => toBoardDocument(state, { touch: false }),
      getDiagnostics: () =>
        model
          ? {
              construction: model.construction,
              triangles: model.triangles,
              watertight: model.watertight,
              buildMs: model.buildMs,
              boundaryEdges: model.diagnostics.boundaryEdges,
              nonManifoldEdges: model.diagnostics.nonManifoldEdges,
              degenerate: model.diagnostics.degenerate,
              outsideHoles: model.analysis.outside.length,
              overlapCount: model.analysis.overlaps.length,
              warnings: model.warnings,
              bbox: model.geometry.boundingBox
                ? {
                    min: model.geometry.boundingBox.min.toArray(),
                    max: model.geometry.boundingBox.max.toArray(),
                  }
                : null,
            }
          : null,
      getFilename: () => boardFileStem(state),
      isBusy: () => isBuilding || modelDirty,
      setView: (view) => requestView(view),
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
