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
const work = join(tmpdir(), `boardforge-case-test-${process.pid}`);

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
    { timeout: 30_000 },
  );
  await page.waitForTimeout(80);
}

async function waitReady() {
  await page.waitForFunction(() => Boolean(window.boardForge?.getDiagnostics()), {
    timeout: 30_000,
  });
  await waitIdle();
}

async function diagnostics() {
  return page.evaluate(() => window.boardForge.getDiagnostics());
}

async function state() {
  return page.evaluate(() => window.boardForge.getState());
}

async function download(selector, destination) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const [downloadEvent] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(selector).click(),
  ]);
  await downloadEvent.saveAs(destination);
  return downloadEvent;
}

function parseBinaryStl(buffer) {
  assert.ok(buffer.length >= 84, 'STL must have a header and triangle count');
  const triangles = buffer.readUInt32LE(80);
  assert.equal(buffer.length, 84 + triangles * 50, 'binary STL byte length must be exact');
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let index = 0; index < triangles; index += 1) {
    const offset = 84 + index * 50;
    const values = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = offset + 12 + vertex * 12;
      values.push([
        buffer.readFloatLE(vertexOffset),
        buffer.readFloatLE(vertexOffset + 4),
        buffer.readFloatLE(vertexOffset + 8),
      ]);
    }
    for (const [x, y, z] of values) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { triangles, minX, maxX, minZ, maxZ };
}

