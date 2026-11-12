/**
 * BoardForge schema, defaults and validation.
 *
 * Coordinate convention (shared by the UI, the preview and both exports):
 *   - Origin is the centre of the board.
 *   - +X points right, +Y points "forward" (up in the top view).
 *   - +Z is the board thickness; the board is centred on Z = 0.
 *   - All dimensions are millimetres.
 */

export const FORMAT_VERSION = 1;
export const MAX_HOLES = 32;

export const LIMITS = Object.freeze({
  length: { min: 10, max: 500, step: 0.1 },
  width: { min: 10, max: 500, step: 0.1 },
  thickness: { min: 0.2, max: 50, step: 0.1 },
  cornerRadius: { min: 0, max: 250, step: 0.1 },
  holeX: { min: -500, max: 500, step: 0.1 },
  holeY: { min: -500, max: 500, step: 0.1 },
  holeDiameter: { min: 0.1, max: 100, step: 0.1 },
});

export const DEFAULT_BOARD = Object.freeze({
  length: 85,
  width: 56,
  thickness: 1.6,
  corner_radius: 3,
  color: '#1a5f2a',
});

export function defaultHolesForBoard(length = DEFAULT_BOARD.length, width = DEFAULT_BOARD.width) {
  const minSide = Math.max(1, Math.min(length, width));
  const inset = Math.min(3.5, minSide * 0.18);
  const diameter = Math.min(2.7, minSide * 0.08);
  const x = Math.max(0, length / 2 - inset);
  const y = Math.max(0, width / 2 - inset);
  return [
    { x: -x, y: -y, diameter },
    { x, y: -y, diameter },
    { x, y, diameter },
    { x: -x, y, diameter },
  ];
}

export function createDefaultState() {
  const now = localISOString();
  return {
    version: FORMAT_VERSION,
    name: '未命名开发板',
    units: 'mm',
    board: { ...DEFAULT_BOARD },
    holes: defaultHolesForBoard(),
    meta: { created: now, updated: now },
  };
}

export function createStateFromPreset(preset) {
  const now = localISOString();
  return normalizeState({
    version: FORMAT_VERSION,
    name: preset.name,
    units: 'mm',
    board: preset.board,
    holes: preset.holes,
    meta: { created: now, updated: now },
  }).state;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function maxCornerRadius(length, width) {
  return Math.max(0, Math.min(length, width) / 2);
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '0';
  return String(round(Number(value), digits));
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeColor(value) {
  if (typeof value !== 'string') return DEFAULT_BOARD.color;
  let color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(color)) {
    color = '#' + color.slice(1).split('').map((c) => c + c).join('');
  }
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_BOARD.color;
}

function toFiniteNumber(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTimestamp(value, fallback) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return value;
}

/**
 * Turn an arbitrary (possibly older / incomplete / slightly broken) document
 * into a safe internal state. Never throws for field-level issues; the caller
 * can decide to reject the document when it is not a board document at all.
 */
export function normalizeState(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new Error('参数文件的根节点必须是一个 JSON 对象。');
  }

  const warnings = [];
  const now = localISOString();
  const rawBoard = isPlainObject(raw.board) ? raw.board : {};
  const missingBoard = !isPlainObject(raw.board);
  if (missingBoard) warnings.push('文件缺少 board 字段，已使用默认板子尺寸。');

  const length = clamp(
    toFiniteNumber(rawBoard.length, DEFAULT_BOARD.length),
    LIMITS.length.min,
    LIMITS.length.max,
  );
  const width = clamp(
    toFiniteNumber(rawBoard.width, DEFAULT_BOARD.width),
    LIMITS.width.min,
    LIMITS.width.max,
  );
  const thickness = clamp(
    toFiniteNumber(rawBoard.thickness, DEFAULT_BOARD.thickness),
    LIMITS.thickness.min,
    LIMITS.thickness.max,
  );
  const cornerMax = maxCornerRadius(length, width);
  const cornerRadius = clamp(
    toFiniteNumber(rawBoard.corner_radius, Math.min(DEFAULT_BOARD.corner_radius, cornerMax)),
    0,
    cornerMax,
  );

  if (Number.isFinite(Number(rawBoard.length)) && Number(rawBoard.length) !== length) {
    warnings.push(`板子长度已限制在 ${LIMITS.length.min}–${LIMITS.length.max} mm。`);
  }
  if (Number.isFinite(Number(rawBoard.width)) && Number(rawBoard.width) !== width) {
    warnings.push(`板子宽度已限制在 ${LIMITS.width.min}–${LIMITS.width.max} mm。`);
  }
  if (Number.isFinite(Number(rawBoard.thickness)) && Number(rawBoard.thickness) !== thickness) {
    warnings.push(`板子厚度已限制在 ${LIMITS.thickness.min}–${LIMITS.thickness.max} mm。`);
  }
  if (Number.isFinite(Number(rawBoard.corner_radius)) && Number(rawBoard.corner_radius) !== cornerRadius) {
    warnings.push(`圆角半径已限制在 0–${formatNumber(cornerMax)} mm。`);
  }

  const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : FORMAT_VERSION;
  if (version > FORMAT_VERSION) {
    warnings.push(`文件版本 ${version} 高于当前支持的版本 ${FORMAT_VERSION}，已按兼容模式读取。`);
  }

  if (typeof raw.units === 'string' && raw.units.toLowerCase() !== 'mm') {
    warnings.push(`文件单位“${raw.units}”不受支持，已按毫米读取。`);
  }

  let holes;
  if (Array.isArray(raw.holes)) {
    holes = [];
    for (let index = 0; index < raw.holes.length; index += 1) {
      const entry = raw.holes[index];
      if (!isPlainObject(entry)) {
        warnings.push(`第 ${index + 1} 个安装孔格式无效，已忽略。`);
        continue;
      }
      holes.push({
        x: clamp(toFiniteNumber(entry.x, 0), LIMITS.holeX.min, LIMITS.holeX.max),
        y: clamp(toFiniteNumber(entry.y, 0), LIMITS.holeY.min, LIMITS.holeY.max),
        diameter: clamp(
          toFiniteNumber(entry.diameter, 2.7),
          LIMITS.holeDiameter.min,
          LIMITS.holeDiameter.max,
        ),
      });
    }
    if (holes.length > MAX_HOLES) {
      warnings.push(`安装孔数量超过 ${MAX_HOLES} 个，仅保留前 ${MAX_HOLES} 个。`);
      holes = holes.slice(0, MAX_HOLES);
    }
  } else {
    holes = options.emptyHoles ? [] : defaultHolesForBoard(length, width);
    if (!options.emptyHoles) warnings.push('文件缺少 holes 字段，已生成四角安装孔。');
  }

  const rawMeta = isPlainObject(raw.meta) ? raw.meta : {};
  const created = normalizeTimestamp(rawMeta.created, now);
  const updated = normalizeTimestamp(rawMeta.updated, created);

  return {
    state: {
      version: FORMAT_VERSION,
      name: typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : '未命名开发板',
      units: 'mm',
      board: {
        length: round(length),
        width: round(width),
        thickness: round(thickness),
        corner_radius: round(cornerRadius),
        color: normalizeColor(rawBoard.color),
      },
      holes,
      meta: { created, updated },
    },
    warnings,
    sourceVersion: version,
  };
}

