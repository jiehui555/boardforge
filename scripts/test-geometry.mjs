import assert from 'node:assert/strict';
import {
  CASE_FORMAT,
  CASE_VERSION,
  SCREW_SPECS,
  caseFileStem,
  createCaseFromPreset,
  createDefaultCaseState,
  createOpening,
  deriveCaseDimensions,
  normalizeCaseState,
  openingToPanelLocal,
  screwSpecForClearance,
  toCaseDocument,
} from '../src/case-schema.js';
import {
  buildAssemblyGeometry,
  buildCaseModel,
} from '../src/case-geometry.js';
import {
  buildCutDxf,
  buildCutSvg,
} from '../src/vector-export.js';
import { inspectGeometry } from '../src/board-geometry.js';
import { binaryStlTriangleCount, createBinaryStl } from '../src/stl-export.js';
import {
  DEFAULT_THEME_COLOR,
  createThemeTokens,
  normalizeThemeColor,
} from '../src/theme.js';
import { PRESETS } from '../src/schema.js';

let checks = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

// Case schema defaults and dimensions.
const defaults = createDefaultCaseState();
ok(defaults.version === CASE_VERSION, 'case document version is 2');
ok(defaults.format === CASE_FORMAT, 'case document format is boardforge-case');
ok(defaults.units === 'mm', 'case units are mm');
ok(defaults.holes.length === 4, 'default board has four mounting holes');
ok(defaults.enclosure.panel_thickness === 3, 'default acrylic thickness is 3 mm');
ok(defaults.enclosure.clearance === 2, 'default edge clearance is a snug 2 mm');

const dimensions = deriveCaseDimensions(defaults);
ok(dimensions.outerWidth === 95, 'default outer width is derived correctly');
ok(dimensions.outerDepth === 66, 'default outer depth is derived correctly');
ok(dimensions.outerHeight === 29.6, 'default outer height is derived correctly');
ok(dimensions.innerHeight === 23.6, 'default inner height is derived correctly');
ok(caseFileStem(defaults, dimensions) === 'board-case-95x66x29.6', 'case filename is derived from outer dimensions');

// Round-trip and legacy board migration.
const roundTrip = normalizeCaseState(toCaseDocument(defaults, { touch: false }));
ok(roundTrip.state.enclosure.panel_thickness === 3, 'case document round-trip preserves enclosure');
ok(roundTrip.warnings.length === 0, 'complete case document normalizes without warnings');

// Screw hardware is restricted to standard metric clearance holes.
ok(
  SCREW_SPECS.map((spec) => spec.clearance).join(',') === '2.4,2.9,3.4,4.5',
  'standard metric clear holes are defined',
);
ok(screwSpecForClearance(3).id === 'M2.5', 'arbitrary clearance snaps to nearest standard spec');
const legacyScrew = createDefaultCaseState();
legacyScrew.enclosure.screw_clearance = 3;
const normalizedScrew = normalizeCaseState(
  toCaseDocument(legacyScrew, { touch: false }),
);
ok(
  normalizedScrew.state.enclosure.screw_clearance === 2.9,
  'legacy screw clearance is normalized to a standard hole',
);
ok(
  normalizedScrew.warnings.some((warning) => warning.includes('标准')),
  'normalized screw clearance emits a warning',
);

const legacy = normalizeCaseState({
  version: 1,
  name: 'Legacy Board',
  units: 'mm',
  board: { length: 85, width: 56, thickness: 1.6, corner_radius: 3 },
  holes: [{ x: -39, y: -24.5, diameter: 2.7 }],
});
ok(legacy.migratedFromBoardOnly, 'legacy board document is identified');
ok(legacy.state.enclosure.panel_thickness === 3, 'legacy import gets default enclosure');
ok(legacy.state.openings.length === 0, 'legacy import gets an empty opening list');

assert.throws(() => normalizeCaseState(null), /JSON/);
checks += 1;

const clamped = normalizeCaseState({
  version: 2,
  format: CASE_FORMAT,
  board: { length: 20, width: 20, thickness: 1, corner_radius: 0 },
  holes: [],
  enclosure: { panel_thickness: 99, clearance: -5, top_gap: 0, fit: 9 },
});
ok(clamped.state.enclosure.panel_thickness === 10, 'panel thickness is clamped');
ok(clamped.state.enclosure.clearance === 1, 'clearance is clamped');
ok(clamped.state.enclosure.top_gap === 2, 'top clearance is clamped');
ok(clamped.warnings.length > 0, 'clamped enclosure fields emit warnings');

