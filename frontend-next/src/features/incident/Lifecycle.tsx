// Where an incident is in its life. Staff see a rail with timestamps; the person who reported
// it sees the same journey told like a delivery tracker ("Alice is on the way").
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import type { AuditEntry, Incident } from '../../api'
import { clock, dateShort } from '../../lib/format'

interface Step { key: string; label: string; done: boolean; current: boolean; at?: string | null; note?: string }
const ORDER = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INFO', 'RESOLVED', 'VERIFIED', 'CLOSED']
const reached = (i: Incident, s: string) => ORDER.indexOf(i.status) >= ORDER.indexOf(s)
const lastAt = (audit: AuditEntry[], action: string) => [...audit].reverse().find(a => a.action === action)?.timestamp

export function steps(i: Incident, audit: AuditEntry[], forReporter: boolean): Step[] {
  const onSite = i.location.type !== 'online'
  const v = i.field_visit
  const working = reached(i, 'ACKNOWLEDGED')
  const resolved = reached(i, 'RESOLVED')
  const list: Omit<Step, 'current'>[] = [
    { key: 'reported', label: forReporter ? 'Report received' : 'Reported', done: true, at: i.created_at },
    { key: 'assigned', label: forReporter ? (i.assigned_name ? `${i.assigned_name.split(' ')[0]} assigned` : 'Finding a technician') : 'Assigned',
      done: reached(i, 'ASSIGNED'), at: lastAt(audit, 'ASSIGNED'), note: forReporter ? undefined : i.assigned_name || undefined },
    { key: 'working', label: forReporter ? 'Working on it' : 'Acknowledged', done: working, at: i.sla?.responded_at },
    ...(onSite ? [{ key: 'onsite', label: v?.status === 'EN_ROUTE' && !v.arrived_at ? 'On the way' : 'On site',
      done: !!v?.arrived_at || resolved, at: v?.arrived_at || v?.en_route_at }] : []),
    { key: 'resolved', label: forReporter ? 'Fixed' : 'Resolved', done: resolved, at: i.resolution?.resolved_at },
    { key: 'closed', label: i.status === 'VERIFIED' ? 'Confirmed' : 'Closed', done: reached(i, 'VERIFIED'), at: i.closure?.closed_at || lastAt(audit, 'STATUS_CHANGED') },
  ]
  const firstOpen = list.findIndex(s => !s.done)
  return list.map((s, k) => ({ ...s, current: k === firstOpen }))
}

/** One sentence for the reporter: what's happening right now. */
export function trackerHeadline(i: Incident): { title: string; sub: string } {
  const who = i.assigned_name?.split(' ')[0]
  const v = i.field_visit
  switch (i.status) {
    case 'NEW': case 'CLASSIFIED': return { title: 'We’ve got your report', sub: 'A technician will pick it up shortly.' }
    case 'ASSIGNED': return { title: `${who || 'A technician'} will handle this`, sub: 'They’ll start as soon as they’re free.' }
    case 'ACKNOWLEDGED': return v?.status === 'EN_ROUTE'
      ? { title: `${who || 'Your technician'} is on the way`, sub: `Heading to ${i.location.formatted}.` }
      : { title: `${who || 'Your technician'} has seen it`, sub: 'Work starts soon.' }
    case 'IN_PROGRESS': return v?.arrived_at && !i.resolution
      ? { title: `${who || 'Your technician'} has arrived`, sub: 'When the job is done, give them your handover code.' }
      : { title: `${who || 'Your technician'} is working on it`, sub: 'You’ll be told when it’s fixed.' }
    case 'PENDING_INFO': return { title: 'They need a bit more information', sub: 'Add a note below, then send it back.' }
    case 'RESOLVED': return { title: 'Marked as fixed', sub: 'Check it works, then confirm, or say it’s still broken.' }
    case 'VERIFIED': return { title: 'You confirmed the fix', sub: 'Rate the help to close the report.' }
    case 'CLOSED': return { title: 'Closed', sub: i.closure ? `You rated it ${i.closure.feedback_rating}/5. Thank you.` : 'This report is finished.' }
  }
}

export function LifecycleRail({ incident, audit, forReporter }: { incident: Incident; audit: AuditEntry[]; forReporter: boolean }) {
  const s = steps(incident, audit, forReporter)
  const doneCount = s.filter(x => x.done).length
  const progress = Math.max(0, (doneCount - 1) / (s.length - 1))
  const waiting = incident.status === 'PENDING_INFO'
  return (
    <ol className="rail" aria-label="Progress" style={{ ['--n' as string]: s.length }}>
      <span className="rail-track" aria-hidden><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: progress }} transition={{ duration: .9, ease: [0.22, 1, 0.36, 1] }} /></span>
      {s.map(step => (
        <li key={step.key} data-done={step.done || undefined} data-current={step.current || undefined} data-wait={step.current && waiting || undefined}
          aria-current={step.current ? 'step' : undefined}>
          <span className="rail-dot">{step.done ? <Check size={12} strokeWidth={3} /> : step.current ? <i /> : null}</span>
          <b>{step.current && waiting && step.key === 'onsite' ? 'Waiting for info' : step.label}</b>
          <small>{step.done && step.at ? `${dateShort(step.at)}, ${clock(step.at)}` : step.current ? (waiting ? 'Waiting for the reporter' : 'Next') : ''}{step.note ? ` · ${step.note}` : ''}</small>
        </li>
      ))}
    </ol>
  )
}