export function toBoardDocument(state, options = {}) {
  const now = options.now || localISOString();
  const created = normalizeTimestamp(state.meta?.created, now);
  return {
    version: FORMAT_VERSION,
    name: state.name?.trim() || '未命名开发板',
    units: 'mm',
    board: {
      length: round(Number(state.board.length)),
      width: round(Number(state.board.width)),
      thickness: round(Number(state.board.thickness)),
      corner_radius: round(Number(state.board.corner_radius)),
      color: normalizeColor(state.board.color),
    },
    holes: state.holes.map((hole) => ({
      x: round(Number(hole.x)),
      y: round(Number(hole.y)),
      diameter: round(Number(hole.diameter)),
    })),
    meta: {
      created,
      updated: options.touch === false ? normalizeTimestamp(state.meta?.updated, created) : now,
    },
  };
}

/**
 * Validate the live UI state. Returns blocking errors (export must be disabled)
 * and non-blocking notes. Hole fit is analysed separately by analyseHoles().
 */
export function validateState(state) {
  const errors = [];
  const board = state?.board || {};
  checkRange(errors, board.length, LIMITS.length, '板子长度', 'length');
  checkRange(errors, board.width, LIMITS.width, '板子宽度', 'width');
  checkRange(errors, board.thickness, LIMITS.thickness, '板子厚度', 'thickness');

  const cornerMax = maxCornerRadius(Number(board.length) || 0, Number(board.width) || 0);
  checkRange(
    errors,
    board.corner_radius,
    { min: 0, max: cornerMax, step: LIMITS.cornerRadius.step },
    '圆角半径',
    'corner_radius',
  );

  for (let index = 0; index < (state?.holes?.length || 0); index += 1) {
    const hole = state.holes[index];
    checkRange(errors, hole.x, LIMITS.holeX, `第 ${index + 1} 个孔的 X 坐标`, `holes.${index}.x`);
    checkRange(errors, hole.y, LIMITS.holeY, `第 ${index + 1} 个孔的 Y 坐标`, `holes.${index}.y`);
    checkRange(
      errors,
      hole.diameter,
      LIMITS.holeDiameter,
      `第 ${index + 1} 个孔的直径`,
      `holes.${index}.diameter`,
    );
  }

  return { errors, warnings: [] };
}

function checkRange(errors, value, limit, label, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push({ field, message: `${label}必须是有效数字。` });
    return;
  }
  if (number < limit.min) {
    errors.push({ field, message: `${label}不能小于 ${formatNumber(limit.min)} mm。` });
  } else if (number > limit.max) {
    errors.push({ field, message: `${label}不能大于 ${formatNumber(limit.max)} mm。` });
  }
}

