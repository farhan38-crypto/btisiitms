// The page background: a slow-moving mesh gradient in the theme's tones (Paper Shaders),
// darkened at the edges so content stays readable. Still when reduced motion is on.
import { MeshGradient } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../lib/themes'
import { useAmbient } from '../lib/store'
import { useAuth } from '../lib/auth'

export function Backdrop({ theme, intensity = 1 }: { theme: Theme; intensity?: number }) {
  const reduce = useReducedMotion() || theme.prefs.reduce_motion
  const bd = theme.backdrop
  // The shader redraws every frame and every frosted panel re-blurs on top of it, so it holds
  // still while the page scrolls and drifts again a moment after (the main cause of lag).
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    if (bd.kind !== 'mesh' || reduce) return
    let t = 0
    const on = () => { setScrolling(true); window.clearTimeout(t); t = window.setTimeout(() => setScrolling(false), 450) }
    window.addEventListener('scroll', on, { passive: true }); window.addEventListener('wheel', on, { passive: true })
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('wheel', on); window.clearTimeout(t) }
  }, [bd.kind, reduce])
  const speed = reduce || scrolling ? 0 : ((bd.kind === 'mesh' ? bd.speed : undefined) ?? 0.18) * (intensity < 1 ? 0.6 : 1)
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 0, background: bd.kind === 'gradient' ? bd.css : theme.base, transition: 'background-color .6s' }}>
      {bd.kind === 'mesh' && <>
        {/* Low resolution: a soft gradient looks the same at a quarter of the pixels, and costs a quarter. */}
        <MeshGradient colors={theme.mesh} distortion={0.85} swirl={0.35} speed={speed}
          grainMixer={0.08} grainOverlay={0.03} minPixelRatio={0.5} maxPixelCount={520 * 1000}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: intensity * (bd.intensity ?? 1), transition: 'opacity .8s' }} />
        <div style={{ position: 'absolute', inset: 0, background: theme.scheme === 'dark'
          ? 'radial-gradient(120% 90% at 50% 0%, transparent 40%, rgb(0 0 0 / .75) 100%)'
          : 'radial-gradient(120% 90% at 50% 0%, transparent 50%, rgb(242 241 238 / .6) 100%)' }} />
      </>}
    </div>
  )
}

// Light for the page, replacing the old glow round every edge (it lit all four corners).
// Two quiet sources, both in the colour of whatever you're pointing at:
//  1. one top light, entering from the top edge and drifting a little toward the pointer;
//  2. a rim light on the glass panel under the pointer: only its border catches the light,
//     brightest nearest the cursor (the "flashlight" border used by Linear and Stripe).
// It reads the hover colour itself, so pointing at things never re-renders the rest of the app.
export function Light() {
  const colour = useAmbient()
  const light = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!matchMedia('(hover: hover)').matches) return   // touch screens: top light only
    let lit: HTMLElement | null = null, frame = 0, x = 0, y = 0, target: EventTarget | null = null
    const paint = () => {
      frame = 0
      light.current?.style.setProperty('--lx', `${Math.round((x / innerWidth) * 100)}%`)
      const panel = target instanceof Element ? target.closest<HTMLElement>('.glass') : null
      if (panel !== lit) { lit?.removeAttribute('data-lit'); lit = panel; lit?.setAttribute('data-lit', '') }
      if (panel) {
        const r = panel.getBoundingClientRect()
        panel.style.setProperty('--mx', `${x - r.left}px`)
        panel.style.setProperty('--my', `${y - r.top}px`)
      }
    }
    const move = (e: PointerEvent) => { x = e.clientX; y = e.clientY; target = e.target; if (!frame) frame = requestAnimationFrame(paint) }
    const leave = () => { lit?.removeAttribute('data-lit'); lit = null }
    addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => { removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); cancelAnimationFrame(frame); leave() }
  }, [])
  // The colour lives on the root so the top light and every panel rim share it (and fade together).
  useEffect(() => {
    const root = document.documentElement
    if (colour) root.style.setProperty('--edge-c', colour); else root.style.removeProperty('--edge-c')
  }, [colour])
  const { theme } = useAuth()
  if (!theme.effects.light) return null
  return <div ref={light} className="toplight" aria-hidden><i /></div>
}
