// Writes a resolved theme onto <html>: CSS variables for every colour and surface setting,
// plus data attributes the stylesheet keys off (scheme, family, solid panels, motion).
import type { ResolvedTheme } from './types'

export function applyTheme(t: ResolvedTheme) {
  const r = document.documentElement
  const p = t.palette
  const vars: Record<string, string> = {
    '--base': p.base, '--a': p.a, '--b': p.b, '--c': p.c || p.b, '--edge': p.a,
    '--ink': p.ink, '--ink-2': p.ink2, '--ink-3': p.ink3,
    '--glass': p.glass, '--glass-hi': p.glassHi, '--glass-solid': p.glassSolid,
    '--rim': p.rim, '--rim-top': p.rimTop, '--rim-bottom': p.rimBottom, '--shadow': p.shadow,
    '--on-accent': p.onAccent || (t.scheme === 'dark' ? '#0A0A12' : '#FFFFFF'),
    '--blur': `${t.surfaces.translucent ? t.surfaces.blur : 0}px`,
    '--rim-w': `${t.surfaces.rimWidth || 1}px`,
    '--radius': `${t.surfaces.radius || 24}px`,
    '--weight-boost': String(t.typography.weightBoost),
    '--text-scale': String(t.typography.scale),
    '--p1': t.status.P1, '--p2': t.status.P2, '--p3': t.status.P3, '--p4': t.status.P4,
  }
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v)
  r.dataset.scheme = t.scheme
  r.dataset.theme = t.id
  r.dataset.family = t.family
  r.dataset.solid = t.surfaces.translucent ? 'false' : 'true'
  r.dataset.glow = t.effects.glow ? 'true' : 'false'
  r.dataset.motion = t.prefs.reduce_motion ? 'calm' : 'full'
  r.style.colorScheme = t.scheme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.base)
}

/** Switch themes with a circle of the new look spreading out from where you clicked. */
export function withReveal(change: () => void, from?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'calm') { change(); return }
  const x = from?.x ?? innerWidth / 2, y = from?.y ?? 0
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  document.documentElement.dataset.reveal = 'true'
  const vt = doc.startViewTransition(change)
  vt.ready.then(() => {
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 560, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' })
  }).catch(() => {}).finally(() => setTimeout(() => { delete document.documentElement.dataset.reveal }, 650))
}