/**
 * Signed distance to a rounded rectangle. Negative means inside.
 */
export function roundedRectDistance(x, y, length, width, radius) {
  const halfL = length / 2;
  const halfW = width / 2;
  const r = clamp(radius, 0, Math.min(halfL, halfW));
  const qx = Math.abs(x) - (halfL - r);
  const qy = Math.abs(y) - (halfW - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

const CIRCLE_SAMPLES = 48;

/**
 * Classify holes for the model:
 *  - printable: fully inside the board (with a 0.05 mm safety margin)
 *  - outside: cannot be cut cleanly, skipped
 *  - overlaps: printable holes that intersect (valid, but worth mentioning)
 */
export function analyseHoles(state) {
  const { length, width, corner_radius: radius } = state.board;
  const entries = [];
  const outside = [];
  const invalid = [];

  for (let index = 0; index < state.holes.length; index += 1) {
    const hole = state.holes[index];
    const x = Number(hole.x);
    const y = Number(hole.y);
    const diameter = Number(hole.diameter);
    const r = diameter / 2;
    if (![x, y, diameter].every(Number.isFinite) || diameter <= 0) {
      invalid.push({ index, message: `第 ${index + 1} 个孔的尺寸无效，已跳过。` });
      continue;
    }

    // The whole circle must stay inside the rounded outline, not just its centre.
    let maxDistance = roundedRectDistance(x, y, length, width, radius);
    for (let sample = 0; sample < CIRCLE_SAMPLES; sample += 1) {
      const angle = (sample / CIRCLE_SAMPLES) * Math.PI * 2;
      maxDistance = Math.max(
        maxDistance,
        roundedRectDistance(
          x + Math.cos(angle) * r,
          y + Math.sin(angle) * r,
          length,
          width,
          radius,
        ),
      );
    }

    const entry = { index, x, y, diameter, radius: r, maxDistance };
    entries.push(entry);
    if (maxDistance > -0.05) {
      outside.push({
        index,
        message: `第 ${index + 1} 个孔超出了板边（含 0.05 mm 安全余量），已跳过。`,
      });
    }
  }

  const printable = entries.filter((entry) => !outside.some((item) => item.index === entry.index));
  const overlaps = [];
  for (let a = 0; a < printable.length; a += 1) {
    for (let b = a + 1; b < printable.length; b += 1) {
      const first = printable[a];
      const second = printable[b];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance < first.radius + second.radius - 0.001) {
        overlaps.push({
          a: first.index,
          b: second.index,
          message: `第 ${first.index + 1} 与第 ${second.index + 1} 个孔重叠，打印时会合并为一个开孔。`,
        });
      }
    }
  }

  return {
    entries,
    printable,
    outside,
    overlaps,
    invalid,
    warnings: [...outside, ...overlaps, ...invalid].map((item) => item.message),
  };
}

export function sanitizeFilenamePart(value, fallback = 'board') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

export function boardFileStem(state) {
  const rawName = typeof state.name === 'string' ? state.name.trim() : '';
  const isUnnamed = !rawName || rawName === '未命名开发板' || rawName.toLowerCase() === 'untitled board';
  const name = isUnnamed ? 'board' : sanitizeFilenamePart(rawName, 'board');
  return `${name}-${formatNumber(state.board.length)}x${formatNumber(state.board.width)}`;
}

export function localISOString(date = new Date()) {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

export const PRESETS = Object.freeze([
  {
    id: 'raspberry-pi-4b',
    label: '树莓派 4B',
    detail: '85 × 56 × 1.6',
    name: 'Raspberry Pi 4B',
    board: { length: 85, width: 56, thickness: 1.6, corner_radius: 3, color: '#1a5f2a' },
    holes: [
      { x: -39, y: -24.5, diameter: 2.7 },
      { x: 39, y: -24.5, diameter: 2.7 },
      { x: 39, y: 24.5, diameter: 2.7 },
      { x: -39, y: 24.5, diameter: 2.7 },
    ],
  },
  {
    id: 'raspberry-pi-zero',
    label: '树莓派 Zero',
    detail: '65 × 30 × 1.6',
    name: 'Raspberry Pi Zero',
    board: { length: 65, width: 30, thickness: 1.6, corner_radius: 2.5, color: '#1a5f2a' },
    holes: [
      { x: -29, y: -11.5, diameter: 2.7 },
      { x: 29, y: -11.5, diameter: 2.7 },
      { x: 29, y: 11.5, diameter: 2.7 },
      { x: -29, y: 11.5, diameter: 2.7 },
    ],
  },
  {
    id: 'esp32-devkit',
    label: 'ESP32 DevKit',
    detail: '49 × 25.5 × 1.6',
    name: 'ESP32 DevKit V1',
    board: { length: 49, width: 25.5, thickness: 1.6, corner_radius: 2, color: '#215c35' },
    holes: [],
  },
]);
