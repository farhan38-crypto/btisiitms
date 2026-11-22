// Form controls and small building blocks, all themed through CSS variables.
import { LayoutGroup, motion } from 'motion/react'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { initials } from '../lib/format'

export function Field({ label, hint, error, children, optional, className }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; optional?: boolean; className?: string }) {
  return (
    <label className={`field ${className || ''}`} data-error={error ? '' : undefined}>
      {label && <span className="field-label">{label}{optional && <em>optional</em>}</span>}
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(p, ref) {
  return <input ref={ref} {...p} className={`input ${p.className || ''}`} />
})
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(p, ref) {
  return <textarea ref={ref} rows={3} {...p} className={`input area ${p.className || ''}`} />
})
export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="select"><select {...p} className={`input ${p.className || ''}`}>{children}</select></span>
}

/** Segmented control with a sliding highlight. */
export function Segmented<T extends string>({ value, onChange, options, size, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode; count?: number }[]
  size?: 'sm'; label?: string; className?: string }) {
  const id = useId()
  return (
    <LayoutGroup id={id}>
      <div className={`seg ${size === 'sm' ? 'seg-sm' : ''} ${className || ''}`} role="tablist" aria-label={label}>
        {options.map(o => {
          const on = o.value === value
          return (
            <button key={o.value} type="button" role="tab" aria-selected={on} data-on={on || undefined} onClick={() => onChange(o.value)}>
              {on && <motion.span layoutId="seg" className="seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
              <span className="seg-in">{o.icon}{o.label}{o.count != null && <em className="seg-count tabular">{o.count}</em>}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" disabled={disabled} onClick={() => onChange(!checked)}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className="ap-switch" />
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }) { return <Loader2 size={size} className="spin" aria-hidden /> }

export function Button({ busy, children, variant, icon, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'danger' | 'ghost' | 'quiet'; icon?: ReactNode }) {
  return (
    <button type="button" {...p} disabled={p.disabled || busy} aria-busy={busy || undefined}
      className={`btn ${variant ? `btn-${variant}` : ''} ${p.className || ''}`}>
      {busy ? <Spinner /> : icon}{children}
    </button>
  )
}

export function Avatar({ name, size = 28, src }: { name?: string | null; size?: number; src?: string | null }) {
  // A stable hue per person, so the same name always gets the same colour.
  let h = 0; for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 360
  return src
    ? <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="avatar" aria-hidden style={{ width: size, height: size, fontSize: size * .38, ['--h' as string]: h }}>{initials(name)}</span>
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <span className="empty-icon">{icon}</span>}
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
export function Skeleton({ h = 18, w, r, className }: { h?: number; w?: number | string; r?: number; className?: string }) {
  return <span className={`skel ${className || ''}`} style={{ height: h, width: w, borderRadius: r }} aria-hidden />
}
export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd> }

/** Section of a page: heading + optional line + content. */
export function Section({ title, hint, action, children, className, id }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`section ${className || ''}`} id={id}>
      {(title || action) && <header className="section-head"><div>{title && <h2>{title}</h2>}{hint && <p>{hint}</p>}</div>{action}</header>}
      {children}
    </section>
  )
}
