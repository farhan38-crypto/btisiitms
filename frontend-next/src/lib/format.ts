// Words and numbers for people: times, durations, statuses, event names.
import type { Priority, SlaStatus, Status } from '../api'

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function timeAgo(iso?: string | null, now = Date.now()) {
  if (!iso) return ''
  const s = (new Date(iso).getTime() - now) / 1000
  const a = Math.abs(s)
  if (a < 45) return 'just now'
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return dateShort(iso)
}
export const dateShort = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''
export const dateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
export const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
export const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const y = new Date(); y.setDate(t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}

/** 45 → "45 min", 120 → "2 h", 90 → "1 h 30 min", 2880 → "2 days" */
export function minutes(m?: number | null) {
  if (m == null) return '—'
  const v = Math.round(Math.abs(m))
  if (v < 60) return `${v} min`
  if (v < 1440) { const h = Math.floor(v / 60), r = v % 60; return r ? `${h} h ${r} min` : `${h} h` }
  const d = Math.round(v / 144) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}
/** Time left until a deadline, compact: "12 min", "3 h 5 min", "-8 min" when overdue. */
export function untilText(iso?: string | null, now = Date.now()) {
  if (!iso) return ''
  const m = (new Date(iso).getTime() - now) / 60000
  return m < 0 ? `${minutes(-m)} over` : `${minutes(m)} left`
}

export const STATUS_LABEL: Record<Status, string> = {
  NEW: 'New', CLASSIFIED: 'Waiting for a technician', ASSIGNED: 'Assigned', ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress', PENDING_INFO: 'Needs info', RESOLVED: 'Resolved', VERIFIED: 'Verified', CLOSED: 'Closed',
}
export const STATUS_SHORT: Record<Status, string> = { ...STATUS_LABEL, CLASSIFIED: 'Unassigned' }
export const statusLabel = (s?: string | null) => (s && STATUS_LABEL[s as Status]) || (s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
/** Verb on the button that moves an incident to this status. */
export const STATUS_ACTION: Partial<Record<Status, string>> = {
  ACKNOWLEDGED: 'Acknowledge', IN_PROGRESS: 'Start work', PENDING_INFO: 'Ask for info', RESOLVED: 'Resolve',
  VERIFIED: 'Confirm it’s fixed', CLOSED: 'Close', CLASSIFIED: 'Classify',
}
export const PRIORITY_LABEL: Record<Priority, string> = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' }
export const SLA_LABEL: Record<SlaStatus, string> = { ON_TRACK: 'On track', AT_RISK: 'At risk', BREACHED: 'Breached', MET: 'Met' }
export const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', technician: 'Technician', customer: 'Student', system: 'Automation' }

export const EVENT_LABEL: Record<string, string> = {
  INCIDENT_CREATED: 'Reported', INCIDENT_CLASSIFIED: 'Classified', PRIORITY_CALCULATED: 'Priority set', SLA_APPLIED: 'SLA started',
  ASSIGNED: 'Assigned', STATUS_CHANGED: 'Status changed', INFO_REQUESTED: 'Info requested', RESOLVED: 'Resolved',
  REOPENED: 'Reopened', CLOSED: 'Closed', PRIORITY_CHANGED: 'Priority changed', INCIDENT_UPDATED: 'Updated',
  NOTE_ADDED: 'Note', SLA_AT_RISK: 'SLA at risk', SLA_BREACHED: 'SLA breached', ESCALATED: 'Escalated',
  CORRELATION_DETECTED: 'Possible major incident', LOCATION_CAPTURED: 'Location shared', TECHNICIAN_EN_ROUTE: 'On the way',
  TECHNICIAN_ARRIVED: 'Arrived', HANDOVER_VERIFIED: 'Handover confirmed', ATTACHMENT_ADDED: 'Attachment',
}
export const eventLabel = (t?: string) => (t && EVENT_LABEL[t]) || statusLabel(t)

export const initials = (name?: string | null) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
export const isHostel = (name?: string | null) => !!name && /bhavan/i.test(name)
