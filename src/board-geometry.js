import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { analyseHoles } from './schema.js';

/**
 * Geometry pipeline.
 *
 * The primary path builds a rounded rectangular plate and cuts every mounting
 * hole with a real CSG subtraction (three-bvh-csg, CDT clipping mode). The
 * result is checked for watertightness. If a pathological input defeats the
 * CSG kernel, we fall back to an extrusion with hole contours, which produces
 * the same true through-holes and is inherently closed.
 */

const CSG_ATTRIBUTES = ['position', 'normal'];
const WELD_TOLERANCE = 1e-4;
let sharedMaterial = null;

function getCsgMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a5f2a,
      side: THREE.DoubleSide,
      roughness: 0.5,
    });
  }
  return sharedMaterial;
}

export function createRoundedRectShape(length, width, radius) {
  const shape = new THREE.Shape();
  const halfL = length / 2;
  const halfW = width / 2;
  const r = Math.max(0, Math.min(radius, Math.min(halfL, halfW) - 0.001));

  if (r <= 0.0001) {
    shape.moveTo(-halfL, -halfW);
    shape.lineTo(halfL, -halfW);
    shape.lineTo(halfL, halfW);
    shape.lineTo(-halfL, halfW);
    shape.closePath();
    return shape;
  }

  shape.moveTo(-halfL + r, -halfW);
  shape.lineTo(halfL - r, -halfW);
  shape.absarc(halfL - r, -halfW + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(halfL, halfW - r);
  shape.absarc(halfL - r, halfW - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-halfL + r, halfW);
  shape.absarc(-halfL + r, halfW - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfL, -halfW + r);
  shape.absarc(-halfL + r, -halfW + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

export function createPlateGeometry(length, width, thickness, radius) {
  const shape = createRoundedRectShape(length, width, radius);
  const curveSegments = Math.max(6, Math.min(32, Math.ceil(Math.max(radius, 0.5) * 5)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.deleteAttribute('uv');
  geometry.computeBoundingBox();
  return geometry;
}

function createHoleCutter(hole, thickness) {
  const segments = Math.max(32, Math.min(64, Math.ceil(hole.diameter * 10)));
  const geometry = new THREE.CylinderGeometry(
    hole.radius,
    hole.radius,
    thickness + 4,
    segments,
    1,
    false,
  );
  // Cylinders are Y-aligned by default; the board thickness lives on Z.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(hole.x, hole.y, 0);
  geometry.deleteAttribute('uv');
  return geometry;
}

function buildWithCsg(baseGeometry, printableHoles, thickness) {
  const evaluator = new Evaluator();
  evaluator.attributes = CSG_ATTRIBUTES;
  evaluator.useGroups = false;
  evaluator.consolidateGroups = false;
  evaluator.useCDTClipping = true;

  const material = getCsgMaterial();
  let current = new Brush(baseGeometry.clone(), material);
  current.updateMatrixWorld(true);

  for (const hole of printableHoles) {
    const cutter = new Brush(createHoleCutter(hole, thickness), material);
    cutter.updateMatrixWorld(true);
    const next = evaluator.evaluate(current, cutter, SUBTRACTION);
    next.updateMatrixWorld(true);
    current.geometry.dispose();
    cutter.geometry.dispose();
    current = next;
  }

  const geometry = current.geometry;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function fitsWithoutContourOverlap(hole, kept) {
  return kept.every(
    (other) =>
      other.radius + hole.radius < Math.hypot(other.x - hole.x, other.y - hole.y),
  );
}

function buildWithHoleContours(baseLength, baseWidth, thickness, radius, printableHoles) {
  const shape = createRoundedRectShape(baseLength, baseWidth, radius);
  const kept = [];
  for (const hole of printableHoles) {
    // Intersecting contours are invalid for a single triangulated cap. The CSG
    // path handles overlaps; this fallback keeps every independent hole.
    if (!fitsWithoutContourOverlap(hole, kept)) continue;
    const path = new THREE.Path();
    path.absarc(hole.x, hole.y, hole.radius, 0, Math.PI * 2, true);
    shape.holes.push(path);
    kept.push(hole);
  }

  const curveSegments = Math.max(16, Math.min(48, Math.ceil(Math.max(radius, 0.5) * 6)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments,
    steps: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.deleteAttribute('uv');
  geometry.computeBoundingBox();
  return { geometry, kept };
}

export function triangleCount(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  return Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
}

/**
 * Topological inspection independent of vertex sharing:
 * positions are welded with a 0.0001 mm tolerance before counting edges.
 */
export function inspectGeometry(geometry, tolerance = WELD_TOLERANCE) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (!position) {
    return { triangles: 0, boundaryEdges: 0, nonManifoldEdges: 0, degenerate: 0, watertight: false };
  }

  const triangles = triangleCount(geometry);
  const vertexMap = new Map();
  const vertexCount = position.count;
  const ids = new Uint32Array(vertexCount);

  const quantize = (value) => Math.round(value / tolerance);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const key =
      `${quantize(position.getX(vertex))},` +
      `${quantize(position.getY(vertex))},` +
      `${quantize(position.getZ(vertex))}`;
    let id = vertexMap.get(key);
    if (id === undefined) {
      id = vertexMap.size;
      vertexMap.set(key, id);
    }
    // ids is only used for indexed access below; store per original vertex.
    ids[vertex] = id;
  }

  const edges = new Map();
  let degenerate = 0;
  const vertexAt = (triangle, corner) => {
    if (index) return ids[index.getX(triangle * 3 + corner)];
    return ids[triangle * 3 + corner];
  };

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const a = vertexAt(triangle, 0);
    const b = vertexAt(triangle, 1);
    const c = vertexAt(triangle, 2);
    if (a === b || b === c || c === a) {
      degenerate += 1;
      continue;
    }
    const pairs = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [first, second] of pairs) {
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edges.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  return {
    triangles,
    vertices: vertexMap.size,
    boundaryEdges,
    nonManifoldEdges,
    degenerate,
    watertight: boundaryEdges === 0 && nonManifoldEdges === 0 && degenerate === 0,
  };
}

export function computeVolume(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  const index = geometry.index;
  const triangleTotal = triangleCount(geometry);
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleTotal; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3;
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    cross.crossVectors(b, c);
    volume += a.dot(cross) / 6;
  }
  return volume;
}

/**
 * Build a printable board.
 *
 * @returns {{
 *   geometry: THREE.BufferGeometry,
 *   analysis: ReturnType<typeof analyseHoles>,
 *   construction: 'csg'|'direct',
 *   fallbackReason: string|null,
 *   triangles: number,
 *   watertight: boolean,
 *   buildMs: number,
 *   diagnostics: object,
 *   printableHoleIndices: number[]
 * }}
 */
export function buildBoardModel(state, options = {}) {
  const started = performance.now();
  const board = state.board;
  const thickness = Number(board.thickness);
  const radius = Number(board.corner_radius);
  const analysis = analyseHoles(state);
  const wantCsg = !options.forceDirect && analysis.printable.length > 0;

  const base = createPlateGeometry(
    Number(board.length),
    Number(board.width),
    thickness,
    radius,
  );

  let geometry = null;
  let construction = 'direct';
  let fallbackReason = null;
  let printableHoleIndices = analysis.printable.map((hole) => hole.index);
  let csgError = null;

  if (wantCsg) {
    try {
      const csgGeometry = buildWithCsg(base, analysis.printable, thickness);
      const inspection = inspectGeometry(csgGeometry);
      if (inspection.watertight) {
        geometry = csgGeometry;
        construction = 'csg';
      } else {
        fallbackReason =
          `CSG 结果未通过水密校验（${inspection.boundaryEdges} 条边界边），` +
          '已改用直接建模。';
        csgGeometry.dispose();
      }
    } catch (error) {
      csgError = error;
      fallbackReason = `布尔运算失败，已改用直接建模：${error.message || error}`;
    }
  }

  if (!geometry) {
    if (analysis.printable.length > 0) {
      const direct = buildWithHoleContours(
        Number(board.length),
        Number(board.width),
        thickness,
        radius,
        analysis.printable,
      );
      geometry = direct.geometry;
      printableHoleIndices = direct.kept.map((hole) => hole.index);
      if (direct.kept.length < analysis.printable.length) {
        const skipped = analysis.printable.length - direct.kept.length;
        fallbackReason = (fallbackReason ? fallbackReason + ' ' : '') +
          `${skipped} 个互相重叠的孔在直接建模中未能保留。`;
      }
    } else {
      geometry = base;
    }
    construction = 'direct';
  }

  if (geometry !== base) base.dispose();

  geometry.computeBoundingBox();
  const inspection = inspectGeometry(geometry);
  const buildMs = performance.now() - started;

  const warnings = [...analysis.warnings];
  if (fallbackReason) warnings.push(fallbackReason);
  if (!inspection.watertight) {
    warnings.push('模型未通过水密校验，导出前请检查孔径与板边。');
  }

  return {
    geometry,
    analysis,
    construction,
    fallbackReason,
    csgError,
    triangles: inspection.triangles,
    watertight: inspection.watertight,
    buildMs,
    diagnostics: inspection,
    printableHoleIndices,
    warnings,
  };
}
