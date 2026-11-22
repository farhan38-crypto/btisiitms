// "Your gradient": a theme people make themselves from one, two or three colours swept across
// the page at an angle (ported from the original app's gradient editor, which came from
// MiniMusic). Colours are kept as hue / saturation / brightness so each can be slid.
// The gradient and saved gradients are stored on this device and with the account.
import { useSyncExternalStore } from 'react'
import { registerTheme } from './registry'
import type { ThemeDefinition } from './types'

export interface Hsb { h: number; s: number; b: number }
export interface Gradient { colors: Hsb[]; angle: number }
export const CUSTOM_ID = 'my-gradient'
export const STANDARD_GRADIENT: Gradient = { colors: [{ h: 0.72, s: 0.62, b: 0.42 }, { h: 0.93, s: 0.58, b: 0.55 }, { h: 0.55, s: 0.7, b: 0.45 }], angle: 135 }
export const SWATCHES: Hsb[] = [
  { h: 0.0, s: 0.72, b: 0.78 }, { h: 0.07, s: 0.78, b: 0.92 }, { h: 0.13, s: 0.72, b: 0.95 }, { h: 0.33, s: 0.55, b: 0.62 },
  { h: 0.47, s: 0.7, b: 0.6 }, { h: 0.55, s: 0.75, b: 0.82 }, { h: 0.62, s: 0.78, b: 0.62 }, { h: 0.72, s: 0.62, b: 0.62 },
  { h: 0.83, s: 0.55, b: 0.72 }, { h: 0.93, s: 0.6, b: 0.85 }, { h: 0.6, s: 0.35, b: 0.18 }, { h: 0.08, s: 0.12, b: 0.93 },
]

// ── colour helpers ──
const clamp01 = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0))
export function hsbToRgb({ h, s, b }: Hsb): [number, number, number] {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6)
  const p = b * (1 - s), q = b * (1 - f * s), t = b * (1 - (1 - f) * s)
  const rows: [number, number, number][] = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]]
  return rows[(i + 6) % 6]!.map(v => Math.round(v * 255)) as [number, number, number]
}
export const toHex = (c: Hsb) => hsbToRgb(c).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
export const toCss = (c: Hsb, a = 1) => { const [r, g, b] = hsbToRgb(c); return a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})` }
export function fromHex(hex: string): Hsb | null {
  const d = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(d)) return null
  const v = parseInt(d, 16)
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => x / 255) as [number, number, number]
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  let h = 0
  if (delta) { h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4; h /= 6; if (h < 0) h += 1 }
  return { h, s: max ? delta / max : 0, b: max }
}
export const luminance = (c: Hsb) => { const [r, g, b] = hsbToRgb(c).map(v => v / 255) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const gradientCss = (g: Gradient) => {
  const cols = g.colors.length === 1 ? [g.colors[0]!, g.colors[0]!] : g.colors
  return `linear-gradient(${Math.round(g.angle + 90)}deg, ${cols.map(c => toCss(c)).join(', ')})`
}
export const isLight = (g: Gradient) => g.colors.reduce((s, c) => s + luminance(c), 0) / g.colors.length > 0.6
export const sameGradient = (a: Gradient, b: Gradient) => a.angle === b.angle && a.colors.length === b.colors.length
  && a.colors.every((c, i) => ['h', 's', 'b'].every(k => Math.round(c[k as 'h'] * 1000) === Math.round(b.colors[i]![k as 'h'] * 1000)))
export function cleanGradient(g: unknown): Gradient | null {
  const x = g as Partial<Gradient> | null
  const colors = Array.isArray(x?.colors) ? x!.colors.slice(0, 3).map(c => ({ h: clamp01(c?.h), s: clamp01(c?.s), b: clamp01(c?.b) })) : []
  return colors.length ? { colors, angle: Math.min(360, Math.max(0, Number(x?.angle) || 0)) } : null
}

/** The theme built from a gradient: frosted glass over it, accents taken from its colours. */
export function gradientTheme(g: Gradient): ThemeDefinition {
  const light = isLight(g)
  // accents must stand out on the gradient: brighter on dark ones, deeper on light ones
  const accent = (c: Hsb) => toCss(light ? { h: c.h, s: Math.max(c.s, 0.6), b: Math.min(c.b, 0.55) } : { h: c.h, s: Math.min(Math.max(c.s, 0.45), 0.8), b: Math.max(c.b, 0.9) })
  const cols = g.colors
  const a = accent(cols[0]!), b = accent(cols[1] || { ...cols[0]!, h: (cols[0]!.h + 0.12) % 1 })
  const c = cols[2] ? accent(cols[2]) : undefined
  return {
    id: CUSTOM_ID, name: 'Your gradient', family: 'glass', scheme: light ? 'light' : 'dark',
    description: 'Your own colours, swept across the page under frosted glass.',
    palette: {
      base: toCss(cols[0]!), a, b, c,
      ...(light
        ? { glass: 'rgb(255 255 255 / .5)', glassHi: 'rgb(255 255 255 / .66)', glassSolid: 'rgb(255 255 255 / .94)' }
        : { glass: 'rgb(0 0 0 / .26)', glassHi: 'rgb(0 0 0 / .36)', glassSolid: 'rgb(20 20 24 / .92)' }),
    },
    backdrop: { kind: 'gradient', css: gradientCss(g) },
    chart: { series: [a, b] },
  }
}

// ── store: the current gradient and saved ones, on this device ──
const KEY = 'bits_gradient', SAVED_KEY = 'bits_gradients'
const readJson = <T>(k: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback } catch { return fallback } }
let current: Gradient = cleanGradient(readJson(KEY, null)) || STANDARD_GRADIENT
let saved: Gradient[] = (readJson<unknown[]>(SAVED_KEY, []) || []).map(cleanGradient).filter(Boolean) as Gradient[]
let version = 0
const subs = new Set<() => void>()
registerTheme(gradientTheme(current))

function emit() { version++; subs.forEach(f => f()) }
export function setGradient(g: Gradient) {
  current = g
  registerTheme(gradientTheme(g))
  try { localStorage.setItem(KEY, JSON.stringify(g)) } catch { /* ignore */ }
  emit()
}
export function setSavedGradients(list: Gradient[]) {
  saved = list.slice(0, 24)
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)) } catch { /* ignore */ }
  emit()
}
/** Take the gradient stored with the account (when signing in on another device). */
export function adoptGradients(a: { gradient?: unknown; saved_gradients?: unknown }) {
  const g = cleanGradient(a.gradient)
  if (g && !sameGradient(g, current)) setGradient(g)
  if (Array.isArray(a.saved_gradients) && a.saved_gradients.length) setSavedGradients(a.saved_gradients.map(cleanGradient).filter(Boolean) as Gradient[])
}
export const getGradient = () => current
export const getSavedGradients = () => saved
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
/** Changes whenever the gradient or the saved list changes (so themes re-resolve). */
export const useGradientVersion = () => useSyncExternalStore(subscribe, () => version)
export const useGradient = () => useSyncExternalStore(subscribe, () => current)
export const useSavedGradients = () => useSyncExternalStore(subscribe, () => saved)
