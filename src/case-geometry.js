import * as THREE from 'three';
import { buildBoardModel } from './board-geometry.js';
import {
  SIDE_LABELS,
  deriveCaseDimensions,
  validBoardMountHoles,
} from './case-schema.js';

const EPSILON = 1e-7;
const CIRCLE_SEGMENTS = 40;
const CORNER_SEGMENTS = 5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pointKey(point) {
  return `${Math.round(point[0] * 1e5)},${Math.round(point[1] * 1e5)}`;
}

function dedupeConsecutive(points) {
  const output = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (!previous || pointKey(previous) !== pointKey(point)) output.push(point);
  }
  if (output.length > 1 && pointKey(output[0]) === pointKey(output[output.length - 1])) {
    output.pop();
  }
  return output;
}

function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Build a closed rectilinear panel outline with rectangular tabs (positive
 * offset) or notches (negative offset) on any edge.
 */
function buildRectilinearOutline(width, height, edges = {}) {
  const feature = (list = []) =>
    list
      .filter((item) => item && item.end - item.start > EPSILON && Math.abs(item.offset) > EPSILON)
      .slice()
      .sort((a, b) => a.start - b.start);

  const points = [[0, 0]];
  const bottom = feature(edges.bottom);
  for (const item of bottom) {
    points.push([item.start, 0]);
    points.push([item.start, -item.offset]);
    points.push([item.end, -item.offset]);
    points.push([item.end, 0]);
  }
  points.push([width, 0]);

  const right = feature(edges.right);
  for (const item of right) {
    points.push([width, item.start]);
    points.push([width + item.offset, item.start]);
    points.push([width + item.offset, item.end]);
    points.push([width, item.end]);
  }
  points.push([width, height]);

  const top = feature(edges.top);
  for (let index = top.length - 1; index >= 0; index -= 1) {
    const item = top[index];
    points.push([item.end, height]);
    points.push([item.end, height + item.offset]);
    points.push([item.start, height + item.offset]);
    points.push([item.start, height]);
  }
  points.push([0, height]);

  const left = feature(edges.left);
  for (let index = left.length - 1; index >= 0; index -= 1) {
    const item = left[index];
    points.push([0, item.end]);
    points.push([-item.offset, item.end]);
    points.push([-item.offset, item.start]);
    points.push([0, item.start]);
  }

  return dedupeConsecutive(points);
}

function roundedRectPoints(cx, cy, width, height, radius = 1.2) {
  const w = Math.max(0.001, width);
  const h = Math.max(0.001, height);
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const points = [];
  const pushArc = (arcCx, arcCy, start, end) => {
    for (let step = 0; step <= CORNER_SEGMENTS; step += 1) {
      const angle = start + ((end - start) * step) / CORNER_SEGMENTS;
      points.push([arcCx + Math.cos(angle) * r, arcCy + Math.sin(angle) * r]);
    }
  };

  if (r <= EPSILON) {
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }

  points.push([x0 + r, y0]);
  points.push([x1 - r, y0]);
  pushArc(x1 - r, y0 + r, -Math.PI / 2, 0);
  points.push([x1, y1 - r]);
  pushArc(x1 - r, y1 - r, 0, Math.PI / 2);
  points.push([x0 + r, y1]);
  pushArc(x0 + r, y1 - r, Math.PI / 2, Math.PI);
  points.push([x0, y0 + r]);
  pushArc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return dedupeConsecutive(points);
}

