// A light 3D tilt for summary cards: any element with data-tilt leans toward the pointer
// and catches a soft highlight where the pointer is. Off for touch and reduced motion.
let cur: HTMLElement | null = null
const clear = (el: HTMLElement) => { for (const k of ['--rx', '--ry', '--mx', '--my']) el.style.removeProperty(k) }
let started = false
export function startTilt() {
  if (started || typeof window === 'undefined') return
  started = true
  let frame = 0, last: PointerEvent | null = null
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return
    last = e
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (last) move(last) })
  }, { passive: true })
  function move(e: PointerEvent) {
    const calm = document.documentElement.dataset.motion === 'calm' || matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = calm ? null : (e.target as Element | null)?.closest?.<HTMLElement>('[data-tilt]') ?? null
    if (cur && cur !== el) clear(cur)
    cur = el
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    el.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${((x - 0.5) * 9).toFixed(2)}deg`)
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
  }
  document.addEventListener('pointerleave', () => { if (cur) { clear(cur); cur = null } })
}
