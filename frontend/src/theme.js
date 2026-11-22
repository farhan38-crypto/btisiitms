// Theme engine, ported from MiniMusic (MiniMusic.swift: AppTheme, ThemeColor, GradientTheme,
// ThemeStyle). Same idea, same names:
//
//   AppTheme      the built-in looks: AMOLED, Dark, Greenboard, Light, plus Gradient
//   ThemeColor    a colour kept as hue / saturation / brightness, so the editor can slide each one
//   GradientTheme one, two or three colours swept across the window at an angle
//   themeStyle()  what every part of the page reads to draw itself (MiniMusic's ThemeStyle):
//                 the base colour, whether text is light or dark, how panels are shaded,
//                 and the fine rim "lit from above" around each glass panel.
//
// The result is a set of CSS variables put on the .app element.

export const APP_THEMES = [
  // BITS reports' own two looks, kept exactly as they were (no glass layer on top):
  { key: 'original', title: 'Original', icon: 'sunrise', classic: true, scheme: 'light' },
  { key: 'indigo', title: 'Indigo', icon: 'sparkles', classic: true, scheme: 'dark' },
  // MiniMusic's looks:
  { key: 'amoled', title: 'AMOLED', icon: 'circle' },
  { key: 'dark', title: 'Dark', icon: 'moon' },
  { key: 'greenboard', title: 'Greenboard', icon: 'leaf' },
  { key: 'light', title: 'Light', icon: 'sun' },
  { key: 'gradient', title: 'Gradient', icon: 'palette' }
];

