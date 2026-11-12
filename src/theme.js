/**
 * UI accent themes. The chosen colour is stored separately from the board
 * document: it is a local interface preference, not a physical board parameter.
 */

export const DEFAULT_THEME_COLOR = '#8ee89d';
export const THEME_STORAGE_KEY = 'boardforge.theme.v1';

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

export function createThemeTokens(value) {
  const color = normalizeThemeColor(value);
  const base = makeReadable(hexToRgb(color));
  const strong = mix(base, [0, 0, 0], 0.12);
  const bright = mix(base, [255, 255, 255], 0.18);
  const hover = mix(base, [255, 255, 255], 0.34);
  const rgb = base.map((channel) => Math.round(channel)).join(', ');

  return {
    color,
    accent: rgbToHex(base),
    strong: rgbToHex(strong),
    bright: rgbToHex(bright),
    hover: rgbToHex(hover),
    rgb,
    soft: `rgba(${rgb}, 0.1)`,
    line: `rgba(${rgb}, 0.3)`,
  };
}

export function applyTheme(value, root = document.documentElement) {
  const tokens = createThemeTokens(value);
  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--accent-strong', tokens.strong);
  root.style.setProperty('--accent-bright', tokens.bright);
  root.style.setProperty('--accent-hover', tokens.hover);
  root.style.setProperty('--accent-rgb', tokens.rgb);
  root.style.setProperty('--accent-soft', tokens.soft);
  root.style.setProperty('--accent-line', tokens.line);
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

export function clearThemeColor() {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
  return DEFAULT_THEME_COLOR;
}
