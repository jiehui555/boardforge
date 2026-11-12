import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  PRESETS,
  createStateFromPreset,
  toBoardDocument,
} from '../src/schema.js';
import { buildBoardModel } from '../src/board-geometry.js';
import { createBinaryStl } from '../src/stl-export.js';

const outputDirectory = resolve(process.cwd(), 'samples');
await mkdir(outputDirectory, { recursive: true });

const fixedDate = '2026-11-12T09:00:00+08:00';

const samples = [
  {
    preset: PRESETS.find((preset) => preset.id === 'raspberry-pi-4b'),
    slug: 'raspberry-pi-4b',
  },
  {
    preset: {
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
    },
    slug: 'sensor-node-60x40',
  },
];

for (const sample of samples) {
  if (!sample.preset) throw new Error('Missing preset');
  const state = createStateFromPreset(sample.preset);
  state.meta = { created: fixedDate, updated: fixedDate };
  const documentData = toBoardDocument(state, { now: fixedDate });
  const filename = `${sample.slug}.board.json`;
  await writeFile(
    resolve(outputDirectory, filename),
    `${JSON.stringify(documentData, null, 2)}\n`,
    'utf8',
  );

  const model = buildBoardModel(state);
  if (!model.watertight) {
    throw new Error(`${filename}: geometry is not watertight`);
  }
  const stl = createBinaryStl(model.geometry, { name: documentData.name });
  await writeFile(resolve(outputDirectory, `${sample.slug}.stl`), Buffer.from(stl));
  console.log(
    `${filename}: ${model.triangles} triangles, ${model.construction}, ` +
      `${(stl.byteLength / 1024).toFixed(1)} KB STL`,
  );
  model.geometry.dispose();
}