// ── ThemeColor: { h, s, b } each 0…1 ──
export function hsbToRgb({ h, s, b }) {
  const i = Math.floor(h * 6) % 6;
  const f = h * 6 - Math.floor(h * 6);
  const p = b * (1 - s), q = b * (1 - f * s), t = b * (1 - (1 - f) * s);
  const [r, g, bl] = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]][i];
  return [r, g, bl].map(v => Math.round(v * 255));
}
export const toHex = c => hsbToRgb(c).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
export const toCss = (c, a = 1) => { const [r, g, b] = hsbToRgb(c); return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`; };

export function fromHex(hex) {
  const d = String(hex).trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(d)) return null;
  const v = parseInt(d, 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return { h, s: max ? delta / max : 0, b: max };
}

// How light the colour looks, from 0 to 1 (same weights MiniMusic uses).
export function luminance(c) {
  const [r, g, b] = hsbToRgb(c).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const PALETTE = [
  { h: 0.0, s: 0.72, b: 0.78 }, { h: 0.07, s: 0.78, b: 0.92 }, { h: 0.13, s: 0.72, b: 0.95 },
  { h: 0.33, s: 0.55, b: 0.62 }, { h: 0.47, s: 0.7, b: 0.6 }, { h: 0.55, s: 0.75, b: 0.82 },
  { h: 0.62, s: 0.78, b: 0.62 }, { h: 0.72, s: 0.62, b: 0.62 }, { h: 0.83, s: 0.55, b: 0.72 },
  { h: 0.93, s: 0.6, b: 0.85 }, { h: 0.6, s: 0.35, b: 0.18 }, { h: 0.08, s: 0.12, b: 0.93 }
];

// ── GradientTheme ──
export const STANDARD_GRADIENT = { colors: [{ h: 0.72, s: 0.62, b: 0.42 }, { h: 0.93, s: 0.58, b: 0.55 }], angle: 135 };

export const gradientCss = g => {
  const cols = g.colors.length === 1 ? [g.colors[0], g.colors[0]] : g.colors;
  // MiniMusic's angle runs from the start point to the end point; CSS 90deg points right, so add 90.
  return `linear-gradient(${Math.round(g.angle + 90)}deg, ${cols.map(c => toCss(c)).join(', ')})`;
};
export const gradientIsLight = g => g.colors.length > 0 && g.colors.reduce((sum, c) => sum + luminance(c), 0) / g.colors.length > 0.6;
const round = n => Math.round(n * 1000) / 1000;
export const looksTheSame = (a, b) => !!a && !!b && a.angle === b.angle && a.colors.length === b.colors.length
  && a.colors.every((c, i) => round(c.h) === round(b.colors[i].h) && round(c.s) === round(b.colors[i].s) && round(c.b) === round(b.colors[i].b));

// ── Appearance (what is saved with the account) ──
export const DEFAULT_APPEARANCE = { theme: 'original', gradient: STANDARD_GRADIENT, saved_gradients: [] };

const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
const cleanColor = c => ({ h: clamp01(c?.h), s: clamp01(c?.s), b: clamp01(c?.b) });
const cleanGradient = g => {
  const colors = Array.isArray(g?.colors) ? g.colors.slice(0, 3).map(cleanColor) : [];
  return colors.length ? { colors, angle: Math.min(360, Math.max(0, Number(g.angle) || 0)) } : STANDARD_GRADIENT;
};

export function normaliseAppearance(a) {
  const theme = APP_THEMES.some(t => t.key === a?.theme) ? a.theme : 'original';
  return {
    theme,
    gradient: cleanGradient(a?.gradient),
    saved_gradients: Array.isArray(a?.saved_gradients) ? a.saved_gradients.slice(0, 24).map(cleanGradient) : []
  };
}

// What this device used before themes were saved with the account.
export function legacyDeviceAppearance() {
  const t = localStorage.getItem('bits-theme');
  if (!t) return null;
  return normaliseAppearance({ theme: { amoled: 'amoled', dark: 'indigo' }[t] || 'original' });
}

// ── ThemeStyle: everything the page reads to draw itself ──
const BASE = {
  amoled: { base: '#000000', scheme: 'dark', panel: 'rgb(255 255 255 / .025)', hover: 'rgb(255 255 255 / .055)', solid: '#0A0A0A' },
  dark: { base: '#171717', scheme: 'dark', panel: 'rgb(255 255 255 / .05)', hover: 'rgb(255 255 255 / .085)', solid: '#202020' },
  greenboard: { base: '#1C3D30', scheme: 'dark', panel: 'rgb(9 30 22 / .45)', hover: 'rgb(255 255 255 / .06)', solid: '#183629' },
  light: { base: '#F5F5F5', scheme: 'light', panel: 'rgb(255 255 255 / .78)', hover: 'rgb(255 255 255 / .96)', solid: '#FFFFFF' }
};

export function themeStyle(appearance) {
  const a = normaliseAppearance(appearance);
  const classic = APP_THEMES.find(t => t.key === a.theme && t.classic);
  if (classic) {          // the stylesheet already draws these; no variables needed
    return { scheme: classic.scheme, classic: true, isGradient: false, vars: {},
      themeColor: classic.scheme === 'dark' ? '#0C0E21' : '#F4F5FB' };
  }
  const isGradient = a.theme === 'gradient';
  const g = a.gradient;
  const scheme = isGradient ? (gradientIsLight(g) ? 'light' : 'dark') : BASE[a.theme].scheme;
  const isLight = scheme === 'light';
  const first = g.colors[0];

  const base = isGradient ? toCss(first) : BASE[a.theme].base;
  const background = isGradient ? gradientCss(g) : base;
  // Panels: a shade laid over whatever is behind. On a gradient they are frosted glass.
  const glass = isGradient ? (isLight ? 'rgb(255 255 255 / .5)' : 'rgb(0 0 0 / .26)') : BASE[a.theme].panel;
  // Things that float above everything (menus, dialogs, inputs) need a solid colour.
  const solid = isGradient ? (isLight ? 'rgb(255 255 255 / .94)' : 'rgb(20 20 24 / .94)') : BASE[a.theme].solid;
  const ink = isLight ? '#1D1D1F' : (a.theme === 'greenboard' ? '#ECF5EF' : '#F2F2F2');
  const muted = isLight ? 'rgb(29 29 31 / .62)' : (a.theme === 'greenboard' ? '#A9C6B6' : 'rgb(255 255 255 / .62)');

  return {
    scheme,
    isGradient,
    themeColor: isGradient ? `#${toHex(first)}` : BASE[a.theme].base,
    vars: {
      '--app-bg': background,
      '--warm-bg': base,
      '--glass': glass,
      '--glass-hover': isGradient ? (isLight ? 'rgb(255 255 255 / .66)' : 'rgb(0 0 0 / .36)') : BASE[a.theme].hover,
      '--lift-shadow': isLight ? '0 18px 36px -22px rgb(0 0 0 / .28)' : '0 18px 40px -20px rgb(0 0 0 / .75)',
      '--glass-blur': isGradient ? 'blur(18px) saturate(1.25)' : 'none',
      '--surface': solid,
      '--raised': solid,
      '--sidebar': glass,
      '--secondary': isLight ? 'rgb(0 0 0 / .05)' : 'rgb(255 255 255 / .07)',
      '--hover': isLight ? 'rgb(0 0 0 / .06)' : 'rgb(255 255 255 / .09)',
      '--accent': isLight ? 'rgb(0 0 0 / .04)' : 'rgb(255 255 255 / .06)',
      '--border': isLight ? 'rgb(0 0 0 / .1)' : 'rgb(255 255 255 / .1)',
      '--border-strong': isLight ? 'rgb(0 0 0 / .18)' : 'rgb(255 255 255 / .18)',
      '--ink': ink,
      '--muted': muted,
      // A fine rim around every panel, lit from above like the glass it outlines.
      '--edge-top': isLight ? 'rgb(0 0 0 / .07)' : 'rgb(255 255 255 / .22)',
      '--edge-bottom': isLight ? 'rgb(0 0 0 / .16)' : 'rgb(255 255 255 / .06)'
    }
  };
}
