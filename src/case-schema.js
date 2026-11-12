/**
 * Enclosure-first document schema.
 *
 * Board dimensions and holes remain compatible with the original `.board.json`
 * data. Enclosure settings and side-panel openings are stored alongside them in
 * a version-2 `.case.json` document.
 */

import {
  DEFAULT_BOARD,
  FORMAT_VERSION,
  MAX_HOLES,
  PRESETS,
  analyseHoles,
  createDefaultState,
  createStateFromPreset,
  isPlainObject,
  localISOString,
  maxCornerRadius,
  normalizeState,
  round,
} from './schema.js';

export const CASE_VERSION = 2;
export const CASE_FORMAT = 'boardforge-case';
export const MAX_OPENINGS = 32;

export const CASE_LIMITS = Object.freeze({
  panelThickness: { min: 1, max: 10, step: 0.1 },
  clearance: { min: 1, max: 60, step: 0.5 },
  bottomGap: { min: 0, max: 100, step: 0.5 },
  topGap: { min: 2, max: 180, step: 0.5 },
  screwClearance: { min: 2, max: 8, step: 0.1 },
  fit: { min: 0, max: 0.8, step: 0.05 },
  ventCount: { min: 1, max: 14, step: 1 },
  ventWidth: { min: 0.6, max: 12, step: 0.1 },
  ventLength: { min: 4, max: 260, step: 0.5 },
  openingU: { min: -300, max: 300, step: 0.5 },
  openingV: { min: -200, max: 200, step: 0.5 },
  openingSize: { min: 1, max: 300, step: 0.5 },
});

export const DEFAULT_ENCLOSURE = Object.freeze({
  panel_thickness: 3,
  clearance: 6,
  bottom_gap: 8,
  top_gap: 20,
  screw_clearance: 3.4,
  fit: 0.15,
  vent: {
    enabled: true,
    count: 5,
    slot_width: 2.4,
    slot_length: 28,
  },
});

export const SIDE_LABELS = Object.freeze({
  front: '前面板',
  back: '后面板',
  left: '左面板',
  right: '右面板',
});

export const OPENING_SIDES = Object.freeze(['front', 'back', 'left', 'right']);
export const OPENING_SHAPES = Object.freeze(['rect', 'circle']);