const withOpening = createDefaultCaseState();
withOpening.openings.push({
  ...createOpening('front', 'rect'),
  u: 10,
  v: 0,
  width: 18,
  height: 10,
});
const normalizedOpening = normalizeCaseState(
  toCaseDocument(withOpening, { touch: false }),
);
ok(normalizedOpening.state.openings.length === 1, 'openings survive JSON round-trip');

const panelCenterTest = { side: 'front', u: 10, v: 0, shape: 'circle', diameter: 10 };
ok(
  openingToPanelLocal(panelCenterTest, 89, 23.6).x === 54.5,
  'front-panel U maps to local X',
);
ok(
  openingToPanelLocal({ ...panelCenterTest, side: 'back' }, 89, 23.6).x === 54.5,
  'back-panel U remains positive from its own view',
);
ok(
  openingToPanelLocal({ ...panelCenterTest, side: 'left' }, 66, 23.6).x === 23,
  'left-panel U is mirrored into its local X',
);
ok(
  openingToPanelLocal({ ...panelCenterTest, side: 'right' }, 66, 23.6).x === 23,
  'right-panel U is mirrored into its local X',
);

// Build complete six-panel model.
const model = buildCaseModel(defaults);
ok(model.panelCount === 6, 'enclosure has six acrylic panels');
ok(model.columnCount === 4, 'enclosure has four integrated mounting columns');
ok(model.mounts.length === 4, 'board mounting holes generate four integrated columns');
ok(model.hardware.lowerStandoffs.length === 4, 'each column has a lower standoff');
ok(model.hardware.upperStandoffs.length === 4, 'each column has an upper standoff');
ok(model.hardware.connectorShafts.length === 4, 'each column has a through-board connector');
ok(model.hardware.screwHeads.length === 8, 'each column has top and bottom panel screws');
ok(model.board.diagnostics.watertight, 'board reference remains watertight');
ok(model.warnings.length === 0, 'default enclosure builds without warnings');
ok(
  model.panels.every((panel) => inspectGeometry(panel.geometry).watertight),
  'every laser-cut panel solid is watertight',
);
const panelIds = model.panels.map((panel) => panel.id).sort();
ok(
  JSON.stringify(panelIds) === JSON.stringify(['back', 'bottom', 'front', 'left', 'right', 'top']),
  'all six panel IDs are present',
);
const bottom = model.panels.find((panel) => panel.id === 'bottom');
const top = model.panels.find((panel) => panel.id === 'top');
ok(bottom.holes.length > 4, 'bottom panel contains screws, mounts and vents');
ok(top.holes.length >= 4, 'top panel contains corner screws and vents');

// Valid and invalid side-panel openings.
const openingState = createDefaultCaseState();
openingState.openings.push({
  ...createOpening('left', 'circle'),
  u: 0,
  v: 0,
  diameter: 14,
});
const openingModel = buildCaseModel(openingState);
const leftPanel = openingModel.panels.find((panel) => panel.id === 'left');
ok(leftPanel.holes.length === 1, 'valid side opening is cut into the panel');
ok(openingModel.warnings.length === 0, 'valid side opening produces no warning');
ok(
  openingModel.panels.every((panel) => inspectGeometry(panel.geometry).watertight),
  'panels with openings remain watertight solids',
);

const badOpeningState = createDefaultCaseState();
badOpeningState.openings.push({
  ...createOpening('front', 'rect'),
  u: 200,
  v: 0,
  width: 20,
  height: 10,
});
const badOpeningModel = buildCaseModel(badOpeningState);
ok(
  badOpeningModel.warnings.some((warning) => warning.includes('开孔')),
  'out-of-bounds side opening is reported',
);

const overlapOpeningState = createDefaultCaseState();
overlapOpeningState.openings.push(
  { ...createOpening('front', 'circle'), u: 0, v: 0, diameter: 12 },
  { ...createOpening('front', 'circle'), u: 3, v: 0, diameter: 12 },
);
const overlapOpeningModel = buildCaseModel(overlapOpeningState);
const overlapFront = overlapOpeningModel.panels.find((panel) => panel.id === 'front');
ok(overlapFront.holes.length === 1, 'overlapping cut-outs are rejected');
ok(
  overlapOpeningModel.warnings.some((warning) => warning.includes('重叠')),
  'overlapping cut-outs produce a warning',
);

