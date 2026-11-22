// The theme registry: look themes up, fill their gaps from the family, apply display
// preferences, resolve 'auto' (follow the device), and suggest themes for this screen.
import { CATALOG } from './catalog'
import { getFamily } from './families'
import type { DisplayPrefs, Palette, Priority, ResolvedTheme, Scheme, ThemeDefinition } from './types'

const themes = new Map<string, ThemeDefinition>()
/** Add (or replace) a theme. Ids are saved with accounts, so never reuse an id for a different look. */
export function registerTheme(t: ThemeDefinition) {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(t.id)) throw new Error(`Theme id "${t.id}" must be lower-case letters, digits and '-'`)
  themes.set(t.id, t)
}
CATALOG.forEach(registerTheme)

export const AUTO = 'auto'
export const DEFAULT_THEME = 'aurora'
export const DEFAULT_PREFS: DisplayPrefs = { reduce_transparency: false, reduce_motion: false, colour_safe: false, auto_light: 'paper', auto_dark: 'aurora' }
export const allThemes = () => [...themes.values()]
export const getThemeDef = (id?: string | null) => (id && themes.get(id)) || themes.get(DEFAULT_THEME)!
export const hasTheme = (id?: string | null) => !!id && (id === AUTO || themes.has(id))

const DARK_DEFAULTS: Omit<Palette, 'base' | 'a' | 'b'> = {
  ink: '#F4F4F6', ink2: 'rgb(244 244 246 / .64)', ink3: 'rgb(244 244 246 / .42)',
  glass: 'rgb(255 255 255 / .055)', glassHi: 'rgb(255 255 255 / .09)', glassSolid: 'rgb(14 14 18 / .9)',
  rim: 'rgb(255 255 255 / .14)', rimTop: 'rgb(255 255 255 / .26)', rimBottom: 'rgb(255 255 255 / .05)',
  shadow: '0 30px 60px -30px rgb(0 0 0 / .8)', onAccent: '#0A0A12',
}
const LIGHT_DEFAULTS: Omit<Palette, 'base' | 'a' | 'b'> = {
  ink: '#15141A', ink2: 'rgb(21 20 26 / .66)', ink3: 'rgb(21 20 26 / .48)',
  glass: 'rgb(255 255 255 / .6)', glassHi: 'rgb(255 255 255 / .8)', glassSolid: 'rgb(255 255 255 / .95)',
  rim: 'rgb(20 20 40 / .1)', rimTop: 'rgb(255 255 255 / .9)', rimBottom: 'rgb(20 20 40 / .12)',
  shadow: '0 30px 60px -32px rgb(40 30 90 / .35)', onAccent: '#FFFFFF',
}
// Okabe–Ito based status colours: distinct for protan, deutan and tritan colour vision.
const SAFE_STATUS: Record<Scheme, Record<Priority, string>> = {
  dark: { P1: '#E8702A', P2: '#F0C24B', P3: '#56B4E9', P4: '#3FBF8F' },
  light: { P1: '#C2460D', P2: '#A86B00', P3: '#0F68A2', P4: '#127A55' },
}
const SAFE_CHART: Record<Scheme, Record<Priority, string>> = {
  dark: { P1: '#CC2A1B', P2: '#C58718', P3: '#299ABE', P4: '#4F9B3E' },
  light: { P1: '#BB0A10', P2: '#BF7B0E', P3: '#0C6493', P4: '#308639' },
}
const CHART_PRIORITY: Record<Scheme, Record<Priority, string>> = {
  dark: { P1: '#E2314E', P2: '#D57C11', P3: '#8169DD', P4: '#379FC7' },
  light: { P1: '#D31E43', P2: '#CE710C', P3: '#634CD4', P4: '#2591C4' },
}

/** The theme the device should show for an id ('auto' follows the system light/dark setting). */
export function effectiveId(id: string | null | undefined, prefs: DisplayPrefs, systemDark: boolean) {
  if (id === AUTO) return (systemDark ? prefs.auto_dark : prefs.auto_light) || (systemDark ? 'aurora' : 'paper')
  return hasTheme(id) ? id! : DEFAULT_THEME
}

export function resolveTheme(id: string, prefs: DisplayPrefs = DEFAULT_PREFS): ResolvedTheme {
  const t = getThemeDef(id)
  const fam = getFamily(t.family).defaults(t.scheme)
  const palette: Palette = { ...(t.scheme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS), ...t.palette } as Palette
  const backdrop = t.backdrop || fam.backdrop
  const surfaces = { ...fam.surfaces, ...t.surfaces }
  if (prefs.reduce_transparency) { surfaces.translucent = false; surfaces.blur = 0 }
  const baseStatus: Record<Priority, string> = { P1: '#FF4D6D', P2: '#FFA53D', P3: palette.a, P4: '#7DD3FC',
    ...(t.scheme === 'light' ? { P1: '#D31E43', P2: '#C96A00', P4: '#1C7FB0' } : {}), ...t.status }
  const status = prefs.colour_safe ? SAFE_STATUS[t.scheme] : baseStatus
  const chartPriority = prefs.colour_safe ? SAFE_CHART[t.scheme] : { ...CHART_PRIORITY[t.scheme], ...t.chart?.priority }
  const series = t.chart?.series || (t.scheme === 'dark' ? ['#7E6EF2', '#19A997'] : ['#5B4BF4', '#E45937']) as [string, string]
  return {
    ...t, key: t.id, label: t.name,
    base: palette.base, a: palette.a, b: palette.b, c: palette.c,
    mesh: backdrop.kind === 'mesh' ? (backdrop.colours.length ? backdrop.colours : [palette.base, palette.base]) : [palette.base],
    palette, backdrop, surfaces,
    effects: { ...fam.effects, ...t.effects },
    typography: { weightBoost: 0, scale: 1, ...fam.typography, ...t.typography },
    status, chart: { series, priority: chartPriority }, prefs,
  }
}

/** Themes worth offering first on this device right now. */
export function suggestions(): { id: string; why: string }[] {
  const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches
  const out: { id: string; why: string }[] = []
  const hour = new Date().getHours()
  if (mq('(prefers-contrast: more)')) out.push({ id: 'high-contrast', why: 'Your device asks for more contrast' })
  if (hour >= 21 || hour < 6) out.push({ id: 'night', why: 'It’s late: warm colours are easier on the eyes' })
  if (mq('(prefers-color-scheme: dark)')) {
    out.push(mq('(dynamic-range: high)')
      ? { id: 'oled-black', why: 'Your screen looks like OLED/HDR: true black saves battery' }
      : { id: 'graphite', why: 'Dark grey reads best on most laptop screens' })
  } else out.push({ id: 'paper', why: 'Your device is in light mode' })
  if (mq('(pointer: coarse)')) out.push({ id: 'sunlight', why: 'On a phone outdoors? Built for glare' })
  const seen = new Set<string>()
  return out.filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, 3)
}
