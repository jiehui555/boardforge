import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(process.cwd());
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');

await mkdir(assets, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/app.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  outfile: resolve(assets, 'app.js'),
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'info',
});

if (result.errors.length > 0) {
  process.exitCode = 1;
  throw new Error('Bundle failed');
}

const [htmlSource, css, js, notices] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'styles.css'), 'utf8'),
  readFile(resolve(assets, 'app.js'), 'utf8'),
  readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8').catch(() => ''),
]);

let html = htmlSource;
html = html.replace(
  /[ \t]*<!-- DEV_IMPORTMAP_START -->[\s\S]*?<!-- DEV_IMPORTMAP_END -->\r?\n?/,
  '',
);
html = html.replace(
  '<link rel="stylesheet" href="./styles.css" />',
  () => `<style>\n${css}\n</style>`,
);
html = html.replace(
  '<script type="module" src="./src/app.js"></script>',
  () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
);

if (html.includes('src="./src/app.js"') || html.includes('href="./styles.css"')) {
  throw new Error('Build failed to inline app assets. Did index.html change?');
}

if (notices) {
  const safeNotices = notices.replaceAll('--', '- -');
  html = html.replace(
    '</body>',
    () => `  <!--\n${safeNotices}\n  -->\n  </body>`,
  );
}

await writeFile(resolve(dist, 'index.html'), html, 'utf8');
await rm(assets, { recursive: true, force: true });

try {
  await cp(resolve(root, 'samples'), resolve(dist, 'samples'), { recursive: true });
  await cp(
    resolve(root, 'THIRD_PARTY_NOTICES.md'),
    resolve(dist, 'THIRD_PARTY_NOTICES.md'),
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const size = (await stat(resolve(dist, 'index.html'))).size;
const gzipSize = (await import('node:zlib')).gzipSync(Buffer.from(html)).byteLength;
console.log(`Built dist/index.html`);
console.log(`  raw   ${(size / 1024).toFixed(1)} KB`);
console.log(`  gzip  ${(gzipSize / 1024).toFixed(1)} KB`);
console.log(`  file:// ready (single static HTML, no server required)`);
