/**
 * UI accent themes. The chosen colour is stored separately from the board
 * document: it is a local interface preference, not a physical board parameter.
 */

export const DEFAULT_THEME_COLOR = '#8ee89d';
export const DEFAULT_THEME_MODE = 'dark';
export const THEME_STORAGE_KEY = 'boardforge.theme.v1';
export const THEME_MODE_STORAGE_KEY = 'boardforge.mode.v1';

export const THEME_PRESETS = Object.freeze([
  { id: 'lime', label: '青柠绿', color: '#8ee89d' },
  { id: 'mint', label: '薄荷青', color: '#6ee7d8' },
  { id: 'sky', label: '冰川蓝', color: '#7dd3fc' },
  { id: 'indigo', label: '电子蓝', color: '#9da9ff' },
  { id: 'violet', label: '星云紫', color: '#c4a7ff' },
  { id: 'amber', label: '琥珀金', color: '#f5cc73' },
  { id: 'coral', label: '珊瑚橙', color: '#ffab91' },
]);

export function normalizeThemeColor(value, fallback = DEFAULT_THEME_COLOR) {
  if (typeof value !== 'string') return fallback;
  let color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(color)) {
    color = `#${color
      .slice(1)
      .split('')
      .map((character) => character + character)
      .join('')}`;
  }
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

export function normalizeThemeMode(value, fallback = DEFAULT_THEME_MODE) {
  return value === 'light' || value === 'dark' ? value : fallback;
}

function hexToRgb(color) {
  const normalized = normalizeThemeColor(color);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function channelToHex(channel) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex([red, green, blue]) {
  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

function mix(first, second, amount) {
  const t = Math.min(1, Math.max(0, amount));
  return [
    first[0] + (second[0] - first[0]) * t,
    first[1] + (second[1] - first[1]) * t,
    first[2] + (second[2] - first[2]) * t,
  ];
}

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]) {
  return (
    linearChannel(red) * 0.2126 +
    linearChannel(green) * 0.7152 +
    linearChannel(blue) * 0.0722
  );
}

/**
 * Dark interface colours become unreadable as accent text. Gently lift dark
 * user choices towards white until they work as an accent on the dark panel.
 */
function makeReadable(rgb, targetLuminance = 0.42) {
  if (relativeLuminance(rgb) >= targetLuminance) return rgb;
  let mixed = rgb;
  for (let step = 0.08; step <= 1; step += 0.08) {
    mixed = mix(rgb, [255, 255, 255], step);
    if (relativeLuminance(mixed) >= targetLuminance) break;
  }
  return mixed;
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return [hue, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const m = lightness - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (segment < 1) [r, g, b] = [chroma, x, 0];
  else if (segment < 2) [r, g, b] = [x, chroma, 0];
  else if (segment < 3) [r, g, b] = [0, chroma, x];
  else if (segment < 4) [r, g, b] = [0, x, chroma];
  else if (segment < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Light panels need the inverse treatment. Lower HSL lightness instead of
 * mixing with black so the accent keeps its saturation and remains vivid.
 */
function makeDeep(rgb, targetLuminance = 0.16) {
  if (relativeLuminance(rgb) <= targetLuminance) return rgb;
  const [hue, saturation, initialLightness] = rgbToHsl(rgb);
  let candidate = rgb;
  for (let lightness = initialLightness; lightness >= 0.04; lightness -= 0.02) {
    candidate = hslToRgb([hue, saturation, lightness]);
    if (relativeLuminance(candidate) <= targetLuminance) break;
  }
  return candidate;
}

export function createThemeTokens(value, mode = DEFAULT_THEME_MODE) {
  const color = normalizeThemeColor(value);
  const themeMode = normalizeThemeMode(mode);
  const base = themeMode === 'light'
    ? makeDeep(hexToRgb(color))
    : makeReadable(hexToRgb(color));
  const strong = mix(base, [0, 0, 0], 0.12);
  const bright = mix(base, [255, 255, 255], themeMode === 'light' ? 0.16 : 0.18);
  const hover = mix(base, [255, 255, 255], themeMode === 'light' ? 0.28 : 0.34);
  const rgb = base.map((channel) => Math.round(channel)).join(', ');

  return {
    color,
    mode: themeMode,
    onAccent: themeMode === 'light' ? '#ffffff' : '#061009',
    accent: rgbToHex(base),
    strong: rgbToHex(strong),
    bright: rgbToHex(bright),
    hover: rgbToHex(hover),
    rgb,
    soft: `rgba(${rgb}, 0.1)`,
    line: `rgba(${rgb}, 0.3)`,
  };
}

export function applyTheme(value, options = {}) {
  const mode = normalizeThemeMode(options.mode);
  const root = options.root || document.documentElement;
  const tokens = createThemeTokens(value, mode);
  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--accent-strong', tokens.strong);
  root.style.setProperty('--accent-bright', tokens.bright);
  root.style.setProperty('--accent-hover', tokens.hover);
  root.style.setProperty('--accent-rgb', tokens.rgb);
  root.style.setProperty('--accent-soft', tokens.soft);
  root.style.setProperty('--accent-line', tokens.line);
  root.style.setProperty('--on-accent', tokens.onAccent);
  return tokens;
}

export function readThemeColor() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_COLOR;
    let value = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') value = parsed.color;
    } catch {
      // Older preferences may be stored as a raw hex string.
    }
    return normalizeThemeColor(value);
  } catch {
    return DEFAULT_THEME_COLOR;
  }
}

export function saveThemeColor(value) {
  const color = normalizeThemeColor(value);
  try {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ version: 1, color }),
    );
  } catch {
    // The visual theme still works when storage is unavailable.
  }
  return color;
}

export function readThemeMode() {
  try {
    return normalizeThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function saveThemeMode(value) {
  const mode = normalizeThemeMode(value);
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // The visual mode still works when storage is unavailable.
  }
  return mode;
}

export function applyThemeMode(value, root = document.documentElement) {
  const mode = normalizeThemeMode(value);
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'light' ? '#f4f7f4' : '#0b0f0c');
  return mode;
}

export function clearThemeColor() {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
  return DEFAULT_THEME_COLOR;
}
