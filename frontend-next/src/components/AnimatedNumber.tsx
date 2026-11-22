import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

// Counts up to the value the first time it comes into view (and on later changes).
export function AnimatedNumber({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true })
  const reduce = useReducedMotion()
  const from = useRef(0)
  useEffect(() => {
    if (!ref.current || value == null || !seen) return
    if (reduce) { ref.current.textContent = value + suffix; from.current = value; return }
    const c = animate(from.current, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1],
      onUpdate: v => { if (ref.current) ref.current.textContent = Math.round(v) + suffix } })
    from.current = value
    return () => c.stop()
  }, [value, seen, reduce, suffix])
  return <span ref={ref} className="tabular">{value == null ? '–' : 0 + suffix}</span>
}
