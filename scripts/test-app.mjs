import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { chromium } from 'playwright-core';

const root = resolve(process.cwd());
const appUrl = pathToFileURL(resolve(root, 'dist/index.html')).href;
const screenshots = resolve(root, 'screenshots');
const work = join(tmpdir(), `boardforge-test-${process.pid}`);

if (!existsSync(resolve(root, 'dist/index.html'))) {
  throw new Error('dist/index.html is missing. Run `npm run build` first.');
}
await mkdir(work, { recursive: true });
await mkdir(screenshots, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--allow-file-access-from-files',
  ],
});

const consoleErrors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});

page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
});

let checks = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

async function waitIdle() {
  await page.waitForFunction(
    () => window.boardForge?.getDiagnostics() && !window.boardForge.isBusy(),
    { timeout: 25_000 },
  );
}

async function waitReady() {
  await page.waitForFunction(() => Boolean(window.boardForge?.getDiagnostics()), {
    timeout: 25_000,
  });
  await waitIdle();
}

function parseBinaryStl(buffer) {
  assert.ok(buffer.length >= 84, 'STL must have a header and triangle count');
  const triangles = buffer.readUInt32LE(80);
  assert.equal(buffer.length, 84 + triangles * 50, 'binary STL byte length must be exact');

  const trianglesData = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const edgeCounts = new Map();

  const keyFor = (x, y, z) =>
    `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;

  for (let index = 0; index < triangles; index += 1) {
    let offset = 84 + index * 50;
    const normal = [];
    for (let n = 0; n < 3; n += 1) {
      normal.push(buffer.readFloatLE(offset));
      offset += 4;
    }
    const vertices = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const x = buffer.readFloatLE(offset);
      const y = buffer.readFloatLE(offset + 4);
      const z = buffer.readFloatLE(offset + 8);
      offset += 12;
      vertices.push([x, y, z]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    const attribute = buffer.readUInt16LE(offset);
    assert.equal(attribute, 0);
    assert.ok(normal.every(Number.isFinite), 'STL normals must be finite');
    trianglesData.push(vertices.map((vertex) => keyFor(...vertex)));

    for (let edge = 0; edge < 3; edge += 1) {
      const a = keyFor(...vertices[edge]);
      const b = keyFor(...vertices[(edge + 1) % 3]);
      if (a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  return {
    triangles,
    trianglesData,
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
    edgeCounts,
  };
}

try {
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await waitReady();

  const initial = await page.evaluate(() => ({
    state: window.boardForge.getState(),
    diagnostics: window.boardForge.getDiagnostics(),
  }));
  ok(initial.diagnostics.construction === 'csg', 'default model uses real CSG subtraction');
  ok(initial.diagnostics.watertight, 'default model is watertight');
  ok(initial.diagnostics.triangles > 0, 'default model has triangles');
  ok(initial.diagnostics.outsideHoles === 0, 'default holes fit on the board');
  ok(initial.state.holes.length === 4, 'default state has four holes');
  ok(initial.state.board.color === '#1a5f2a', 'default board color matches the specification');
  ok(initial.state.units === 'mm', 'state units are millimetres');
  ok(await page.locator('.hole-row').count() === 4, 'four hole rows are rendered');
  ok((await page.evaluate(() => window.boardForge.getMode())) === 'dark', 'default interface mode is dark');

  await page.screenshot({ path: join(screenshots, 'app-default.png') });

  // Interface theme is configurable, persisted separately and does not alter the board.
  await page.locator('#themeButton').click();
  ok(await page.locator('#themeMenu').isVisible(), 'theme menu opens from the top bar');
  ok(
    (await page.locator('#themeButton').getAttribute('aria-expanded')) === 'true',
    'theme menu updates its expanded state',
  );
  await page.locator('[data-theme-preset="sky"]').click();
  const themeState = await page.evaluate(() => ({
    selected: window.boardForge.getTheme(),
    accent: getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim(),
    boardColor: window.boardForge.getState().board.color,
    stored: localStorage.getItem('boardforge.theme.v1'),
  }));
  ok(themeState.selected === '#7dd3fc', 'theme preset updates the UI accent colour');
  ok(themeState.accent === '#7dd3fc', 'theme accent is exposed to CSS variables');
  ok(themeState.boardColor === '#1a5f2a', 'theme colour does not change the board colour');
  ok(themeState.stored?.includes('#7dd3fc'), 'theme preference is saved locally');
  await page.keyboard.press('Escape');
  ok(await page.locator('#themeMenu').isHidden(), 'theme menu closes with Escape');

  // Dark/light mode toggle.
  await page.locator('#modeButton').click();
  await page.waitForTimeout(520);
  const lightMode = await page.evaluate(() => ({
    mode: window.boardForge.getMode(),
    attribute: document.documentElement.dataset.mode,
    background: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem('boardforge.mode.v1'),
    theme: window.boardForge.getTheme(),
    boardColor: window.boardForge.getState().board.color,
  }));
  ok(lightMode.mode === 'light', 'mode button switches to light mode');
  ok(lightMode.attribute === 'light', 'light mode is exposed on the document root');
  ok(lightMode.background === 'rgb(237, 242, 238)', 'light mode applies a light surface colour');
  ok(lightMode.stored === 'light', 'light mode preference is saved locally');
  ok(lightMode.theme === '#7dd3fc', 'mode switch preserves the selected accent colour');
  ok(lightMode.boardColor === '#1a5f2a', 'mode switch preserves the board colour');
  ok((await page.locator('#modeButtonLabel').textContent()) === '浅色', 'mode button reflects the current mode');
  ok((await page.locator('#modeButton').getAttribute('aria-label')) === '切换到深色模式', 'mode button announces the next action');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'app-light.png') });

  // Real-time dimension change.
  await page.locator('#lengthInput').fill('100');
  await waitIdle();
  const resized = await page.evaluate(() => window.boardForge.getDiagnostics());
  ok(Math.abs(resized.bbox.min[0] + 50) < 0.02, 'length update rebuilt the model');
  ok(Math.abs(resized.bbox.max[0] - 50) < 0.02, 'length update rebuilt the model (max X)');
  ok(resized.watertight, 'resized model remains watertight');

  // Add a fifth hole and edit it.
  await page.locator('#addHoleButton').click();
  await page.waitForFunction(() => document.querySelectorAll('.hole-row').length === 5);
  const lastRow = page.locator('.hole-row').last();
  await lastRow.locator('[data-hole="x"]').fill('10');
  await lastRow.locator('[data-hole="y"]').fill('5');
  await lastRow.locator('[data-hole="diameter"]').fill('3.2');
  await waitIdle();
  const withExtraHole = await page.evaluate(() => window.boardForge.getState());
  ok(withExtraHole.holes.length === 5, 'hole can be added');
  ok(withExtraHole.holes[4].x === 10 && withExtraHole.holes[4].diameter === 3.2, 'hole fields update state');

  // Export editable JSON.
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportJsonButton').click(),
  ]);
  ok(jsonDownload.suggestedFilename() === 'board-100x56.board.json', 'JSON filename is generated automatically');
  const jsonPath = join(work, 'exported.board.json');
  await jsonDownload.saveAs(jsonPath);
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8'));
  ok(exportedJson.version === 1 && exportedJson.units === 'mm', 'JSON contains version and units');
  ok(exportedJson.board.length === 100 && exportedJson.holes.length === 5, 'JSON contains all current parameters');

  // Export binary STL and validate at the triangle/edge level.
  const [stlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportStlButton').click(),
  ]);
  ok(stlDownload.suggestedFilename() === 'board-100x56.stl', 'STL filename is generated automatically');
  const stlPath = join(work, 'exported.stl');
  await stlDownload.saveAs(stlPath);
  const stlBuffer = await readFile(stlPath);
  const stl = parseBinaryStl(stlBuffer);
  const currentDiagnostics = await page.evaluate(() => window.boardForge.getDiagnostics());
  ok(stl.triangles === currentDiagnostics.triangles, 'STL triangle count matches the preview');
  ok(Math.abs(stl.bounds.minX + 50) < 0.01 && Math.abs(stl.bounds.maxX - 50) < 0.01, 'STL X bounds match 100 mm');
  ok(Math.abs(stl.bounds.minY + 28) < 0.01 && Math.abs(stl.bounds.maxY - 28) < 0.01, 'STL Y bounds match 56 mm');
  ok(Math.abs(stl.bounds.minZ + 0.8) < 0.01 && Math.abs(stl.bounds.maxZ - 0.8) < 0.01, 'STL Z bounds match 1.6 mm thickness');
  const badEdges = [...stl.edgeCounts.values()].filter((count) => count !== 2);
  ok(badEdges.length === 0, 'exported STL is a closed manifold surface');
  ok(stl.triangles > 0, 'STL contains triangles');

  // Import through the file input.
  const importedDocument = structuredClone(exportedJson);
  importedDocument.name = 'Imported Board';
  importedDocument.board.length = 72;
  importedDocument.holes = [{ x: -10, y: -5, diameter: 2.2 }];
  const importPath = join(work, 'import.board.json');
  await writeFile(importPath, JSON.stringify(importedDocument, null, 2));
  await page.locator('#fileInput').setInputFiles(importPath);
  await page.waitForFunction(() => window.boardForge.getState().name === 'Imported Board');
  await waitIdle();
  const importedState = await page.evaluate(() => window.boardForge.getState());
  ok(importedState.board.length === 72, 'file import restores board size');
  ok(importedState.holes.length === 1 && importedState.holes[0].diameter === 2.2, 'file import restores holes');
  ok(await page.locator('.hole-row').count() === 1, 'file import updates the hole form');

  // Import by drag and drop.
  const droppedDocument = structuredClone(importedDocument);
  droppedDocument.name = 'Dropped Board';
  droppedDocument.board.width = 34;
  await page.evaluate((json) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], 'dropped.board.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, JSON.stringify(droppedDocument));
  await page.waitForFunction(() => window.boardForge.getState().name === 'Dropped Board');
  await waitIdle();
  ok((await page.evaluate(() => window.boardForge.getState().board.width)) === 34, 'drag-and-drop import restores parameters');

  // Validation blocks export while a field is invalid, then clamps on blur.
  await page.locator('#thicknessInput').fill('0');
  await page.waitForTimeout(120);
  ok(await page.locator('#exportStlButton').isDisabled(), 'STL export is blocked for invalid thickness');
  ok((await page.locator('#modelStatusText').textContent()).includes('待修正'), 'invalid input is signalled in the status');
  await page.locator('#thicknessInput').blur();
  await waitIdle();
  ok((await page.locator('#thicknessInput').inputValue()) === '0.2', 'invalid thickness clamps to the minimum');
  ok(!(await page.locator('#exportStlButton').isDisabled()), 'STL export recovers after correction');

  // Out-of-bounds holes are reported and skipped, but the model stays printable.
  await page.locator('.hole-row').first().locator('[data-hole="x"]').fill('100');
  await waitIdle();
  const outside = await page.evaluate(() => window.boardForge.getDiagnostics());
  ok(outside.outsideHoles === 1, 'an out-of-bounds hole is skipped');
  ok(outside.watertight, 'model remains watertight after skipping a hole');
  ok((await page.locator('#modelStatusText').textContent()).includes('越界'), 'out-of-bounds hole is reported');
  ok(!(await page.locator('#exportStlButton').isDisabled()), 'STL can still be exported without the invalid hole');

  // Preset and view controls.
  await page.locator('[data-preset-id="esp32-devkit"]').click();
  await waitIdle();
  const presetState = await page.evaluate(() => window.boardForge.getState());
  ok(presetState.name === 'ESP32 DevKit V1' && presetState.board.length === 49, 'preset loads board dimensions');
  ok((await page.locator('.hole-row').count()) === 0, 'preset loads its hole list');

  await page.locator('[data-view="top"]').click();
  await page.waitForTimeout(450);
  ok((await page.locator('.view-switch button.active').textContent()) === '顶视', 'view switch updates camera mode');
  ok((await page.evaluate(() => window.boardForge.activeView())) === 'top', 'preview reports the active view');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'app-top-view.png') });

  // Autosave survives a reload.
  await page.evaluate(() => window.boardForge.flushSave());
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await waitReady();
  const restored = await page.evaluate(() => ({
    state: window.boardForge.getState(),
    theme: window.boardForge.getTheme(),
    mode: window.boardForge.getMode(),
    attribute: document.documentElement.dataset.mode,
  }));
  ok(restored.state.name === 'ESP32 DevKit V1', 'autosaved parameters survive reload');
  ok(restored.state.board.length === 49, 'autosaved dimensions survive reload');
  ok(restored.theme === '#7dd3fc', 'selected theme survives reload');
  ok(restored.mode === 'light' && restored.attribute === 'light', 'light mode survives reload');

  ok(consoleErrors.length === 0, `no browser errors were emitted:\n${consoleErrors.join('\n')}`);

  // Basic mobile layout smoke test.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await mobile.goto(appUrl, { waitUntil: 'load' });
  await mobile.waitForFunction(() => window.boardForge?.getDiagnostics(), { timeout: 25_000 });
  const noOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  ok(noOverflow, 'mobile layout has no horizontal overflow');
  await mobile.screenshot({ path: join(screenshots, 'app-mobile.png') });

  await mobile.locator('#modeButton').click();
  await mobile.waitForTimeout(520);
  const mobileLight = await mobile.evaluate(() => ({
    mode: window.boardForge.getMode(),
    noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  ok(mobileLight.mode === 'light', 'mobile mode toggle switches to light mode');
  ok(mobileLight.noOverflow, 'mobile light mode has no horizontal overflow');
  await mobile.screenshot({ path: join(screenshots, 'app-mobile-light.png') });
  await mobile.close();

  console.log(`\nBoardForge checks passed: ${checks}`);
  console.log(`Screenshots written to ${screenshots}`);
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
