// Dialogs, side sheets and popovers. On phones dialogs and popovers become bottom
// sheets (CSS, .ov-sheet) with a drag handle; drag down to close.
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useIsPhone } from '../lib/media'

function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose); ref.current = onClose
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); ref.current() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [open])
}
/** Keep focus inside while open, and give it back to whatever opened it. */
function useFocusTrap(open: boolean, box: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => {
      const el = box.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select, button:not([data-x])') || box.current
      el?.focus({ preventScroll: true })
    }, 30)
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box.current) return
      const f = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null)
      if (!f.length) return
      const first = f[0]!, last = f[f.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', trap); before?.focus?.({ preventScroll: true }) }
  }, [open, box])
}
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = prev }
  }, [open])
}

const SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const

export interface DialogProps {
  open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode
  children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg'; side?: boolean; className?: string
}
/** Centered dialog (or a sheet from the right with side). Bottom sheet on phones. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', side, className }: DialogProps) {
  const phone = useIsPhone()
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  const drag = useDragControls()
  useEscape(open, onClose); useFocusTrap(open, box); useScrollLock(open)
  const sheet = phone
  const end = (_: unknown, info: PanInfo) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose() }
  const motionProps = sheet
    ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, drag: 'y' as const, dragControls: drag, dragListener: false, dragConstraints: { top: 0, bottom: 0 }, dragElastic: { top: 0, bottom: .6 }, onDragEnd: end }
    : side ? { initial: { x: 40, opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: 40, opacity: 0 } }
    : { initial: { y: 16, scale: .97, opacity: 0 }, animate: { y: 0, scale: 1, opacity: 1 }, exit: { y: 10, scale: .98, opacity: 0 } }
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="ov-root" key="ov">
          <motion.div className="ov-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div ref={box} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} tabIndex={-1}
            className={`ov-panel ${sheet ? 'ov-sheet' : side ? 'ov-side' : `ov-dialog ov-${size}`} ${className || ''}`}
            transition={SPRING} {...motionProps}>
            {sheet && <div className="ov-handle" onPointerDown={e => drag.start(e)} aria-hidden><i /></div>}
            {(title || description) && (
              <header className="ov-head" onPointerDown={sheet ? e => drag.start(e) : undefined}>
                <div>{title && <h2 id={id}>{title}</h2>}{description && <p>{description}</p>}</div>
                <button type="button" className="icon-btn ghost" data-x onClick={onClose} aria-label="Close"><X size={18} /></button>
              </header>
            )}
            <div className="ov-body">{children}</div>
            {footer && <footer className="ov-foot">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>, document.body)
}

/** A floating panel attached to a trigger. Bottom sheet on phones. */
export function Popover({ trigger, children, align = 'end', width = 320, title, open: openProp, onOpenChange, className }: {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement>; props: Record<string, unknown> }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode); align?: 'start' | 'end'; width?: number; title?: string
  open?: boolean; onOpenChange?: (o: boolean) => void; className?: string
}) {
  const [inner, setInner] = useState(false)
  const open = openProp ?? inner
  const setOpen = useCallback((v: boolean) => { if (onOpenChange) onOpenChange(v); else setInner(v) }, [onOpenChange])
  const close = useCallback(() => setOpen(false), [setOpen])
  const phone = useIsPhone()
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const id = useId()
  useEscape(open && !phone, close)
  useEffect(() => {
    if (!open || phone) return
    const place = () => {
      const r = btn.current?.getBoundingClientRect(); if (!r) return
      const w = Math.min(width, window.innerWidth - 16)
      let left = align === 'end' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      setPos({ top: r.bottom + 10, left })
    }
    place()
    const out = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || wrap.current?.contains(t)) return
      close()
    }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', out)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', out) }
  }, [open, phone, align, width, close])
  const body = typeof children === 'function' ? children(close) : children
  return (
    <span ref={wrap} className="pop-wrap">
      {trigger({ open, toggle: () => setOpen(!open), ref: btn, props: { 'aria-expanded': open, 'aria-haspopup': 'dialog', 'aria-controls': open ? id : undefined } })}
      {phone
        ? <Dialog open={open} onClose={close} title={title} className={className}>{body}</Dialog>
        : createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div ref={panel} id={id} role="dialog" aria-label={title} className={`pop glass ${className || ''}`}
                style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16), transformOrigin: align === 'end' ? 'top right' : 'top left' }}
                initial={{ opacity: 0, scale: .96, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .97, y: -4 }}
                transition={{ type: 'spring', stiffness: 520, damping: 36 }}>
                {body}
              </motion.div>
            )}
          </AnimatePresence>, document.body)}
    </span>
  )
}

// ───── confirm(): a promise-based question, so actions read top to bottom ─────
interface Ask { title: string; body?: ReactNode; confirm?: string; danger?: boolean; resolve: (v: boolean) => void }
const AskCtx = createContext<(a: Omit<Ask, 'resolve'>) => Promise<boolean>>(async () => window.confirm('Are you sure?'))
export const useConfirm = () => useContext(AskCtx)
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const confirm = useCallback((a: Omit<Ask, 'resolve'>) => new Promise<boolean>(resolve => setAsk({ ...a, resolve })), [])
  const done = (v: boolean) => { ask?.resolve(v); setAsk(null) }
  return (
    <AskCtx.Provider value={confirm}>
      {children}
      <Dialog open={!!ask} onClose={() => done(false)} title={ask?.title} size="sm"
        footer={<><button className="btn" onClick={() => done(false)}>Cancel</button>
          <button className={`btn ${ask?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => done(true)} autoFocus>{ask?.confirm || 'Continue'}</button></>}>
        {ask?.body && <div className="ov-text">{ask.body}</div>}
      </Dialog>
    </AskCtx.Provider>
  )
}
