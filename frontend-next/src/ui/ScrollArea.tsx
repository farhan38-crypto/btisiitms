// A box that scrolls on its own, and looks like it: soft fades at the edges that still have
// content, a thin visible scrollbar, and scroll chaining off (overscroll-behavior: contain),
// so it never feels like the page itself is scrolling.
import { forwardRef, useCallback, useEffect, useRef, type HTMLAttributes } from 'react'

export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { axis?: 'y' | 'x' }>(
  function ScrollArea({ axis = 'y', className, children, ...rest }, outer) {
    const ref = useRef<HTMLDivElement | null>(null)
    const update = useCallback(() => {
      const el = ref.current; if (!el) return
      const start = axis === 'y' ? el.scrollTop : el.scrollLeft
      const size = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
      el.dataset.start = start > 2 ? '1' : ''
      el.dataset.end = size - start > 2 ? '1' : ''
    }, [axis])
    useEffect(() => {
      const el = ref.current; if (!el) return
      update()
      const ro = new ResizeObserver(update); ro.observe(el)
      const mo = new MutationObserver(update); mo.observe(el, { childList: true, subtree: true })
      return () => { ro.disconnect(); mo.disconnect() }
    }, [update])
    return (
      <div {...rest} ref={el => { ref.current = el; if (typeof outer === 'function') outer(el); else if (outer) outer.current = el }}
        className={`scroll-area scroll-${axis} ${className || ''}`} onScroll={e => { update(); rest.onScroll?.(e) }} tabIndex={rest.tabIndex ?? 0}>
        {children}
      </div>
    )
  })
