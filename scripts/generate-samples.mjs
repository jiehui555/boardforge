import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  PRESETS,
  createCaseFromPreset,
  createOpening,
  toCaseDocument,
} from '../src/case-schema.js';
import { buildCaseModel } from '../src/case-geometry.js';
import { buildCutDxf, buildCutSvg } from '../src/vector-export.js';

const outputDirectory = resolve(process.cwd(), 'samples');
await mkdir(outputDirectory, { recursive: true });
for (const file of await readdir(outputDirectory)) {
  if (/\.(board\.json|case\.json|dxf|svg)$/i.test(file)) {
    await rm(resolve(outputDirectory, file));
  }
}

const fixedDate = '2026-11-12T09:00:00+08:00';

const raspberryPreset = PRESETS.find((preset) => preset.id === 'raspberry-pi-4b');
if (!raspberryPreset) throw new Error('Raspberry Pi preset not found');

const raspberry = createCaseFromPreset(raspberryPreset);
raspberry.name = 'Raspberry Pi 4B 外壳';
raspberry.openings = [
  {
    side: 'front',
    shape: 'rect',
    u: -22,
    v: 0,
    width: 15,
    height: 8,
  },
  {
    side: 'front',
    shape: 'rect',
    u: 0,
    v: 0,
    width: 15,
    height: 8,
  },
  {
    side: 'front',
    shape: 'rect',
    u: 23,
    v: 0,
    width: 16,
    height: 9,
  },
  {
    side: 'left',
    shape: 'rect',
    u: 0,
    v: 0,
    width: 10,
    height: 5,
  },
];
raspberry.enclosure.vent.slot_length = 30;
// Raspberry Pi mounting holes are 2.7 mm, so the integrated columns use M2.5
// clearance rather than the M3 default.
raspberry.enclosure.screw_clearance = 2.9;

const sensor = createCaseFromPreset({
  name: 'Sensor Node 60×40',
  board: {
    length: 60,
    width: 40,
    thickness: 1.6,
    corner_radius: 4,
    color: '#214f2f',
  },
  holes: [
    { x: -24.5, y: -15, diameter: 3.2 },
    { x: 24.5, y: -15, diameter: 3.2 },
    { x: 24.5, y: 15, diameter: 3.2 },
    { x: -24.5, y: 15, diameter: 3.2 },
  ],
});
sensor.name = 'Sensor Node 60×40 外壳';
sensor.enclosure.top_gap = 16;
sensor.openings = [
  {
    ...createOpening('left', 'circle'),
    u: 0,
    v: 0,
    diameter: 12,
  },
  {
    ...createOpening('front', 'rect'),
    u: 0,
    v: 0,
    width: 18,
    height: 8,
  },
];
sensor.enclosure.vent.count = 4;

const samples = [
  { slug: 'raspberry-pi-4b-case', state: raspberry },
  { slug: 'sensor-node-case', state: sensor },
];

for (const sample of samples) {
  sample.state.meta = { created: fixedDate, updated: fixedDate };
  const documentData = toCaseDocument(sample.state, { now: fixedDate });
  await writeFile(
    resolve(outputDirectory, `${sample.slug}.case.json`),
    `${JSON.stringify(documentData, null, 2)}\n`,
    'utf8',
  );

  const model = buildCaseModel(sample.state);
  if (model.warnings.length > 0) {
    throw new Error(`${sample.slug}: ${model.warnings.join(' ')}`);
  }
  const dxf = buildCutDxf(model);
  const svg = buildCutSvg(model);

  await writeFile(resolve(outputDirectory, `${sample.slug}-cut.dxf`), dxf, 'utf8');
  await writeFile(resolve(outputDirectory, `${sample.slug}-cut.svg`), svg, 'utf8');

  console.log(
    `${sample.slug}: ${model.panelCount} panels, ${model.triangleCount} panel triangles, ` +
      `${(dxf.length / 1024).toFixed(1)} KB DXF`,
  );

  for (const panel of model.panels) panel.geometry.dispose();
  model.board.geometry.dispose();
}