function finite(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanEnclosure(raw, warnings) {
  const source = isPlainObject(raw) ? raw : {};
  const rawVent = isPlainObject(source.vent) ? source.vent : {};

  const values = {
    panel_thickness: clamp(
      round(finite(source.panel_thickness, DEFAULT_ENCLOSURE.panel_thickness), 3),
      CASE_LIMITS.panelThickness.min,
      CASE_LIMITS.panelThickness.max,
    ),
    clearance: clamp(
      round(finite(source.clearance, DEFAULT_ENCLOSURE.clearance), 3),
      CASE_LIMITS.clearance.min,
      CASE_LIMITS.clearance.max,
    ),
    bottom_gap: clamp(
      round(finite(source.bottom_gap, DEFAULT_ENCLOSURE.bottom_gap), 3),
      0,
      CASE_LIMITS.bottomGap.max,
    ),
    top_gap: clamp(
      round(finite(source.top_gap, DEFAULT_ENCLOSURE.top_gap), 3),
      CASE_LIMITS.topGap.min,
      CASE_LIMITS.topGap.max,
    ),
    screw_clearance: clamp(
      round(finite(source.screw_clearance, DEFAULT_ENCLOSURE.screw_clearance), 3),
      CASE_LIMITS.screwClearance.min,
      CASE_LIMITS.screwClearance.max,
    ),
    fit: clamp(
      round(finite(source.fit, DEFAULT_ENCLOSURE.fit), 3),
      0,
      CASE_LIMITS.fit.max,
    ),
    vent: {
      enabled:
        typeof rawVent.enabled === 'boolean'
          ? rawVent.enabled
          : DEFAULT_ENCLOSURE.vent.enabled,
      count: Math.round(
        clamp(
          finite(rawVent.count, DEFAULT_ENCLOSURE.vent.count),
          CASE_LIMITS.ventCount.min,
          CASE_LIMITS.ventCount.max,
        ),
      ),
      slot_width: clamp(
        round(finite(rawVent.slot_width, DEFAULT_ENCLOSURE.vent.slot_width), 3),
        CASE_LIMITS.ventWidth.min,
        CASE_LIMITS.ventWidth.max,
      ),
      slot_length: clamp(
        round(finite(rawVent.slot_length, DEFAULT_ENCLOSURE.vent.slot_length), 3),
        CASE_LIMITS.ventLength.min,
        CASE_LIMITS.ventLength.max,
      ),
    },
  };

  if (!isPlainObject(raw) && raw !== undefined) {
    warnings.push('enclosure 字段格式无效，已使用默认外壳参数。');
  }

  const comparisons = [
    [source.panel_thickness, values.panel_thickness],
    [source.clearance, values.clearance],
    [source.bottom_gap, values.bottom_gap],
    [source.top_gap, values.top_gap],
    [source.screw_clearance, values.screw_clearance],
    [source.fit, values.fit],
    [rawVent.count, values.vent.count],
    [rawVent.slot_width, values.vent.slot_width],
    [rawVent.slot_length, values.vent.slot_length],
  ];
  if (
    comparisons.some(
      ([rawValue, cleanValue]) =>
        rawValue !== undefined &&
        Number.isFinite(Number(rawValue)) &&
        Number(rawValue) !== cleanValue,
    )
  ) {
    warnings.push('部分外壳参数超出允许范围，已自动限制。');
  }

  return values;
}

function cleanOpening(raw, index, warnings) {
  if (!isPlainObject(raw)) {
    warnings.push(`第 ${index + 1} 个开孔格式无效，已忽略。`);
    return null;
  }
  const side = OPENING_SIDES.includes(raw.side) ? raw.side : 'front';
  const shape = OPENING_SHAPES.includes(raw.shape) ? raw.shape : 'rect';
  const u = clamp(
    round(finite(raw.u, 0), 3),
    CASE_LIMITS.openingU.min,
    CASE_LIMITS.openingU.max,
  );
  const v = clamp(
    round(finite(raw.v, 0), 3),
    CASE_LIMITS.openingV.min,
    CASE_LIMITS.openingV.max,
  );

  if (shape === 'circle') {
    return {
      side,
      shape,
      u,
      v,
      diameter: clamp(
        round(finite(raw.diameter, 12), 3),
        CASE_LIMITS.openingSize.min,
        CASE_LIMITS.openingSize.max,
      ),
    };
  }

  return {
    side,
    shape,
    u,
    v,
    width: clamp(
      round(finite(raw.width, 16), 3),
      CASE_LIMITS.openingSize.min,
      CASE_LIMITS.openingSize.max,
    ),
    height: clamp(
      round(finite(raw.height, 9), 3),
      CASE_LIMITS.openingSize.min,
      CASE_LIMITS.openingSize.max,
    ),
  };
}

export function createDefaultCaseState() {
  const board = createDefaultState();
  const now = localISOString();
  return {
    version: CASE_VERSION,
    format: CASE_FORMAT,
    name: '未命名开发板外壳',
    units: 'mm',
    board: { ...board.board },
    holes: board.holes.map((hole) => ({ ...hole })),
    enclosure: {
      ...DEFAULT_ENCLOSURE,
      vent: { ...DEFAULT_ENCLOSURE.vent },
    },
    openings: [],
    meta: { created: now, updated: now },
  };
}

export function createCaseFromPreset(preset) {
  if (!preset) return createDefaultCaseState();
  const board = createStateFromPreset(preset);
  const now = localISOString();
  return {
    version: CASE_VERSION,
    format: CASE_FORMAT,
    name: `${preset.name} 外壳`,
    units: 'mm',
    board: { ...board.board },
    holes: board.holes.map((hole) => ({ ...hole })),
    enclosure: {
      ...DEFAULT_ENCLOSURE,
      vent: { ...DEFAULT_ENCLOSURE.vent },
    },
    openings: [],
    meta: { created: now, updated: now },
  };
}

export function normalizeCaseState(raw, options = {}) {
  if (!isPlainObject(raw)) {
    throw new Error('参数文件的根节点必须是一个 JSON 对象。');
  }

  const warnings = [];
  const now = localISOString();
  const isCaseDocument =
    raw.format === CASE_FORMAT || isPlainObject(raw.enclosure) || Array.isArray(raw.openings);
  const rawBoard = isPlainObject(raw.board) ? raw.board : {};
  const rawHoles = Array.isArray(raw.holes) ? raw.holes : undefined;

  const boardResult = normalizeState(
    {
      version: FORMAT_VERSION,
      name: typeof raw.name === 'string' ? raw.name : '未命名开发板',
      units: 'mm',
      board: rawBoard,
      holes: rawHoles,
      meta: isPlainObject(raw.meta) ? raw.meta : {},
    },
    options,
  );
  warnings.push(...boardResult.warnings);

  const enclosure = cleanEnclosure(raw.enclosure, warnings);
  const openings = [];
  if (Array.isArray(raw.openings)) {
    for (let index = 0; index < raw.openings.length; index += 1) {
      const opening = cleanOpening(raw.openings[index], index, warnings);
      if (opening) openings.push(opening);
    }
    if (openings.length > MAX_OPENINGS) {
      warnings.push(`开孔数量超过 ${MAX_OPENINGS} 个，仅保留前 ${MAX_OPENINGS} 个。`);
      openings.length = MAX_OPENINGS;
    }
  } else if (raw.openings !== undefined) {
    warnings.push('openings 字段格式无效，已忽略。');
  }

  const sourceVersion = Number.isFinite(Number(raw.version))
    ? Number(raw.version)
    : isCaseDocument
      ? CASE_VERSION
      : FORMAT_VERSION;
  if (sourceVersion > CASE_VERSION) {
    warnings.push(`文件版本 ${sourceVersion} 高于当前支持的版本 ${CASE_VERSION}，已按兼容模式读取。`);
  }

  return {
    state: {
      version: CASE_VERSION,
      format: CASE_FORMAT,
      name:
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim().slice(0, 80)
          : '未命名开发板外壳',
      units: 'mm',
      board: boardResult.state.board,
      holes: boardResult.state.holes,
      enclosure,
      openings,
      meta: boardResult.state.meta,
    },
    warnings,
    sourceVersion,
    migratedFromBoardOnly: !isCaseDocument,
  };
}

export function toCaseDocument(state, options = {}) {
  const now = options.now || localISOString();
  const created = state.meta?.created || now;
  const updated = options.touch === false ? state.meta?.updated || created : now;
  return {
    version: CASE_VERSION,
    format: CASE_FORMAT,
    name: state.name?.trim() || '未命名开发板外壳',
    units: 'mm',
    board: {
      length: round(Number(state.board.length)),
      width: round(Number(state.board.width)),
      thickness: round(Number(state.board.thickness)),
      corner_radius: round(Number(state.board.corner_radius)),
      color: state.board.color,
    },
    holes: state.holes.map((hole) => ({
      x: round(Number(hole.x)),
      y: round(Number(hole.y)),
      diameter: round(Number(hole.diameter)),
    })),
    enclosure: {
      panel_thickness: round(Number(state.enclosure.panel_thickness)),
      clearance: round(Number(state.enclosure.clearance)),
      bottom_gap: round(Number(state.enclosure.bottom_gap)),
      top_gap: round(Number(state.enclosure.top_gap)),
      screw_clearance: round(Number(state.enclosure.screw_clearance)),
      fit: round(Number(state.enclosure.fit)),
      vent: {
        enabled: Boolean(state.enclosure.vent.enabled),
        count: Math.round(Number(state.enclosure.vent.count)),
        slot_width: round(Number(state.enclosure.vent.slot_width)),
        slot_length: round(Number(state.enclosure.vent.slot_length)),
      },
    },
    openings: state.openings.map((opening) => {
      if (opening.shape === 'circle') {
        return {
          side: opening.side,
          shape: 'circle',
          u: round(Number(opening.u)),
          v: round(Number(opening.v)),
          diameter: round(Number(opening.diameter)),
        };
      }
      return {
        side: opening.side,
        shape: 'rect',
        u: round(Number(opening.u)),
        v: round(Number(opening.v)),
        width: round(Number(opening.width)),
        height: round(Number(opening.height)),
      };
    }),
    meta: { created, updated },
  };
}

/**
 * Derive every outer/inner dimension from the board and enclosure settings.
 */
export function deriveCaseDimensions(state) {
  const t = Number(state.enclosure.panel_thickness);
  const clearance = Number(state.enclosure.clearance);
  const bottomGap = Number(state.enclosure.bottom_gap);
  const topGap = Number(state.enclosure.top_gap);
  const boardLength = Number(state.board.length);
  const boardWidth = Number(state.board.width);
  const boardThickness = Number(state.board.thickness);

  const innerWidth = boardLength + clearance * 2;
  const innerDepth = boardWidth + clearance * 2;
  const innerHeight = bottomGap + boardThickness + topGap;
  const outerWidth = innerWidth + t * 2;
  const outerDepth = innerDepth + t * 2;
  const outerHeight = innerHeight + t * 2;

  const maxCorner = maxCornerRadius(boardLength, boardWidth);

  return {
    panelThickness: t,
    clearance,
    bottomGap,
    topGap,
    innerWidth,
    innerDepth,
    innerHeight,
    outerWidth,
    outerDepth,
    outerHeight,
    boardLength,
    boardWidth,
    boardThickness,
    boardCornerRadius: Math.min(Number(state.board.corner_radius), maxCorner),
    boardBottomZ: t + bottomGap,
    boardCenterZ: t + bottomGap + boardThickness / 2,
    boardTopZ: t + bottomGap + boardThickness,
    topInnerZ: t + innerHeight,
    sidePanelWidthFront: innerWidth,
    sidePanelWidthSide: outerDepth,
    sidePanelHeight: innerHeight,
  };
}

export function caseFileStem(state, dimensions = deriveCaseDimensions(state)) {
  const rawName = typeof state.name === 'string' ? state.name.trim() : '';
  const isUnnamed =
    !rawName ||
    rawName === '未命名开发板外壳' ||
    rawName === '未命名开发板' ||
    rawName.toLowerCase() === 'untitled case';
  const name = isUnnamed
    ? 'board-case'
    : String(rawName)
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '_')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 48) || 'board-case';
  return (
    `${name}-${round(dimensions.outerWidth)}x${round(dimensions.outerDepth)}` +
    `x${round(dimensions.outerHeight)}`
  );
}

export function validBoardMountHoles(state) {
  const analysis = analyseHoles(state);
  return analysis.printable.map((entry) => ({ ...entry }));
}

export function createOpening(side = 'front', shape = 'rect') {
  if (shape === 'circle') {
    return { side, shape, u: 0, v: 0, diameter: 12 };
  }
  return { side, shape, u: 0, v: 0, width: 16, height: 9 };
}

export { PRESETS, DEFAULT_BOARD, MAX_HOLES };