function circlePoints(cx, cy, diameter, segments = CIRCLE_SEGMENTS) {
  const radius = Math.max(0.001, diameter / 2);
  const points = [];
  for (let step = 0; step < segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function makeHole(shape, data) {
  const points =
    shape === 'circle'
      ? circlePoints(data.cx, data.cy, data.diameter)
      : roundedRectPoints(
          data.cx,
          data.cy,
          data.width,
          data.height,
          data.radius ?? 1.2,
        );
  return {
    ...data,
    shape,
    points,
    bounds: boundsOf(points),
  };
}

function tabIntervals(length, options = {}) {
  const {
    margin = 10,
    target = 28,
    minWidth = 6,
    maxWidth = 12,
    maxCount = 5,
  } = options;
  const usable = length - margin * 2;
  if (usable < 14) return [];

  let count = clamp(Math.round(usable / target), 1, maxCount);
  while (count > 1 && usable / count < minWidth * 1.7) count -= 1;
  const width = clamp(usable / (count * 1.8), minWidth, maxWidth);
  if (count * width > usable) return [];

  const gap = (usable - count * width) / (count + 1);
  const intervals = [];
  for (let index = 0; index < count; index += 1) {
    const start = margin + gap * (index + 1) + width * index;
    intervals.push({ start, end: start + width });
  }
  return intervals;
}

function expandIntervals(intervals, amount) {
  return intervals.map((item) => ({
    start: item.start - amount,
    end: item.end + amount,
  }));
}

function asFeatures(intervals, offset) {
  return intervals.map((item) => ({
    start: item.start,
    end: item.end,
    offset,
  }));
}

function createShape(outline, holes) {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    shape.lineTo(outline[index][0], outline[index][1]);
  }
  shape.closePath();

  for (const hole of holes) {
    if (!hole.points || hole.points.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(hole.points[0][0], hole.points[0][1]);
    for (let index = 1; index < hole.points.length; index += 1) {
      path.lineTo(hole.points[index][0], hole.points[index][1]);
    }
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

function makePanelGeometry(outline, holes, thickness, matrix) {
  const shape = createShape(outline, holes);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 12,
    steps: 1,
  });
  geometry.deleteAttribute('uv');
  geometry.applyMatrix4(matrix);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function basisMatrix(xAxis, yAxis, zAxis, origin) {
  const ex = new THREE.Vector3(...xAxis);
  const ey = new THREE.Vector3(...yAxis);
  const ez = new THREE.Vector3(...zAxis);
  const matrix = new THREE.Matrix4().makeBasis(ex, ey, ez);
  matrix.setPosition(new THREE.Vector3(...origin));
  return matrix;
}

function boxOverlap(a, b, padding = 0) {
  return !(
    a.maxX + padding < b.minX ||
    a.minX - padding > b.maxX ||
    a.maxY + padding < b.minY ||
    a.minY - padding > b.maxY
  );
}

function panelHoleAtPoint(x, y, diameter, type) {
  return makeHole('circle', { cx: x, cy: y, diameter, type });
}

function buildSidePanels(state, dims, warnings) {
  const t = dims.panelThickness;
  const fit = state.enclosure.fit;
  const topBottomTabOptions = {
    margin: Math.max(9, t + 6),
    target: 30,
    minWidth: 6,
    maxWidth: 12,
    maxCount: 5,
  };
  const verticalTabOptions = {
    margin: Math.max(8, t + 6),
    target: 18,
    minWidth: 5,
    maxWidth: 9,
    maxCount: 3,
  };

  const frontBackWidth = dims.sidePanelWidthFront;
  const sideWidth = dims.sidePanelWidthSide;
  const height = dims.sidePanelHeight;

  const frontTabs = tabIntervals(frontBackWidth, topBottomTabOptions);
  const sideTabs = tabIntervals(sideWidth, topBottomTabOptions);
  const verticalTabs = tabIntervals(height, verticalTabOptions);

  const verticalNotches = expandIntervals(verticalTabs, fit);
  const notchDepth = t + fit;

  const panels = [
    {
      id: 'front',
      label: SIDE_LABELS.front,
      role: 'side',
      width: frontBackWidth,
      height,
      topTabs: frontTabs,
      bottomTabs: frontTabs,
      verticalTabs,
      outline: buildRectilinearOutline(frontBackWidth, height, {
        bottom: asFeatures(frontTabs, t),
        top: asFeatures(frontTabs, t),
        left: asFeatures(verticalTabs, t),
        right: asFeatures(verticalTabs, t),
      }),
      holes: [],
      explosion: [0, -1, 0],
      matrix: basisMatrix(
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0],
        [-frontBackWidth / 2, -dims.outerDepth / 2 + t, t],
      ),
    },
    {
      id: 'back',
      label: SIDE_LABELS.back,
      role: 'side',
      width: frontBackWidth,
      height,
      topTabs: frontTabs,
      bottomTabs: frontTabs,
      verticalTabs,
      outline: buildRectilinearOutline(frontBackWidth, height, {
        bottom: asFeatures(frontTabs, t),
        top: asFeatures(frontTabs, t),
        left: asFeatures(verticalTabs, t),
        right: asFeatures(verticalTabs, t),
      }),
      holes: [],
      explosion: [0, 1, 0],
      matrix: basisMatrix(
        [-1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
        [frontBackWidth / 2, dims.outerDepth / 2 - t, t],
      ),
    },
    {
      id: 'left',
      label: SIDE_LABELS.left,
      role: 'side',
      width: sideWidth,
      height,
      topTabs: sideTabs,
      bottomTabs: sideTabs,
      verticalNotches: true,
      outline: buildRectilinearOutline(sideWidth, height, {
        bottom: asFeatures(sideTabs, t),
        top: asFeatures(sideTabs, t),
        left: asFeatures(verticalNotches, -notchDepth),
        right: asFeatures(verticalNotches, -notchDepth),
      }),
      holes: [],
      explosion: [-1, 0, 0],
      matrix: basisMatrix(
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 0],
        [-dims.outerWidth / 2, -dims.outerDepth / 2, t],
      ),
    },
    {
      id: 'right',
      label: SIDE_LABELS.right,
      role: 'side',
      width: sideWidth,
      height,
      topTabs: sideTabs,
      bottomTabs: sideTabs,
      verticalNotches: true,
      outline: buildRectilinearOutline(sideWidth, height, {
        bottom: asFeatures(sideTabs, t),
        top: asFeatures(sideTabs, t),
        left: asFeatures(verticalNotches, -notchDepth),
        right: asFeatures(verticalNotches, -notchDepth),
      }),
      holes: [],
      explosion: [1, 0, 0],
      matrix: basisMatrix(
        [0, -1, 0],
        [0, 0, 1],
        [-1, 0, 0],
        [dims.outerWidth / 2, dims.outerDepth / 2, t],
      ),
    },
  ];

  if (frontTabs.length === 0 || sideTabs.length === 0) {
    warnings.push('外壳尺寸较小，顶部/底部榫舌数量不足，建议增加外壳尺寸。');
  }

  return {
    panels,
    frontTabs,
    sideTabs,
    verticalTabs,
  };
}

function addOpenings(panels, state, dims, warnings) {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const fit = state.enclosure.fit;

  for (let index = 0; index < state.openings.length; index += 1) {
    const opening = state.openings[index];
    const panel = byId.get(opening.side);
    if (!panel) {
      warnings.push(`第 ${index + 1} 个开孔所在侧板无效，已跳过。`);
      continue;
    }

    const marginX = Math.max(6, dims.panelThickness + fit + 4);
    const marginY = Math.max(6, dims.panelThickness + fit + 3);
    const mirror = opening.side === 'back' || opening.side === 'right';
    const cx = panel.width / 2 + (mirror ? -opening.u : opening.u);
    const cy = panel.height / 2 + opening.v;
    const halfWidth = opening.shape === 'circle' ? opening.diameter / 2 : opening.width / 2;
    const halfHeight = opening.shape === 'circle' ? opening.diameter / 2 : opening.height / 2;

    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      cx - halfWidth < marginX ||
      cx + halfWidth > panel.width - marginX ||
      cy - halfHeight < marginY ||
      cy + halfHeight > panel.height - marginY
    ) {
      warnings.push(
        `第 ${index + 1} 个开孔超出${SIDE_LABELS[opening.side]}可加工区域，已跳过。`,
      );
      continue;
    }

    const hole =
      opening.shape === 'circle'
        ? makeHole('circle', {
            cx,
            cy,
            diameter: opening.diameter,
            type: 'opening',
            sourceIndex: index,
          })
        : makeHole('rect', {
            cx,
            cy,
            width: opening.width,
            height: opening.height,
            radius: Math.min(2, opening.width / 3, opening.height / 3),
            type: 'opening',
            sourceIndex: index,
          });
    panel.holes.push(hole);
  }
}

function buildVentHoles(state, dims, panelWidth, panelDepth, blocked, warnings) {
  if (!state.enclosure.vent.enabled) return [];
  const vent = state.enclosure.vent;
  let count = Math.round(vent.count);
  let slotWidth = Math.min(vent.slot_width, panelDepth / 4);
  let slotLength = Math.min(vent.slot_length, panelWidth - 24);
  if (slotLength < 4) {
    warnings.push('通风槽长度过大，无法放入顶板/底板。');
    return [];
  }

  const edgeMargin = 10;
  const usableDepth = panelDepth - edgeMargin * 2;
  let gap = Math.max(2, slotWidth * 2);
  let totalDepth = count * slotWidth + Math.max(0, count - 1) * gap;

  if (totalDepth > usableDepth && count > 1) {
    gap = 1.4;
    totalDepth = count * slotWidth + (count - 1) * gap;
  }
  while (count > 1 && totalDepth > usableDepth) {
    count -= 1;
    totalDepth = count * slotWidth + (count - 1) * gap;
  }
  if (totalDepth > usableDepth) {
    slotWidth = Math.max(0.8, usableDepth);
    totalDepth = slotWidth;
    count = 1;
  }

  if (count < vent.count) {
    warnings.push(`通风槽数量已从 ${vent.count} 减少为 ${count}，以适配面板尺寸。`);
  }

  const holes = [];
  const startY = panelDepth / 2 - totalDepth / 2 + slotWidth / 2;
  for (let index = 0; index < count; index += 1) {
    const cy = startY + index * (slotWidth + gap);
    const candidate = roundedRectPoints(panelWidth / 2, cy, slotLength, slotWidth, slotWidth / 2);
    const candidateBounds = boundsOf(candidate);
    if (blocked.some((rect) => boxOverlap(candidateBounds, rect, 1.4))) {
      warnings.push(`第 ${index + 1} 条通风槽与固定孔冲突，已跳过。`);
      continue;
    }
    holes.push(
      makeHole('rect', {
        cx: panelWidth / 2,
        cy,
        width: slotLength,
        height: slotWidth,
        radius: slotWidth / 2,
        type: 'vent',
      }),
    );
  }
  return holes;
}

function buildTopBottomPanels(state, dims, sideData, panelHoles) {
  const t = dims.panelThickness;
  const fit = state.enclosure.fit;
  const notchDepth = t + fit;
  const outerW = dims.outerWidth;
  const outerD = dims.outerDepth;
  const warnings = [];

  const frontPanel = sideData.panels.find((panel) => panel.id === 'front');
  const backPanel = sideData.panels.find((panel) => panel.id === 'back');
  const leftPanel = sideData.panels.find((panel) => panel.id === 'left');
  const rightPanel = sideData.panels.find((panel) => panel.id === 'right');

  const frontGlobalX = frontPanel.topTabs.map((item) => ({
    start: -dims.innerWidth / 2 + item.start - fit,
    end: -dims.innerWidth / 2 + item.end + fit,
  }));
  const backGlobalX = backPanel.topTabs.map((item) => ({
    start: dims.innerWidth / 2 - item.end - fit,
    end: dims.innerWidth / 2 - item.start + fit,
  }));
  const leftGlobalY = leftPanel.topTabs.map((item) => ({
    start: -dims.outerDepth / 2 + item.start - fit,
    end: -dims.outerDepth / 2 + item.end + fit,
  }));
  const rightGlobalY = rightPanel.topTabs.map((item) => ({
    start: dims.outerDepth / 2 - item.end - fit,
    end: dims.outerDepth / 2 - item.start + fit,
  }));

  const localX = (values) => values.map((item) => ({ start: item.start + outerW / 2, end: item.end + outerW / 2 }));
  const localY = (values) => values.map((item) => ({ start: item.start + outerD / 2, end: item.end + outerD / 2 }));

  const bottomEdges = {
    bottom: asFeatures(localX(frontGlobalX), -notchDepth),
    top: asFeatures(localX(backGlobalX), -notchDepth),
    left: asFeatures(localY(leftGlobalY), -notchDepth),
    right: asFeatures(localY(rightGlobalY), -notchDepth),
  };

  const panelMakers = [
    {
      id: 'bottom',
      label: '底板',
      role: 'bottom',
      z: 0,
      extraHoles: panelHoles.bottom,
      explosion: [0, 0, -1],
    },
    {
      id: 'top',
      label: '顶板',
      role: 'top',
      z: dims.outerHeight - t,
      extraHoles: panelHoles.top,
      explosion: [0, 0, 1],
    },
  ];

  const panels = panelMakers.map((maker) => {
    const outline = buildRectilinearOutline(outerW, outerD, bottomEdges);
    const blocked = maker.extraHoles
      .filter((hole) => hole.type === 'column-screw')
      .map((hole) => hole.bounds);
    const ventHoles = buildVentHoles(state, dims, outerW, outerD, blocked, warnings);
    const holes = [...maker.extraHoles, ...ventHoles];
    return {
      id: maker.id,
      label: maker.label,
      role: maker.role,
      width: outerW,
      height: outerD,
      outline,
      holes,
      explosion: maker.explosion,
      matrix: new THREE.Matrix4().makeTranslation(-outerW / 2, -outerD / 2, maker.z),
    };
  });

  return { panels, warnings };
}

function buildBoardMounts(state) {
  const mounts = validBoardMountHoles(state);
  const panelHoleDiameter = state.enclosure.screw_clearance;
  return mounts.map((hole) => ({
    x: hole.x,
    y: hole.y,
    diameter: panelHoleDiameter,
    boardHoleDiameter: hole.diameter,
    standoffRadius: Math.max(2.3, panelHoleDiameter / 2 + 1.4),
    boardHoleIndex: hole.index,
  }));
}

function buildHardware(dims, mounts) {
  const t = dims.panelThickness;
  const lowerStandoffs = mounts
    .filter(() => dims.bottomGap > 0)
    .map((mount) => ({
      x: mount.x,
      y: mount.y,
      z: t + dims.bottomGap / 2,
      radius: mount.standoffRadius,
      height: dims.bottomGap,
    }));
  const upperStandoffs = mounts
    .filter(() => dims.topGap > 0)
    .map((mount) => ({
      x: mount.x,
      y: mount.y,
      z: dims.boardTopZ + dims.topGap / 2,
      radius: mount.standoffRadius,
      height: dims.topGap,
    }));
  const screwHeads = [];
  for (const mount of mounts) {
    screwHeads.push({
      x: mount.x,
      y: mount.y,
      z: dims.outerHeight + 0.6,
      radius: mount.diameter / 2 + 1.2,
      height: 1.2,
    });
    screwHeads.push({
      x: mount.x,
      y: mount.y,
      z: -0.6,
      radius: mount.diameter / 2 + 1.2,
      height: 1.2,
    });
  }
  return { lowerStandoffs, upperStandoffs, screwHeads };
}

/**
 * Build the complete laser-cut enclosure preview and all panel data.
 */
export function buildCaseModel(state, options = {}) {
  const started = performance.now();
  const warnings = [];
  const dims = deriveCaseDimensions(state);
  const sideData = buildSidePanels(state, dims, warnings);
  const panels = [...sideData.panels];

  const mounts = buildBoardMounts(state);
  const columnHoles = mounts.map((mount) =>
    panelHoleAtPoint(
      mount.x + dims.outerWidth / 2,
      mount.y + dims.outerDepth / 2,
      mount.diameter,
      'column-screw',
    ),
  );

  const topData = buildTopBottomPanels(state, dims, sideData, {
    bottom: columnHoles,
    top: columnHoles,
  });
  warnings.push(...topData.warnings);
  panels.push(...topData.panels);

  addOpenings(panels, state, dims, warnings);

  for (const panel of panels) {
    panel.bounds = boundsOf(panel.outline);
    panel.geometry = makePanelGeometry(
      panel.outline,
      panel.holes,
      dims.panelThickness,
      panel.matrix,
    );
    panel.triangleCount = panel.geometry.index
      ? panel.geometry.index.count / 3
      : panel.geometry.attributes.position.count / 3;
  }

  const boardModel = buildBoardModel(state);
  warnings.push(...boardModel.warnings);
  if (mounts.length === 0) {
    warnings.push('开发板没有有效安装孔，无法生成一体固定柱和顶/底螺丝。');
  } else if (mounts.length < 3) {
    warnings.push('有效固定柱少于 3 组，外壳固定可能不稳定。');
  }

  const hardware = buildHardware(dims, mounts);
  const triangleCount = panels.reduce((total, panel) => total + panel.triangleCount, 0);

  return {
    dimensions: dims,
    panels,
    board: {
      geometry: boardModel.geometry,
      z: dims.boardCenterZ,
      diagnostics: boardModel.diagnostics,
      analysis: boardModel.analysis,
    },
    hardware,
    mounts,
    warnings,
    triangleCount,
    buildMs: performance.now() - started,
    panelCount: panels.length,
    columnCount: mounts.length,
    construction: 'panels',
    sideData,
  };
}

export function panelLayout(panels) {
  const gap = 12;
  const margin = 12;
  const rows = [
    panels.filter((panel) => panel.id === 'top' || panel.id === 'bottom'),
    panels.filter((panel) => panel.id === 'front' || panel.id === 'back'),
    panels.filter((panel) => panel.id === 'left' || panel.id === 'right'),
  ];
  const rowWidths = rows.map((row) =>
    row.reduce((sum, panel) => sum + panel.bounds.width, 0) + Math.max(0, row.length - 1) * gap,
  );
  const sheetWidth = Math.max(...rowWidths) + margin * 2;
  const positioned = [];
  let cursorY = margin;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.length === 0) continue;
    const rowWidth = rowWidths[rowIndex];
    let cursorX = margin + (sheetWidth - margin * 2 - rowWidth) / 2;
    const rowHeight = Math.max(...row.map((panel) => panel.bounds.height));
    for (const panel of row) {
      const offsetX = cursorX - panel.bounds.minX;
      const offsetY = cursorY - panel.bounds.minY;
      positioned.push({
        panel,
        offsetX,
        offsetY,
      });
      cursorX += panel.bounds.width + gap;
    }
    cursorY += rowHeight + gap;
  }

  return {
    sheetWidth,
    sheetHeight: cursorY - gap + margin,
    panels: positioned,
  };
}