// Vent toggle changes top/bottom hole counts.
const noVentState = createDefaultCaseState();
noVentState.enclosure.vent.enabled = false;
const noVentModel = buildCaseModel(noVentState);
const noVentTop = noVentModel.panels.find((panel) => panel.id === 'top');
ok(noVentTop.holes.length < top.holes.length, 'disabling vents removes top-panel slots');

// A board without mounting holes cannot generate integrated columns.
const noMountState = createDefaultCaseState();
noMountState.holes = [];
const noMountModel = buildCaseModel(noMountState);
ok(noMountModel.columnCount === 0, 'no board holes means no integrated columns');
ok(
  noMountModel.warnings.some((warning) => warning.includes('安装孔')),
  'no board holes produces an explicit warning',
);

// Duplicate board holes are rejected as fixed-column positions.
const duplicateHoleState = createDefaultCaseState();
duplicateHoleState.holes[1] = {
  ...duplicateHoleState.holes[0],
  x: duplicateHoleState.holes[0].x + 0.5,
};
const duplicateHoleModel = buildCaseModel(duplicateHoleState);
ok(duplicateHoleModel.columnCount === 3, 'too-close board holes are deduplicated');
ok(
  duplicateHoleModel.warnings.some((warning) => warning.includes('距离过近')),
  'too-close board holes produce a warning',
);

// Presets.
for (const preset of PRESETS) {
  const presetState = createCaseFromPreset(preset);
  const presetModel = buildCaseModel(presetState);
  ok(presetModel.panelCount === 6, `${preset.label} preset builds six panels`);
  for (const panel of presetModel.panels) panel.geometry.dispose();
  presetModel.board.geometry.dispose();
}

// Vector exports.
const dxf = buildCutDxf(openingModel);
const svg = buildCutSvg(openingModel);
ok(dxf.includes('AC1009'), 'DXF uses R12 compatibility header');
ok(dxf.includes('$INSUNITS'), 'DXF declares units');
ok(dxf.includes('LAYER\n2\nCUT'), 'DXF uses a CUT layer');
ok((dxf.match(/POLYLINE/g) || []).length >= 6, 'DXF contains panel outlines');
ok(svg.includes('viewBox='), 'SVG has a millimetre viewBox');
ok(svg.includes('width="'), 'SVG has physical dimensions');
ok(svg.includes('<g id="top"'), 'SVG includes a named top-panel group');

// Combined STL preview.
const assembly = buildAssemblyGeometry(openingModel);
const stl = createBinaryStl(assembly, { name: 'case assembly' });
ok(
  stl.byteLength === 84 + binaryStlTriangleCount(assembly) * 50,
  'assembly STL has an exact binary length',
);
ok(assembly.attributes.position.count > 0, 'assembly STL contains triangles');
ok(assembly.boundingBox.max.z > dimensions.outerHeight, 'assembly STL includes top hardware');
assembly.dispose();

// Interface theme tokens.
ok(normalizeThemeColor('#ABC') === '#aabbcc', 'short theme colours expand');
ok(normalizeThemeColor('invalid') === DEFAULT_THEME_COLOR, 'invalid colours fall back');
const darkTheme = createThemeTokens('#101010');
ok(darkTheme.accent !== '#101010', 'dark mode lifts dark accent colours');
const lightTheme = createThemeTokens('#7dd3fc', 'light');
ok(lightTheme.accent !== '#7dd3fc', 'light mode deepens bright accent colours');
ok(lightTheme.onAccent === '#ffffff', 'light mode uses white accent-button text');

for (const panel of model.panels) panel.geometry.dispose();
model.board.geometry.dispose();
for (const panel of noVentModel.panels) panel.geometry.dispose();
noVentModel.board.geometry.dispose();
for (const panel of noMountModel.panels) panel.geometry.dispose();
noMountModel.board.geometry.dispose();
for (const panel of duplicateHoleModel.panels) panel.geometry.dispose();
duplicateHoleModel.board.geometry.dispose();
for (const panel of openingModel.panels) panel.geometry.dispose();
openingModel.board.geometry.dispose();
for (const panel of badOpeningModel.panels) panel.geometry.dispose();
badOpeningModel.board.geometry.dispose();
for (const panel of overlapOpeningModel.panels) panel.geometry.dispose();
overlapOpeningModel.board.geometry.dispose();

console.log(`Case geometry/schema checks passed: ${checks}`);
