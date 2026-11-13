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

async function openAccordion(name) {
  const section = page.locator(`.accordion-section[data-accordion="${name}"]`);
  if (!(await section.evaluate((element) => element.open))) {
    await section.locator(':scope > summary').click();
    await page.waitForTimeout(180);
  }
}

async function selectView(view) {
  if (['front', 'back', 'left', 'right'].includes(view)) {
    if ((await page.locator('#viewMenuButton').getAttribute('aria-expanded')) !== 'true') {
      await page.locator('#viewMenuButton').click();
    }
    await page.locator(`#viewMenu [data-view="${view}"]`).click();
  } else {
    await page.locator(`.view-switch > button[data-view="${view}"]`).click();
  }
}

async function dragPreview(deltaX, deltaY) {
  const box = await page.locator('#previewCanvas').boundingBox();
  const x = box.x + box.width * 0.62;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(450);
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

async function waitForLauncher(targetPage = page) {
  await targetPage.waitForSelector('#projectLauncher:not([hidden])', {
    timeout: 5_000,
  });
}

async function dismissLauncher(targetPage = page) {
  if (await targetPage.locator('#projectLauncher').isVisible()) {
    await targetPage.locator('#launcherContinueButton').click();
    await targetPage.waitForTimeout(150);
  }
}

try {
  await page.goto(appUrl, { waitUntil: 'load' });
  await waitReady();
  await waitForLauncher();
  ok(await page.locator('#projectLauncher').isVisible(), 'project launcher opens at startup');
  await dismissLauncher();

  const initial = { state: await state(), diagnostics: await diagnostics() };
  ok(initial.state.version === 2, 'default document is case format version 2');
  ok(initial.state.format === 'boardforge-case', 'default document uses boardforge-case format');
  ok(initial.state.enclosure.panel_thickness === 3, 'default acrylic is 3 mm');
  ok(initial.diagnostics.panelCount === 6, 'six panels are generated');
  ok(initial.diagnostics.columnCount === 4, 'four integrated columns are generated');
  ok(initial.diagnostics.mountCount === 4, 'four board mount positions are used');
  ok(initial.diagnostics.lowerStandoffCount === 4, 'four lower standoffs are generated');
  ok(initial.diagnostics.upperStandoffCount === 4, 'four upper standoffs are generated');
  ok(initial.diagnostics.connectorShaftCount === 4, 'through-board connectors are generated');
  ok(initial.diagnostics.screwShaftCount === 8, 'all eight panel screws include shafts');
  ok(initial.diagnostics.boardFromCache === false, 'first build creates the board reference');
  ok(initial.diagnostics.warnings.length === 0, 'default enclosure has no warnings');
  ok((await page.locator('#panelMap svg').count()) === 1, '2D side-panel editor renders');
  ok((await page.locator('.panel-side-tab').count()) === 4, 'all four panels are selectable in the 2D editor');
  ok((await page.locator('#bomList li').count()) === 6, 'hardware BOM is populated');
  ok(
    (await page.locator('#hardwareSummary').textContent()).includes('固定柱'),
    'BOM summary reports the integrated columns',
  );
  ok(
    (await page.locator('.accordion-section[open]').count()) === 1,
    'only one major sidebar module is open initially',
  );
  ok(
    (await page.locator('.accordion-section[data-accordion="enclosure"]').evaluate((element) => element.open)) === true,
    'enclosure dimensions are open by default',
  );
  ok(await page.locator('#lengthInput').isHidden(), 'collapsed board reference hides its fields');
  ok(initial.diagnostics.outer.width === 101, 'default outer width includes the 3 mm retaining lip');
  ok(initial.diagnostics.outer.depth === 72, 'default outer depth includes the 3 mm retaining lip');
  ok(initial.diagnostics.outer.height === 29.6, 'default outer height is 29.6 mm');
  ok(initial.diagnostics.boardWatertight, 'board reference remains watertight');
  ok((await page.locator('#modelStatusText').textContent()).includes('6 面板'), 'status reports six panels');
  ok((await page.evaluate(() => window.boardForge.getMode())) === 'dark', 'default mode is dark');
  ok(
    (await page.locator('#hardwareNote').textContent()).includes('M3'),
    'hardware note explains the standard standoff spec',
  );
  ok(
    (await page.locator('#screwSpecSelect').inputValue()) === 'M3' &&
      (await page.locator('#screwSpecSelect option').count()) === 4,
    'hardware spec selector exposes standard metric sizes',
  );

  // A smaller clearance removes the board-hole compatibility warning.
  await openAccordion('mechanical');
  ok(
    (await page.locator('.accordion-section[open]').count()) === 1 &&
      (await page.locator('.accordion-section[data-accordion="enclosure"]').evaluate((element) => element.open)) === false,
    'opening another module closes the previous one',
  );
  await page.locator('#screwSpecSelect').selectOption('M2.5');
  await waitIdle();
  ok(
    !(await page.locator('#hardwareNote').getAttribute('class')).includes('is-warning'),
    'standard M2.5 hardware clears the board-hole warning',
  );
  ok(
    (await state()).enclosure.screw_clearance === 2.9,
    'selecting M2.5 stores its standard clear hole',
  );
  await page.locator('#screwSpecSelect').selectOption('M3');
  await waitIdle();
  ok(
    (await state()).enclosure.screw_clearance === 3.4,
    'selecting M3 stores its standard clear hole',
  );

  await openAccordion('enclosure');
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
  ok(
    (await page.locator('.view-switch > button[data-view]').count()) === 2,
    'only 3D and top view stay as primary buttons',
  );
  ok(
    (await page.locator('#viewMenu .view-menu-item').count()) === 4,
    'four side views are grouped into one menu',
  );
  await page.locator('#viewMenuButton').click();
  ok(await page.locator('#viewMenu').isVisible(), 'side view menu opens');
  ok(
    (await page.locator('#viewMenuButton').getAttribute('aria-expanded')) === 'true',
    'side view menu exposes its expanded state',
  );
  await page.keyboard.press('Escape');
  ok(await page.locator('#viewMenu').isHidden(), 'Escape closes the side view menu');
  ok(
    (await page.evaluate(() => document.activeElement?.id)) === 'viewMenuButton',
    'closing the side view menu restores focus to its button',
  );

  for (const [side, expected] of Object.entries(sideViews)) {
    await selectView(side);
    await page.waitForTimeout(760);
    const camera = await page.evaluate(() => window.boardForge.getCamera());
    ok(camera.view === side, `${side} view becomes active`);
    ok(
      camera.direction.every((value, index) => Math.abs(value - expected[index]) < 0.02),
      `${side} view is perpendicular to its panel`,
    );
    ok(await page.locator('#viewMenu').isHidden(), `${side} selection closes the side view menu`);
  }
  ok(
    (await page.locator('#viewMenuLabel').textContent()) === '右视',
    'side view button shows the active side view',
  );

  // An opposite side view travels around the model instead of passing through it.
  await selectView('front');
  await page.waitForTimeout(760);
  await selectView('back');
  await page.waitForFunction(
    () => Math.abs(window.boardForge.getCamera().direction[0]) > 0.5,
    { timeout: 3_000 },
  );
  const arcMidpoint = await page.evaluate(() => window.boardForge.getCamera());
  ok(
    Math.abs(arcMidpoint.direction[0]) > 0.5,
    'front-to-back transition orbits through a side view',
  );
  ok(arcMidpoint.distance > 20, 'view transition keeps the camera away from the model centre');
  await page.waitForTimeout(700);
  const backView = await page.evaluate(() => window.boardForge.getCamera());
  ok(backView.direction[1] > 0.98, 'front-to-back transition ends on the back view');

  // Manual orbiting from a preset top/side view returns to free 3D state.
  await selectView('top');
  await page.waitForTimeout(760);
  await dragPreview(90, 45);
  const topOrbit = await page.evaluate(() => window.boardForge.getCamera());
  ok(
    (await page.evaluate(() => window.boardForge.activeView())) === 'iso',
    'orbiting from top view returns the toolbar to 3D state',
  );
  ok(
    Math.abs(topOrbit.direction[0]) > 0.1 || Math.abs(topOrbit.direction[1]) > 0.1,
    'top view can be freely orbited with the mouse',
  );
  ok(
    (await page.locator('.view-switch > button[data-view="iso"]').getAttribute('class')).includes('active'),
    '3D button becomes active after manual orbit',
  );

  await selectView('front');
  await page.waitForTimeout(760);
  await dragPreview(90, -45);
  const sideOrbit = await page.evaluate(() => window.boardForge.getCamera());
  ok(
    (await page.evaluate(() => window.boardForge.activeView())) === 'iso',
    'orbiting from a side view returns the toolbar to 3D state',
  );
  ok(Math.abs(sideOrbit.direction[2]) > 0.1, 'side view can be freely orbited with the mouse');

  await selectView('iso');
  await page.waitForTimeout(760);
  ok(
    (await page.locator('#viewMenuLabel').textContent()) === '侧视',
    'side view button returns to a neutral label in 3D view',
  );

  // Settings dialog hosts theme, mode, projection and autosave preferences.
  await page.locator('#settingsButton').click();
  ok(await page.locator('#settingsModal').isVisible(), 'settings dialog opens from the top bar');
  await page.locator('[data-theme-preset="sky"]').click();
  ok((await page.evaluate(() => window.boardForge.getTheme())) === '#7dd3fc', 'theme preset updates accent');
  await page.locator('#settingsModeGroup [data-mode="light"]').click();
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
  ok(
    (await page.locator('#settingsModeGroup [data-mode="light"]').getAttribute('aria-checked')) === 'true',
    'settings dialog reflects the active light mode',
  );

  // Projection can also be changed from the settings dialog.
  await page.locator('#settingsProjectionGroup [data-projection="orthographic"]').click();
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'orthographic',
    'settings dialog switches projection',
  );
  ok(
    (await page.locator('#projectionButton').getAttribute('aria-pressed')) === 'true',
    'toolbar projection button follows the settings choice',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.locator('#settingsModal').isHidden(), 'Escape closes the settings dialog');
  await page.locator('#projectionButton').click();
  ok(
    (await page.evaluate(() => window.boardForge.getProjection())) === 'perspective',
    'toolbar projection button switches back to perspective',
  );
  await page.locator('#settingsButton').click();
  ok(
    (await page.locator('#settingsProjectionGroup [data-projection="perspective"]').getAttribute('aria-checked')) === 'true',
    'settings projection control follows the toolbar button',
  );

  // Autosave preference can be turned off and on again.
  await page.locator('.settings-switch-autosave').click();
  const autosaveOff = await page.evaluate(() => ({
    enabled: window.boardForge.isAutosaveEnabled(),
    stored: localStorage.getItem('boardforge.autosave-enabled.v1'),
    draft: localStorage.getItem('boardforge.case-autosave.v2'),
  }));
  ok(autosaveOff.enabled === false, 'autosave can be disabled');
  ok(autosaveOff.stored === 'off', 'disabled autosave is persisted');
  ok(autosaveOff.draft === null, 'disabling autosave clears the local draft');
  await page.locator('.settings-switch-autosave').click();
  ok(
    (await page.evaluate(() => window.boardForge.isAutosaveEnabled())) === true,
    'autosave can be enabled again',
  );

  // Shadows can be disabled for low-end GPUs.
  await page.locator('.settings-switch-shadows').click();
  const shadowsOff = await page.evaluate(() => ({
    enabled: window.boardForge.isShadowsEnabled(),
    renderer: window.boardForge.isPreviewShadowsEnabled(),
    stored: localStorage.getItem('boardforge.shadows-enabled.v1'),
  }));
  ok(shadowsOff.enabled === false, 'shadows can be disabled');
  ok(shadowsOff.renderer === false, 'renderer stops drawing shadow maps');
  ok(shadowsOff.stored === 'off', 'disabled shadows are persisted');
  await page.locator('.settings-switch-shadows').click();
  ok(
    (await page.evaluate(() => window.boardForge.isPreviewShadowsEnabled())) === true,
    'shadows can be enabled again',
  );

  // HiDPI rendering can be capped to 1x for weaker devices.
  await page.locator('.settings-switch-hidpi').click();
  const hidpiOff = await page.evaluate(() => ({
    enabled: window.boardForge.isHidpiEnabled(),
    cap: window.boardForge.getPixelRatioCap(),
    ratio: window.boardForge.getPixelRatio(),
    stored: localStorage.getItem('boardforge.hidpi-enabled.v1'),
  }));
  ok(hidpiOff.enabled === false, 'hidpi rendering can be disabled');
  ok(hidpiOff.cap === 1, 'disabled hidpi caps the pixel ratio at 1x');
  ok(hidpiOff.ratio === 1, 'renderer uses a 1x backing store');
  ok(hidpiOff.stored === 'off', 'disabled hidpi is persisted');
  await page.locator('.settings-switch-hidpi').click();
  ok(
    (await page.evaluate(() => window.boardForge.getPixelRatioCap())) === 2,
    'hidpi rendering can be enabled again',
  );

  // Rendering is on demand: idle previews stop producing frames.
  await page.locator('#settingsDoneButton').click();
  await page.waitForTimeout(300);
  await page.waitForTimeout(1200);
  const idleFrames = await page.evaluate(() => window.boardForge.getRenderCount());
  await page.waitForTimeout(700);
  const stillIdleFrames = await page.evaluate(() => window.boardForge.getRenderCount());
  ok(stillIdleFrames === idleFrames, 'preview stops rendering while idle');
  await dragPreview(24, 12);
  await page.waitForTimeout(90);
  const awakeFrames = await page.evaluate(() => window.boardForge.getRenderCount());
  ok(awakeFrames > stillIdleFrames, 'interaction wakes the render loop');
  await page.waitForTimeout(900);

  await page.locator('#settingsButton').click();
  await page.waitForTimeout(300);

  // Capture the settings dialog in the light theme used by the docs.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-settings.png') });

  // Reset restores every interface preference.
  await page.locator('#resetSettingsButton').click();
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => ({
    theme: window.boardForge.getTheme(),
    mode: window.boardForge.getMode(),
    projection: window.boardForge.getProjection(),
    autosave: window.boardForge.isAutosaveEnabled(),
    shadows: window.boardForge.isShadowsEnabled(),
    hidpi: window.boardForge.isHidpiEnabled(),
  }));
  ok(reset.theme === '#8ee89d', 'reset restores the default theme colour');
  ok(reset.mode === 'dark', 'reset restores dark mode');
  ok(reset.projection === 'perspective', 'reset restores perspective projection');
  ok(reset.autosave === true, 'reset restores autosave');
  ok(reset.shadows === true, 'reset restores shadows');
  ok(reset.hidpi === true, 'reset restores hidpi rendering');

  // Put the shell back into the light theme used by the rest of the checks.
  await page.locator('#settingsModeGroup [data-mode="light"]').click();
  await page.locator('[data-theme-preset="sky"]').click();
  await page.locator('#settingsDoneButton').click();
  await page.waitForTimeout(520);
  ok(await page.locator('#settingsModal').isHidden(), 'done button closes the settings dialog');
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

  // Replacing a customized project asks whether to export it first.
  await page.locator('#caseName').fill('客户定制外壳');
  await page.locator('#caseName').blur();
  await page.waitForTimeout(350);
  await page.locator('#projectsButton').click();
  await page.locator('#launcherNewButton').click();
  ok(await page.locator('#projectModal').isVisible(), 'custom project prompts before creating a new project');
  ok(
    (await page.locator('#projectDialogTitle').textContent()).includes('新建'),
    'new project guard has its own title',
  );
  await page.locator('#projectCancelButton').click();
  ok((await state()).name === '客户定制外壳', 'cancelling a new project keeps the current project');
  await dismissLauncher();

  await page.locator('[data-preset-id="esp32-devkit"]').click();
  ok(await page.locator('#projectModal').isVisible(), 'custom project prompts before preset replacement');
  ok(
    (await page.locator('#projectDialogTitle').textContent()).includes('ESP32'),
    'project guard names the target preset',
  );
  ok(
    (await page.locator('#projectDialogSummary').textContent()).includes('85 × 56'),
    'project guard summarizes the current board',
  );
  await page.screenshot({ path: join(screenshots, 'case-project-guard.png') });
  await page.locator('#projectCancelButton').click();
  ok(await page.locator('#projectModal').isHidden(), 'project guard can be cancelled');
  ok((await state()).name === '客户定制外壳', 'cancelling keeps the current project');

  await page.locator('[data-preset-id="esp32-devkit"]').click();
  const guardedPath = join(work, 'guarded-project.case.json');
  const guardedDownload = await download('#projectExportButton', guardedPath);
  ok(
    guardedDownload.suggestedFilename().endsWith('.case.json'),
    'project guard can export before replacement',
  );
  await waitIdle();
  const guardedJson = JSON.parse(await readFile(guardedPath, 'utf8'));
  ok(guardedJson.name === '客户定制外壳', 'project guard exports the current project data');
  ok(
    (await state()).name === 'ESP32 DevKit V1 外壳',
    'export and continue applies the selected preset',
  );
  await page.locator('[data-preset-id="raspberry-pi-4b"]').click();
  await waitIdle();

  await page.locator('#caseName').fill('第二个自定义项目');
  await page.locator('#caseName').blur();
  await page.waitForTimeout(350);
  await page.locator('[data-preset-id="esp32-devkit"]').click();
  await page.locator('#projectDirectButton').click();
  await waitIdle();
  ok(
    (await state()).name === 'ESP32 DevKit V1 外壳',
    'direct replacement can skip the export step',
  );
  await page.locator('[data-preset-id="raspberry-pi-4b"]').click();
  await waitIdle();

  // Enclosure inputs drive the derived dimensions.
  await openAccordion('enclosure');
  await page.locator('#panelThicknessInput').fill('4');
  await waitIdle();
  const thicker = await diagnostics();
  ok(thicker.outer.width === 103 && thicker.outer.depth === 74, 'panel thickness increases outer dimensions');
  ok(thicker.outer.height === 31.6, 'panel thickness increases outer height');
  ok(thicker.boardFromCache, 'enclosure-only edits reuse the cached board reference');

  await page.locator('#panelThicknessInput').fill('3');
  await page.locator('#clearanceInput').fill('8');
  await waitIdle();
  const wider = await diagnostics();
  ok(wider.outer.width === 113 && wider.outer.depth === 84, 'clearance increases outer footprint');
  await page.locator('#clearanceInput').fill('6');
  await waitIdle();

  // Board reference remains editable and feeds the enclosure.
  await openAccordion('board');
  ok(await page.locator('#lengthInput').isVisible(), 'board reference details expand');
  await page.locator('#lengthInput').fill('90');
  await waitIdle();
  const longerBoard = await state();
  ok(longerBoard.board.length === 90, 'board length can be edited');
  const boardChangedDiagnostics = await diagnostics();
  ok(boardChangedDiagnostics.outer.width === 114, 'board length feeds the enclosure dimensions');
  ok(!boardChangedDiagnostics.boardFromCache, 'board edits invalidate the cached reference model');
  await page.locator('#lengthInput').fill('85');
  await waitIdle();

  // Add a valid side-panel cut-out.
  await openAccordion('openings');
  await page.locator('#addOpeningButton').click();
  await page.waitForTimeout(150);
  ok((await page.locator('.opening-card').count()) === 1, 'an opening card can be added');
  let card = page.locator('.opening-card').first();
  await card.locator('[data-opening-field="u"]').fill('-15');
  await card.locator('[data-opening-field="v"]').fill('0');
  await card.locator('[data-opening-field="width"]').fill('16');
  await card.locator('[data-opening-field="height"]').fill('9');
  await page.waitForFunction(
    () =>
      window.boardForge.getDiagnostics()?.panels.find((panel) => panel.id === 'front')
        ?.holes >= 1,
    { timeout: 15_000 },
  );
  await waitIdle();
  let currentDiagnostics = await diagnostics();
  const frontPanel = currentDiagnostics.panels.find((panel) => panel.id === 'front');
  ok(frontPanel.holes >= 1, 'valid opening is cut into the front panel');
  ok(currentDiagnostics.warnings.length === 0, 'valid opening produces no warning');
  ok((await page.locator('#panelMapTitle').textContent()) === '前面板', '2D editor follows the active panel');

  // Drag the cut-out directly in the 2D side-panel editor.
  const openingBeforeDrag = (await state()).openings[0];
  const mapShape = page.locator('[data-map-opening="0"]');
  await mapShape.scrollIntoViewIfNeeded();
  const mapBox = await mapShape.boundingBox();
  if (mapBox) {
    const dragX = mapBox.x + mapBox.width / 2;
    const dragY = mapBox.y + mapBox.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 18, dragY, { steps: 6 });
    await page.mouse.up();
    await waitIdle();
    const openingAfterDrag = (await state()).openings[0];
    ok(
      openingAfterDrag.u !== openingBeforeDrag.u,
      'dragging an opening in the 2D editor updates U',
    );
  }
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
  await page.waitForFunction(
    () =>
      window.boardForge.getDiagnostics()?.panels.find((panel) => panel.id === 'left')
        ?.holes >= 1,
    { timeout: 15_000 },
  );
  await waitIdle();
  currentDiagnostics = await diagnostics();
  ok(
    currentDiagnostics.panels.find((panel) => panel.id === 'left').holes >= 1,
    'opening can be moved to another side',
  );
  ok(
    (await page.locator('[data-opening-side="left"]').getAttribute('aria-selected')) === 'true',
    '2D editor follows an opening moved to the left panel',
  );
  ok(
    (await page.locator('#viewMenuLabel').textContent()) === '左视',
    'selecting a side panel updates the compact view menu label',
  );
  card = page.locator('.opening-card').first();
  await card.locator('[data-opening-field="shape"]').selectOption('circle');
  await waitIdle();
  card = page.locator('.opening-card').first();
  ok(await card.locator('[data-opening-field="diameter"]').isVisible(), 'circle opening exposes a diameter field');
  const openingState = await state();
  ok(openingState.openings[0].shape === 'circle', 'opening shape is stored');

  // Add a common connector preset on the front panel.
  await page.locator('[data-opening-side="front"]').click();
  ok(
    (await page.locator('#viewMenuLabel').textContent()) === '前视',
    'returning to the front panel updates the compact view label',
  );
  await page.locator('#openingPresetSelect').selectOption('usb-c');
  await page.locator('#addPresetOpeningButton').click();
  await waitIdle();
  const presetOpeningState = await state();
  const usbCOpening = presetOpeningState.openings.at(-1);
  ok(
    usbCOpening.side === 'front' && usbCOpening.width === 9 && usbCOpening.height === 3.6,
    'USB-C preset adds a correctly sized opening to the active panel',
  );
  ok(
    (await page.locator('.opening-card').count()) === 1,
    'opening list is filtered to the active side panel',
  );

  // Vent toggle.
  await openAccordion('mechanical');
  const ventTopBefore = (await diagnostics()).panels.find((panel) => panel.id === 'top').holes;
  await page.locator('aside .switch-row').click();
  await waitIdle();
  const ventTopAfter = (await diagnostics()).panels.find((panel) => panel.id === 'top').holes;
  ok(!(await page.locator('#ventEnabledInput').isChecked()), 'vent switch can be turned off');
  ok(ventTopAfter < ventTopBefore, 'disabling vents removes top-panel slots');
  ok((await state()).enclosure.vent.enabled === false, 'vent state is persisted in parameters');
  await page.locator('aside .switch-row').click();
  await waitIdle();
  ok(await page.locator('#ventEnabledInput').isChecked(), 'vent switch can be turned back on');

  // Invalid dimensions block exports and clamp on blur.
  await openAccordion('enclosure');
  await page.locator('#panelThicknessInput').fill('0');
  await page.waitForTimeout(100);
  ok(await page.locator('#exportDxfButton').isDisabled(), 'DXF export is blocked for invalid thickness');
  await page.locator('#panelThicknessInput').blur();
  await waitIdle();
  ok((await page.locator('#panelThicknessInput').inputValue()) === '1', 'invalid thickness clamps to 1 mm');
  await page.locator('#panelThicknessInput').fill('3');
  await waitIdle();

  // Invalid fields automatically reveal their module.
  await openAccordion('mechanical');
  await page.evaluate(() => {
    const input = document.querySelector('#panelThicknessInput');
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(220);
  ok(
    (await page.locator('.accordion-section[data-accordion="enclosure"]').evaluate((element) => element.open)) === true,
    'invalid parameters open their module',
  );
  ok(
    (await page.locator('.accordion-section[data-accordion="mechanical"]').evaluate((element) => element.open)) === false,
    'revealing an invalid field keeps the accordion exclusive',
  );
  await page.locator('#panelThicknessInput').fill('3');
  await waitIdle();

  // Exploded view.
  await selectView('iso');
  await page.waitForTimeout(700);
  await page.locator('#explodeButton').click();
  await page.waitForTimeout(650);
  ok((await page.evaluate(() => window.boardForge.getExploded())) === true, 'exploded view can be enabled');
  ok((await page.locator('#explodeButton').getAttribute('aria-pressed')) === 'true', 'explode button updates its state');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-exploded.png') });

  // 2D cut-sheet preview.
  await page.locator('#previewCutButton').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.locator('#previewCutButton').click();
  await page.waitForTimeout(300);
  ok(await page.locator('#sheetModal').isVisible(), 'cut-sheet preview opens');
  ok((await page.locator('#sheetPreview svg').count()) === 1, 'cut-sheet preview renders an SVG');
  ok((await page.locator('#sheetSize').textContent()).includes('mm'), 'cut-sheet preview reports sheet dimensions');
  await page.screenshot({ path: join(screenshots, 'case-cut-sheet.png') });
  await page.locator('#sheetCloseButton').click();
  await page.waitForTimeout(150);
  ok(await page.locator('#sheetModal').isHidden(), 'cut-sheet preview closes');

  // Export JSON.
  const jsonPath = join(work, 'case.case.json');
  const jsonDownload = await download('#exportJsonButton', jsonPath);
  ok(jsonDownload.suggestedFilename().endsWith('.case.json'), 'JSON export uses .case.json');
  const exportedJson = JSON.parse(await readFile(jsonPath, 'utf8'));
  ok(exportedJson.version === 2 && exportedJson.format === 'boardforge-case', 'JSON uses case format');
  ok(exportedJson.enclosure.panel_thickness === 3, 'JSON contains enclosure settings');
  ok(exportedJson.openings.length === 2, 'JSON contains side-panel openings');
  ok(exportedJson.board.length === 85, 'JSON contains board reference');

  // Export SVG and DXF.
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
  ok(dxf.includes('$TEXTSTYLE') && dxf.includes('2\nBLOCKS'), 'DXF includes standard tables and blocks');
  ok(dxf.includes('LAYER\n2\nCUT'), 'DXF contains a CUT layer');
  ok(dxf.includes('LAYER\n2\nANNOTATION'), 'DXF contains an ANNOTATION layer');
  ok((dxf.match(/POLYLINE/g) || []).length >= 6, 'DXF contains six panel outlines');
  ok(dxf.includes('TEXT\n8\nANNOTATION'), 'DXF includes non-cutting text annotations');
  ok(dxf.includes('1\nSHEET') && dxf.includes('1\nTOP'), 'DXF annotations include sheet info and panel labels');

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

  // Multi-project library: save, open, and delete projects.
  const readProjectLibrary = () =>
    page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('boardforge.projects.v1')).projects;
      } catch {
        return [];
      }
    });

  await page.locator('#caseName').fill('项目 A');
  await page.locator('#caseName').blur();
  await page.waitForTimeout(350);
  await page.locator('#saveProjectButton').click();
  await page.waitForTimeout(250);
  let projects = await readProjectLibrary();
  ok(projects.length === 1 && projects[0].name === '项目 A', 'current project can be saved to the project library');
  const projectA = projects.find((project) => project.name === '项目 A');

  await page.locator('#projectsButton').click();
  await waitForLauncher();
  ok((await page.locator('.project-entry').count()) === 1, 'project launcher lists saved projects');
  await page.locator('#launcherNewButton').click();
  await waitIdle();
  ok((await state()).name === '未命名开发板外壳', 'launcher can create a blank project');
  await page.locator('#caseName').fill('项目 B');
  await page.locator('#caseName').blur();
  await page.waitForTimeout(350);

  await page.locator('#projectsButton').click();
  await waitForLauncher();
  await page.locator(`[data-open-project="${projectA.id}"]`).click();
  ok(await page.locator('#projectModal').isVisible(), 'unsaved project prompts before opening another project');
  await page.locator('#projectCancelButton').click();
  await dismissLauncher();

  await page.locator('#saveProjectButton').click();
  await page.waitForTimeout(250);
  projects = await readProjectLibrary();
  ok(projects.length === 2, 'project library stores multiple projects');

  await page.locator('#projectsButton').click();
  await waitForLauncher();
  ok((await page.locator('.project-entry').count()) === 2, 'launcher shows both saved projects');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((toast) => toast.remove()));
  await page.screenshot({ path: join(screenshots, 'case-project-launcher.png') });
  const projectB = projects.find((project) => project.name === '项目 B');
  await page.locator(`[data-open-project="${projectA.id}"]`).click();
  await waitIdle();
  ok((await state()).name === '项目 A', 'opening a saved project restores its state');
  ok(await page.locator('#projectLauncher').isHidden(), 'opening a project closes the launcher');

  await page.locator('#projectsButton').click();
  await waitForLauncher();
  await page.locator(`[data-delete-project="${projectB.id}"]`).click();
  ok(
    await page.locator(`[data-confirm-delete="${projectB.id}"]`).isVisible(),
    'deleting a project asks for confirmation',
  );
  await page.locator(`[data-confirm-delete="${projectB.id}"]`).click();
  await page.waitForTimeout(120);
  ok((await page.locator('.project-entry').count()) === 1, 'saved project can be deleted');
  await dismissLauncher();
  ok((await readProjectLibrary()).length === 1, 'deleted project is removed from local storage');

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
  await waitForLauncher();
  await dismissLauncher();
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
  await waitForLauncher(mobile);
  ok(await mobile.locator('#projectLauncher').isVisible(), 'mobile startup launcher opens');
  ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
    'project launcher fits the mobile viewport',
  );
  await dismissLauncher(mobile);
  const mobileInitial = await mobile.evaluate(() => ({
    noOverflow:
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollY: window.scrollY,
  }));
  ok(mobileInitial.noOverflow, 'mobile layout has no horizontal overflow');
  ok(mobileInitial.scrollY === 0, 'mobile page opens at the 3D preview without auto-scrolling');
  await mobile.screenshot({ path: join(screenshots, 'case-mobile.png') });

  await mobile.locator('#settingsButton').click();
  ok(await mobile.locator('#settingsModal').isVisible(), 'settings dialog opens on mobile');
  await mobile.locator('#settingsModeGroup [data-mode="dark"]').click();
  await mobile.waitForTimeout(420);
  ok(
    (await mobile.evaluate(() => window.boardForge.getMode())) === 'dark',
    'mobile settings switch to dark mode',
  );
  await mobile.locator('#settingsModeGroup [data-mode="light"]').click();
  await mobile.waitForTimeout(550);
  const mobileLight = await mobile.evaluate(() => ({
    mode: window.boardForge.getMode(),
    noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  ok(mobileLight.mode === 'light', 'mobile settings switch to light mode');
  ok(mobileLight.noOverflow, 'mobile light mode has no horizontal overflow');
  await mobile.screenshot({ path: join(screenshots, 'case-mobile-settings.png') });
  await mobile.locator('#settingsDoneButton').click();
  await mobile.waitForTimeout(350);
  ok(await mobile.locator('#settingsModal').isHidden(), 'settings dialog closes on mobile');
  await mobile.screenshot({ path: join(screenshots, 'case-mobile-light.png') });
  await mobile.close();

  console.log(`\nBoardForge enclosure checks passed: ${checks}`);
  console.log(`Screenshots written to ${screenshots}`);
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