try {
  await page.goto(appUrl, { waitUntil: 'load' });
  await waitReady();

  const initial = { state: await state(), diagnostics: await diagnostics() };
  ok(initial.state.version === 2, 'default document is case format version 2');
  ok(initial.state.format === 'boardforge-case', 'default document uses boardforge-case format');
  ok(initial.state.enclosure.panel_thickness === 3, 'default acrylic is 3 mm');
  ok(initial.diagnostics.panelCount === 6, 'six panels are generated');
  ok(initial.diagnostics.columnCount === 4, 'four integrated columns are generated');
  ok(initial.diagnostics.mountCount === 4, 'four board mount positions are used');
  ok(initial.diagnostics.lowerStandoffCount === 4, 'four lower standoffs are generated');
  ok(initial.diagnostics.upperStandoffCount === 4, 'four upper standoffs are generated');
  ok(initial.diagnostics.warnings.length === 0, 'default enclosure has no warnings');
  ok(initial.diagnostics.outer.width === 95, 'default outer width is a snug 95 mm');
  ok(initial.diagnostics.outer.depth === 66, 'default outer depth is a snug 66 mm');
  ok(initial.diagnostics.outer.height === 29.6, 'default outer height is 29.6 mm');
  ok(initial.diagnostics.boardWatertight, 'board reference remains watertight');
  ok((await page.locator('#modelStatusText').textContent()).includes('6 面板'), 'status reports six panels');
  ok((await page.evaluate(() => window.boardForge.getMode())) === 'dark', 'default mode is dark');
  ok(
    (await page.locator('#hardwareNote').textContent()).includes('固定柱'),
    'hardware note explains integrated standoff columns',
  );

  // A smaller clearance removes the board-hole compatibility warning.
  await page.locator('#screwClearanceInput').fill('2.9');
  await waitIdle();
  ok(
    !(await page.locator('#hardwareNote').getAttribute('class')).includes('is-warning'),
    'compatible screw clearance clears the hardware warning',
  );
  await page.locator('#screwClearanceInput').fill('3.4');
  await waitIdle();

  await page.screenshot({ path: join(screenshots, 'case-default.png') });

  // Perspective / orthographic projection switch.
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'perspective',
    'default camera uses perspective projection',
  );
  await page.locator('#projectionButton').click();
  await page.waitForTimeout(250);
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'orthographic',
    'projection button switches to orthographic projection',
  );
  ok(
    (await page.locator('#projectionButtonLabel').textContent()) === '正交',
    'projection button reflects orthographic mode',
  );
  ok(
    (await page.locator('#projectionButton').getAttribute('aria-pressed')) === 'true',
    'projection toggle exposes its pressed state',
  );
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-orthographic.png') });
  await page.locator('#projectionButton').click();
  await page.waitForTimeout(120);
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'perspective',
    'projection button switches back to perspective',
  );

  // Orthographic-style side views are axis-aligned for accurate cut-out placement.
  const sideViews = {
    front: [0, -1, 0],
    back: [0, 1, 0],
    left: [-1, 0, 0],
    right: [1, 0, 0],
  };
  ok((await page.locator('[data-view]').count()) === 6, 'all six view presets are available');
  for (const [side, expected] of Object.entries(sideViews)) {
    await page.locator(`[data-view="${side}"]`).click();
    await page.waitForTimeout(460);
    const camera = await page.evaluate(() => window.boardForge.getCamera());
    ok(camera.view === side, `${side} view becomes active`);
    ok(
      camera.direction.every((value, index) => Math.abs(value - expected[index]) < 0.02),
      `${side} view is perpendicular to its panel`,
    );
  }
  await page.locator('[data-view="iso"]').click();
  await page.waitForTimeout(460);

  // Theme and mode controls remain available in the enclosure-first UI.
  await page.locator('#themeButton').click();
  await page.locator('[data-theme-preset="sky"]').click();
  ok((await page.evaluate(() => window.boardForge.getTheme())) === '#7dd3fc', 'theme preset updates accent');
  await page.keyboard.press('Escape');
  await page.locator('#modeButton').click();
  await page.waitForTimeout(520);
  const light = await page.evaluate(() => ({
    mode: window.boardForge.getMode(),
    root: document.documentElement.dataset.mode,
    background: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem('boardforge.mode.v1'),
  }));
  ok(light.mode === 'light' && light.root === 'light', 'light mode switches the shell UI');
  ok(light.background === 'rgb(237, 242, 238)', 'light mode applies a light background');
  ok(light.stored === 'light', 'light mode preference is persisted');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-light.png') });

  // Preset loads a new board and resets the enclosure.
  await page.locator('[data-preset-id="esp32-devkit"]').click();
  await waitIdle();
  const presetState = await state();
  ok(presetState.name === 'ESP32 DevKit V1 外壳', 'preset loads a named enclosure');
  ok(presetState.board.length === 49, 'preset updates board length');
  ok((await diagnostics()).panelCount === 6, 'preset still builds six panels');
  await page.locator('[data-preset-id="raspberry-pi-4b"]').click();
  await waitIdle();

  // Enclosure inputs drive the derived dimensions.
  await page.locator('#panelThicknessInput').fill('4');
  await waitIdle();
  const thicker = await diagnostics();
  ok(thicker.outer.width === 97 && thicker.outer.depth === 68, 'panel thickness increases outer dimensions');
  ok(thicker.outer.height === 31.6, 'panel thickness increases outer height');

  await page.locator('#panelThicknessInput').fill('3');
  await page.locator('#clearanceInput').fill('8');
  await waitIdle();
  const wider = await diagnostics();
  ok(wider.outer.width === 107 && wider.outer.depth === 78, 'clearance increases outer footprint');
  await page.locator('#clearanceInput').fill('6');
  await waitIdle();

  // Board reference remains editable and feeds the enclosure.
  await page.locator('#boardDetails summary').click();
  ok(await page.locator('#lengthInput').isVisible(), 'board reference details expand');
  await page.locator('#lengthInput').fill('90');
  await waitIdle();
  const longerBoard = await state();
  ok(longerBoard.board.length === 90, 'board length can be edited');
  ok((await diagnostics()).outer.width === 108, 'board length feeds the enclosure dimensions');
  await page.locator('#lengthInput').fill('85');
  await waitIdle();

  // Add a valid side-panel cut-out.
  await page.locator('#addOpeningButton').click();
  await page.waitForTimeout(150);
  ok((await page.locator('.opening-card').count()) === 1, 'an opening card can be added');
  let card = page.locator('.opening-card').first();
  await card.locator('[data-opening-field="u"]').fill('-15');
  await card.locator('[data-opening-field="v"]').fill('0');
  await card.locator('[data-opening-field="width"]').fill('16');
  await card.locator('[data-opening-field="height"]').fill('9');
  await waitIdle();
  let currentDiagnostics = await diagnostics();
  const frontPanel = currentDiagnostics.panels.find((panel) => panel.id === 'front');
  ok(frontPanel.holes >= 1, 'valid opening is cut into the front panel');
  ok(currentDiagnostics.warnings.length === 0, 'valid opening produces no warning');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-opening.png') });

  // Out-of-bounds cut-outs are reported without breaking the model.
  await card.locator('[data-opening-field="u"]').fill('200');
  await waitIdle();
  currentDiagnostics = await diagnostics();
  ok(
    currentDiagnostics.warnings.some((warning) => warning.includes('开孔')),
    'out-of-bounds opening is reported',
  );
  ok(await page.locator('#openingsHint').isVisible(), 'opening warning is shown in the form');
  await card.locator('[data-opening-field="u"]').fill('-15');
  await waitIdle();

  // Change opening side and shape.
  await card.locator('[data-opening-field="side"]').selectOption('left');
  await waitIdle();
  currentDiagnostics = await diagnostics();
  ok(
    currentDiagnostics.panels.find((panel) => panel.id === 'left').holes >= 1,
    'opening can be moved to another side',
  );
  card = page.locator('.opening-card').first();
  await card.locator('[data-opening-field="shape"]').selectOption('circle');
  await waitIdle();
  card = page.locator('.opening-card').first();
  ok(await card.locator('[data-opening-field="diameter"]').isVisible(), 'circle opening exposes a diameter field');
  const openingState = await state();
  ok(openingState.openings[0].shape === 'circle', 'opening shape is stored');

  // Vent toggle.
  const ventTopBefore = (await diagnostics()).panels.find((panel) => panel.id === 'top').holes;
  await page.locator('.switch-row').click();
  await waitIdle();
  const ventTopAfter = (await diagnostics()).panels.find((panel) => panel.id === 'top').holes;
  ok(!(await page.locator('#ventEnabledInput').isChecked()), 'vent switch can be turned off');
  ok(ventTopAfter < ventTopBefore, 'disabling vents removes top-panel slots');
  ok((await state()).enclosure.vent.enabled === false, 'vent state is persisted in parameters');
  await page.locator('.switch-row').click();
  await waitIdle();
  ok(await page.locator('#ventEnabledInput').isChecked(), 'vent switch can be turned back on');

  // Invalid dimensions block exports and clamp on blur.
  await page.locator('#panelThicknessInput').fill('0');
  await page.waitForTimeout(100);
  ok(await page.locator('#exportDxfButton').isDisabled(), 'DXF export is blocked for invalid thickness');
  await page.locator('#panelThicknessInput').blur();
  await waitIdle();
  ok((await page.locator('#panelThicknessInput').inputValue()) === '1', 'invalid thickness clamps to 1 mm');
  await page.locator('#panelThicknessInput').fill('3');
  await waitIdle();

  // Exploded view.
  await page.locator('#explodeButton').click();
  await page.waitForTimeout(650);
  ok((await page.evaluate(() => window.boardForge.getExploded())) === true, 'exploded view can be enabled');
  ok((await page.locator('#explodeButton').getAttribute('aria-pressed')) === 'true', 'explode button updates its state');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-exploded.png') });

  // Export JSON.
  const jsonPath = join(work, 'case.case.json');
  const jsonDownload = await download('#exportJsonButton', jsonPath);
  ok(jsonDownload.suggestedFilename().endsWith('.case.json'), 'JSON export uses .case.json');
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8'));
  ok(exportedJson.version === 2 && exportedJson.format === 'boardforge-case', 'JSON uses case format');
  ok(exportedJson.enclosure.panel_thickness === 3, 'JSON contains enclosure settings');
  ok(exportedJson.openings.length === 1, 'JSON contains side-panel openings');
  ok(exportedJson.board.length === 85, 'JSON contains board reference');

  // Export SVG, DXF and assembly STL.
  const svgPath = join(work, 'case-cut.svg');
  const svgDownload = await download('#exportSvgButton', svgPath);
  ok(svgDownload.suggestedFilename().endsWith('-cut.svg'), 'SVG filename is generated');
  const svg = await readFile(svgPath, 'utf8');
  ok(svg.includes('<svg') && svg.includes('width="'), 'SVG contains a physical-size document');
  ok(svg.includes('<g id="top"') && svg.includes('<g id="bottom"'), 'SVG contains named panels');

  const dxfPath = join(work, 'case-cut.dxf');
  const dxfDownload = await download('#exportDxfButton', dxfPath);
  ok(dxfDownload.suggestedFilename().endsWith('-cut.dxf'), 'DXF filename is generated');
  const dxf = await readFile(dxfPath, 'utf8');
  ok(dxf.includes('AC1009'), 'DXF is R12-compatible');
  ok(dxf.includes('$INSUNITS'), 'DXF declares units');
  ok(dxf.includes('LAYER\n2\nCUT'), 'DXF contains a CUT layer');
  ok((dxf.match(/POLYLINE/g) || []).length >= 6, 'DXF contains six panel outlines');

  const stlPath = join(work, 'case-assembly.stl');
  const stlDownload = await download('#exportStlButton', stlPath);
  ok(stlDownload.suggestedFilename().endsWith('-assembly.stl'), 'STL filename is generated');
  const stlBuffer = await readFile(stlPath);
  const stl = parseBinaryStl(stlBuffer);
  const exportDiagnostics = await diagnostics();
  ok(stl.triangles > exportDiagnostics.triangleCount, 'assembly STL includes panels and hardware');
  ok(
    stl.maxZ > exportDiagnostics.outer.height,
    'assembly STL includes the upper hardware envelope',
  );

  // Import the exported case document.
  const imported = structuredClone(exportedJson);
  imported.name = 'Imported Acrylic Case';
  imported.enclosure.clearance = 9;
  imported.openings = [
    { side: 'back', shape: 'rect', u: 0, v: 0, width: 22, height: 10 },
  ];
  const importPath = join(work, 'import.case.json');
  await writeFile(importPath, JSON.stringify(imported, null, 2));
  await page.locator('#fileInput').setInputFiles(importPath);
  await page.waitForFunction(() => window.boardForge.getState().name === 'Imported Acrylic Case');
  await waitIdle();
  const importedState = await state();
  ok(importedState.enclosure.clearance === 9, 'file import restores enclosure settings');
  ok(importedState.openings.length === 1 && importedState.openings[0].side === 'back', 'file import restores openings');

  // Drag-and-drop legacy board JSON still imports.
  const legacy = {
    version: 1,
    name: 'Legacy Board',
    units: 'mm',
    board: { length: 70, width: 40, thickness: 1.6, corner_radius: 2, color: '#1a5f2a' },
    holes: [
      { x: -30, y: -15, diameter: 2.7 },
      { x: 30, y: -15, diameter: 2.7 },
      { x: 30, y: 15, diameter: 2.7 },
      { x: -30, y: 15, diameter: 2.7 },
    ],
  };
  await page.evaluate((json) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([json], 'legacy.board.json', { type: 'application/json' }));
    window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, JSON.stringify(legacy));
  await page.waitForFunction(() => window.boardForge.getState().name === 'Legacy Board');
  await waitIdle();
  const dropped = await state();
  ok(dropped.board.length === 70, 'drag-and-drop board document is migrated');
  ok(dropped.enclosure.panel_thickness === 3, 'migrated document receives default enclosure');

  // Autosave, mode, theme and projection persistence.
  await page.locator('#projectionButton').click();
  await page.waitForTimeout(120);
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'orthographic',
    'projection can be set to orthographic before reload',
  );
  await page.evaluate(() => window.boardForge.flushSave());
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await waitReady();
  const restored = await page.evaluate(() => ({
    state: window.boardForge.getState(),
    mode: window.boardForge.getMode(),
    theme: window.boardForge.getTheme(),
    projection: window.boardForge.getProjection(),
  }));
  ok(restored.state.name === 'Legacy Board', 'autosaved case survives reload');
  ok(restored.mode === 'light', 'light mode survives reload');
  ok(restored.theme === '#7dd3fc', 'theme colour survives reload');
  ok(restored.projection === 'orthographic', 'orthographic projection survives reload');

  ok(consoleErrors.length === 0, `no browser errors were emitted:\n${consoleErrors.join('\n')}`);

  // Mobile layout smoke tests.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await mobile.goto(appUrl, { waitUntil: 'load' });
  await mobile.waitForFunction(() => window.boardForge?.getDiagnostics(), { timeout: 30_000 });
  const noOverflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  ok(noOverflow, 'mobile layout has no horizontal overflow');
  await mobile.screenshot({ path: join(screenshots, 'case-mobile.png') });

  await mobile.locator('#modeButton').click();
  await mobile.waitForTimeout(550);
  const mobileLight = await mobile.evaluate(() => ({
    mode: window.boardForge.getMode(),
    noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  ok(mobileLight.mode === 'light', 'mobile mode toggle switches to light mode');
  ok(mobileLight.noOverflow, 'mobile light mode has no horizontal overflow');
  await mobile.screenshot({ path: join(screenshots, 'case-mobile-light.png') });
  await mobile.close();

  console.log(`\nBoardForge enclosure checks passed: ${checks}`);
  console.log(`Screenshots written to ${screenshots}`);
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
