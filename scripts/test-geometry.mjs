import assert from 'node:assert/strict';
import {
  analyseHoles,
  boardFileStem,
  createDefaultState,
  createStateFromPreset,
  maxCornerRadius,
  normalizeState,
  PRESETS,
  toBoardDocument,
} from '../src/schema.js';
import { buildBoardModel } from '../src/board-geometry.js';
import { binaryStlTriangleCount, createBinaryStl } from '../src/stl-export.js';
import {
  DEFAULT_THEME_COLOR,
  createThemeTokens,
  normalizeThemeColor,
} from '../src/theme.js';

let checks = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

// Schema defaults and round-trip.
const defaults = createDefaultState();
ok(defaults.version === 1, 'default schema version is 1');
ok(defaults.units === 'mm', 'default units are mm');
ok(defaults.holes.length === 4, 'default board gets four holes');
ok(boardFileStem(defaults) === 'board-85x56', 'default filename is board-85x56');

const roundTrip = normalizeState(toBoardDocument(defaults, { touch: false }));
ok(roundTrip.state.board.length === 85, 'schema round-trip preserves length');
ok(roundTrip.warnings.length === 0, 'complete document normalizes without warnings');

const incomplete = normalizeState({
  version: 1,
  board: { length: 40, width: 30, thickness: 1.2 },
});
ok(incomplete.state.board.corner_radius === 3, 'missing corner radius uses default');
ok(incomplete.state.holes.length === 4, 'missing holes generate corner holes');
ok(incomplete.warnings.some((warning) => warning.includes('holes')), 'missing holes are reported');

assert.throws(() => normalizeState(null), /JSON/);
checks += 1;

// Range handling and correlated limits.
ok(maxCornerRadius(40, 20) === 10, 'corner radius max is half the short side');
const clamped = normalizeState({
  board: { length: 10, width: 10, thickness: 0, corner_radius: 99 },
  holes: [],
});
ok(clamped.state.board.thickness === 0.2, 'thickness clamps to minimum');
ok(clamped.state.board.corner_radius === 5, 'corner radius clamps to half the short side');
ok(clamped.warnings.length >= 2, 'clamping emits warnings');

// Hole analysis.
const outsideState = createDefaultState();
outsideState.holes[0].x = 100;
const outsideAnalysis = analyseHoles(outsideState);
ok(outsideAnalysis.outside.length === 1, 'outside hole is detected');
ok(outsideAnalysis.printable.length === 3, 'outside hole is excluded from the print set');

const overlapState = createDefaultState();
overlapState.holes[1].x = -38.5;
overlapState.holes[1].y = -24.5;
const overlapAnalysis = analyseHoles(overlapState);
ok(overlapAnalysis.overlaps.length === 1, 'overlapping holes are detected');

// CSG model.
const csgModel = buildBoardModel(defaults);
ok(csgModel.construction === 'csg', 'default build uses CSG');
ok(csgModel.watertight, 'default CSG model is watertight');
ok(csgModel.diagnostics.boundaryEdges === 0, 'CSG model has no boundary edges');
ok(csgModel.diagnostics.nonManifoldEdges === 0, 'CSG model has no non-manifold edges');
ok(csgModel.analysis.outside.length === 0, 'default model has no outside holes');
ok(csgModel.geometry.boundingBox.min.z < 0 && csgModel.geometry.boundingBox.max.z > 0, 'board is centered on Z');

// Direct fallback still cuts holes.
const directModel = buildBoardModel(defaults, { forceDirect: true });
ok(directModel.construction === 'direct', 'forced fallback uses direct construction');
ok(directModel.watertight, 'direct fallback is watertight');
ok(directModel.printableHoleIndices.length === 4, 'direct fallback keeps all four holes');
ok(directModel.triangles < csgModel.triangles, 'direct fallback is topologically simpler');

// No-hole model.
const noHoles = createDefaultState();
noHoles.holes = [];
const noHoleModel = buildBoardModel(noHoles);
ok(noHoleModel.watertight, 'board without holes is watertight');
ok(noHoleModel.analysis.printable.length === 0, 'empty hole list stays empty');

// STL writer.
const stl = createBinaryStl(csgModel.geometry, { name: defaults.name });
ok(stl.byteLength === 84 + binaryStlTriangleCount(csgModel.geometry) * 50, 'STL byte length is exact');
ok(new DataView(stl).getUint32(80, true) === csgModel.triangles, 'STL triangle count matches geometry');
ok(new Uint8Array(stl, 0, 10).some((byte) => byte !== 0), 'STL has a non-empty header');

// Presets.
for (const preset of PRESETS) {
  const state = createStateFromPreset(preset);
  const model = buildBoardModel(state);
  ok(model.watertight, `${preset.label} preset builds a watertight model`);
  model.geometry.dispose();
}

// Interface theme tokens are readable against the dark UI.
ok(normalizeThemeColor('#ABC') === '#aabbcc', 'short theme colours expand to six digits');
ok(normalizeThemeColor('not-a-colour') === DEFAULT_THEME_COLOR, 'invalid theme colours fall back');
const themeTokens = createThemeTokens('#7dd3fc');
ok(themeTokens.accent === '#7dd3fc', 'readable theme colours are kept as-is');
const darkThemeTokens = createThemeTokens('#101010');
ok(darkThemeTokens.accent !== '#101010', 'dark theme colours are lifted for contrast');
ok(darkThemeTokens.rgb.includes(','), 'theme tokens expose RGB channels for translucent accents');

csgModel.geometry.dispose();
directModel.geometry.dispose();
noHoleModel.geometry.dispose();

console.log(`Geometry/schema checks passed: ${checks}`);