function mergePositionNormals(geometries) {
  const sources = geometries.map((geometry) =>
    geometry.index ? geometry.toNonIndexed() : geometry,
  );
  let vertexCount = 0;
  for (const source of sources) {
    const position = source.getAttribute('position');
    vertexCount += Math.floor(position.count);
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const geometry = geometries[index];
    const position = source.getAttribute('position');
    if (!source.getAttribute('normal')) source.computeVertexNormals();
    const normal = source.getAttribute('normal');
    positions.set(position.array, offset * 3);
    normals.set(normal.array, offset * 3);
    offset += position.count;
    if (source !== geometry) source.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingBox();
  return merged;
}

function hardwareCylinder(radius, height, x, y, z, segments = 24) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  geometry.deleteAttribute('uv');
  return geometry;
}

/**
 * A combined STL preview geometry. It intentionally includes assembly hardware,
 * so it represents the visual enclosure, not a printable single acrylic part.
 */
export function buildAssemblyGeometry(model) {
  const parts = model.panels.map((panel) => panel.geometry.clone());
  for (const standoff of model.hardware.lowerStandoffs) {
    parts.push(
      hardwareCylinder(
        standoff.radius,
        standoff.height,
        standoff.x,
        standoff.y,
        standoff.z,
        6,
      ),
    );
  }
  for (const standoff of model.hardware.upperStandoffs) {
    parts.push(
      hardwareCylinder(
        standoff.radius,
        standoff.height,
        standoff.x,
        standoff.y,
        standoff.z,
        6,
      ),
    );
  }
  for (const screw of model.hardware.screwHeads) {
    parts.push(
      hardwareCylinder(screw.radius, screw.height, screw.x, screw.y, screw.z, 24),
    );
  }
  const merged = mergePositionNormals(parts);
  for (const part of parts) part.dispose();
  return merged;
}

export function disposeCaseModel(model) {
  if (!model) return;
  for (const panel of model.panels) {
    panel.geometry?.dispose();
  }
  model.board?.geometry?.dispose();
}
