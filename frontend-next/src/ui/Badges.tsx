// Small labels that carry meaning: priority, status, SLA. Colour is never the only
// signal: each also has a word (and priority a shape), so they read in every theme.
import { useEffect, useState } from 'react'
import type { Priority, Sla, SlaStatus, Status } from '../api'
import { PRIORITY_LABEL, SLA_LABEL, STATUS_SHORT, untilText } from '../lib/format'

export const pVar = (p?: string | null) => `var(--${(p || 'P3').toLowerCase()})`

/** Signal bars, like a phone's: 4 for P1, 1 for P4. */
export function PriorityMark({ p, size = 14 }: { p?: Priority | null; size?: number }) {
  const n = p ? 5 - Number(p[1]) : 0
  return (
    <svg className="pmark" width={size} height={size} viewBox="0 0 14 14" aria-hidden style={{ color: pVar(p) }}>
      {[0, 1, 2, 3].map(i => <rect key={i} x={1 + i * 3.3} y={10 - i * 3} width={2.4} height={3 + i * 3} rx={1}
        fill="currentColor" opacity={i < n ? 1 : 0.22} />)}
    </svg>
  )
}

export function PriorityBadge({ p, long }: { p?: Priority | null; long?: boolean }) {
  if (!p) return null
  return <span className="badge prio" style={{ ['--k' as string]: pVar(p) }} title={`${p} · ${PRIORITY_LABEL[p]}`}>
    <PriorityMark p={p} size={12} />{p}{long && <em>{PRIORITY_LABEL[p]}</em>}
  </span>
}

const STATUS_TONE: Record<Status, string> = {
  NEW: 'var(--ink-3)', CLASSIFIED: 'var(--ink-3)', ASSIGNED: 'var(--b)', ACKNOWLEDGED: 'var(--b)', IN_PROGRESS: 'var(--a)',
  PENDING_INFO: 'var(--p2)', RESOLVED: 'var(--ok)', VERIFIED: 'var(--ok)', CLOSED: 'var(--ink-3)',
}
/** A ring that fills as the incident moves through its life. */
const STATUS_FILL: Record<Status, number> = { NEW: 0, CLASSIFIED: .08, ASSIGNED: .25, ACKNOWLEDGED: .4, IN_PROGRESS: .6, PENDING_INFO: .6, RESOLVED: .85, VERIFIED: .95, CLOSED: 1 }
export function StatusIcon({ s, size = 14 }: { s: Status; size?: number }) {
  const f = STATUS_FILL[s] ?? 0, r = 5, c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden style={{ color: STATUS_TONE[s] }} className="sicon">
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity={s === 'CLOSED' ? 1 : .55} strokeDasharray={s === 'NEW' || s === 'CLASSIFIED' ? '2 2' : undefined} />
      {f > 0 && f < 1 && <circle cx="7" cy="7" r={r / 2} fill="none" stroke="currentColor" strokeWidth={r} strokeDasharray={`${f * c / 2} ${c}`} transform="rotate(-90 7 7)" />}
      {f >= 1 && <circle cx="7" cy="7" r="4" fill="currentColor" />}
      {(s === 'RESOLVED' || s === 'VERIFIED') && <path d="M4.6 7.2l1.6 1.6 3.2-3.4" fill="none" stroke="var(--base)" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  )
}
export function StatusBadge({ s }: { s: Status }) {
  return <span className="badge status"><StatusIcon s={s} size={13} />{STATUS_SHORT[s] || s}</span>
}

const SLA_TONE: Record<SlaStatus, string> = { ON_TRACK: 'var(--ink-3)', AT_RISK: 'var(--p2)', BREACHED: 'var(--p1)', MET: 'var(--ok)' }
/** Re-render every `ms` so countdowns move. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t) }, [ms])
  return now
}
export function SlaBadge({ sla, open = true, compact }: { sla?: Sla | null; open?: boolean; compact?: boolean }) {
  const now = useNow()
  if (!sla) return null
  const live = open && sla.status !== 'MET'
  const text = live ? untilText(sla.resolution_due_at, now) : SLA_LABEL[sla.status]
  return <span className="badge sla" data-s={sla.status} style={{ ['--k' as string]: SLA_TONE[sla.status] }}
    title={`SLA ${SLA_LABEL[sla.status]} · resolve by ${new Date(sla.resolution_due_at).toLocaleString()}`}>
    <i />{compact ? text.replace(' left', '').replace(' over', ' late') : text}
  </span>
}

/** Ring showing how much of the resolution window is used. */
export function SlaRing({ sla, open, size = 64 }: { sla?: Sla | null; open: boolean; size?: number }) {
  const now = useNow(15_000)
  if (!sla) return null
  const start = new Date(sla.resolution_due_at).getTime() - sla.resolution_minutes * 60000
  const end = new Date(sla.resolution_due_at).getTime()
  const at = open ? now : new Date(sla.resolved_at || sla.resolution_due_at).getTime()
  const used = Math.min(1, Math.max(0, (at - start) / (end - start)))
  const r = size / 2 - 5, c = 2 * Math.PI * r
  const tone = SLA_TONE[sla.status]
  const left = (end - now) / 60000
  return (
    <div className="sla-ring" style={{ width: size, height: size, ['--k' as string]: tone }} title={`Resolution due ${new Date(end).toLocaleString()}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="sla-track" />
        <circle cx={size / 2} cy={size / 2} r={r} className="sla-fill" strokeDasharray={`${used * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span>
        {open && sla.status !== 'MET'
          ? <><b className="tabular">{Math.abs(left) < 60 ? Math.round(Math.abs(left)) : Math.abs(left) < 1440 ? Math.round(Math.abs(left) / 60) : Math.round(Math.abs(left) / 1440)}</b>
              <small>{Math.abs(left) < 60 ? 'min' : Math.abs(left) < 1440 ? 'h' : 'd'} {left < 0 ? 'late' : 'left'}</small></>
          : <small>{SLA_LABEL[sla.status]}</small>}
      </span>
    </div>
  )
}
