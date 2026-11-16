import fs from 'node:fs';

const keys = new Set();
for (const f of fs.readdirSync('src')) {
  if (!f.endsWith('.js') || f === 'i18n.js') continue;
  const text = fs.readFileSync('src/' + f, 'utf8');
  const re = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(text))) keys.add(m[1].replace(/\\'/g, "'"));
}
const html = fs.readFileSync('index.html', 'utf8');
const attrRe = /data-i18n(?:-html|-title|-aria-label|-content)?=(?:"([^"]*)"|'([^']*)')/g;
let m;
while ((m = attrRe.exec(html))) {
  const value = m[1] !== undefined ? m[1] : m[2];
  keys.add(value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
}
// Keys passed to t() indirectly through constants in app.js.
for (const key of [
  '自动保存已关闭', '草稿自动保存', '正在保存草稿…', '草稿已保存', '无法访问本地存储',
  '前', '后', '左', '右',
  '前视', '后视', '左视', '右视',
  'RJ45 网口', 'DC 5.5 电源孔', '3.5 mm 音频孔',
]) keys.add(key);
const { PRESETS } = await import('../src/schema.js');
for (const preset of PRESETS) keys.add(preset.label);
const { THEME_PRESETS } = await import('../src/theme.js');
for (const preset of THEME_PRESETS) keys.add(preset.label);
const { SIDE_LABELS } = await import('../src/case-schema.js');
for (const label of Object.values(SIDE_LABELS)) keys.add(label);

const list = [...keys].sort();
fs.writeFileSync('i18n-keys.json', JSON.stringify(list, null, 2));
console.log('total keys:', list.length);

const i18nSource = fs.readFileSync('src/i18n.js', 'utf8');
const enBlock = i18nSource.slice(i18nSource.indexOf('const EN = {'), i18nSource.indexOf('\n};'));
const enKeys = new Set();
const keyRe = /^  '((?:[^'\\]|\\.)*)':/gm;
let km;
while ((km = keyRe.exec(enBlock))) enKeys.add(km[1].replace(/\\'/g, "'"));
const missing = list.filter((key) => !enKeys.has(key));
const extra = [...enKeys].filter((key) => !keys.has(key));
console.log('EN entries:', enKeys.size);
if (missing.length) console.log('MISSING EN translations:\n' + missing.join('\n'));
if (extra.length) console.log('UNUSED EN entries:\n' + extra.join('\n'));
if (!missing.length && !extra.length) console.log('dictionary complete');