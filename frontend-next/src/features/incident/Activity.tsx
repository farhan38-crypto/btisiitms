// The incident's story: comments as speech bubbles, changes as quiet one-liners, and a box
// to add a note. Built from the audit trail (every event the backend recorded).
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRightLeft, Camera, CheckCircle2, Clock, Flag, MapPin, MessageSquare, Navigation, Pencil, RotateCcw, Send, ShieldCheck, Sparkles, UserCheck, Zap } from 'lucide-react'
import { api, ApiError, type AuditEntry, type Incident, type User } from '../../api'
import { dateTime, statusLabel, timeAgo } from '../../lib/format'
import { Avatar, Button, Segmented } from '../../ui/Controls'
import { refreshIncident } from './Actions'

const SYSTEM = new Set(['INCIDENT_CLASSIFIED', 'PRIORITY_CALCULATED', 'SLA_APPLIED'])
const ICON: Record<string, typeof Flag> = {
  INCIDENT_CREATED: Flag, ASSIGNED: UserCheck, STATUS_CHANGED: ArrowRightLeft, RESOLVED: CheckCircle2, CLOSED: CheckCircle2,
  REOPENED: RotateCcw, INFO_REQUESTED: MessageSquare, PRIORITY_CHANGED: Zap, INCIDENT_UPDATED: Pencil, SLA_AT_RISK: Clock,
  SLA_BREACHED: AlertTriangle, ESCALATED: Zap, CORRELATION_DETECTED: Zap, LOCATION_CAPTURED: MapPin, TECHNICIAN_EN_ROUTE: Navigation,
  TECHNICIAN_ARRIVED: MapPin, HANDOVER_VERIFIED: ShieldCheck, ATTACHMENT_ADDED: Camera, PRIORITY_CALCULATED: Sparkles,
}
const TONE: Record<string, string> = { SLA_BREACHED: 'var(--p1)', ESCALATED: 'var(--p1)', SLA_AT_RISK: 'var(--p2)', RESOLVED: 'var(--ok)', CLOSED: 'var(--ok)', HANDOVER_VERIFIED: 'var(--ok)', REOPENED: 'var(--p2)' }

const isSystem = (a: AuditEntry) => a.actor_role === 'system' || a.actor_id === 'system'
/** One readable sentence after the person's name ("Alice Chen" + "is on the way to Block D"). */
function describe(a: AuditEntry) {
  const d = a.description || ''
  switch (a.action) {
    case 'INCIDENT_CREATED': return 'reported it'
    case 'STATUS_CHANGED': return a.previous_state && a.new_state ? `moved it from ${statusLabel(a.previous_state)} to ${statusLabel(a.new_state)}` : d
    case 'LOCATION_CAPTURED': return `shared the exact spot from their phone${d.match(/\(±[^)]+\)/) ? ' ' + d.match(/\(±[^)]+\)/)![0] : ''}`
    case 'INFO_REQUESTED': return 'asked the reporter for more information'
    case 'PRIORITY_CHANGED': return d.replace(/^Priority changed/, 'changed the priority')
    case 'HANDOVER_VERIFIED': return d.startsWith('Resolved by an administrator') ? 'resolved it without the handover code' : 'confirmed the handover code'
    case 'RESOLVED': return d.replace(/^Resolved:/, 'resolved it:')
  }
  if (d.startsWith(a.actor_name + ' ')) return d.slice(a.actor_name.length + 1)
  return d.charAt(0).toLowerCase() + d.slice(1)
}

export function Activity({ incident, audit, user }: { incident: Incident; audit: AuditEntry[]; user: User }) {
  const [tab, setTab] = useState<'all' | 'notes'>('all')
  const [system, setSystem] = useState(false)
  const items = useMemo(() => audit.filter(a => (tab === 'notes' ? a.action === 'NOTE_ADDED' : system || !SYSTEM.has(a.action))), [audit, tab, system])
  const notes = audit.filter(a => a.action === 'NOTE_ADDED').length
  return (
    <section className="activity">
      <header className="section-head">
        <h2>Activity</h2>
        <Segmented size="sm" value={tab} onChange={setTab} label="Show" options={[{ value: 'all', label: 'Everything' }, { value: 'notes', label: 'Notes', count: notes }]} />
      </header>
      <ol className="feed">
        {items.map(a => {
          if (a.action === 'NOTE_ADDED') {
            const text = String(a.data?.text ?? a.description)
            const mine = a.actor_id === user.id
            const question = text.startsWith('Question: ')
            return (
              <li key={a.id} className="feed-note" data-mine={mine || undefined}>
                <Avatar name={a.actor_name} size={30} />
                <div className="bubble" data-q={question || undefined}>
                  <header><b>{mine ? 'You' : a.actor_name}</b><span>{a.actor_role === 'customer' ? 'Reporter' : a.actor_role === 'technician' ? 'Technician' : a.actor_role === 'admin' ? 'Admin' : ''}</span>
                    <time dateTime={a.timestamp} title={dateTime(a.timestamp)}>{timeAgo(a.timestamp)}</time></header>
                  <p>{question ? <><em>Question</em>{text.slice(10)}</> : text}</p>
                </div>
              </li>
            )
          }
          const Icon = ICON[a.action] || ArrowRightLeft
          return (
            <li key={a.id} className="feed-event" style={{ ['--k' as string]: TONE[a.action] || 'var(--ink-3)' }}>
              <span className="feed-icon"><Icon size={13} /></span>
              <p>{isSystem(a) ? <>{a.description} <em className="auto">automatic</em></> : <><b>{a.actor_name}</b> {describe(a)}</>}</p>
              <time dateTime={a.timestamp} title={dateTime(a.timestamp)}>{timeAgo(a.timestamp)}</time>
            </li>
          )
        })}
        {tab === 'all' && audit.some(a => SYSTEM.has(a.action)) && (
          <li className="feed-more"><button type="button" className="link" onClick={() => setSystem(s => !s)}>{system ? 'Hide automatic steps' : 'Show automatic steps (classification, priority, SLA)'}</button></li>
        )}
      </ol>
      {incident.status !== 'CLOSED' && <Composer incident={incident} user={user} />}
    </section>
  )
}

function Composer({ incident, user }: { incident: Incident; user: User }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.incidents.addNote(incident.id, text.trim(), user.role === 'customer' ? 'reporter' : 'investigation')
      setText(''); refreshIncident(incident.id)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not add the note') }
    finally { setBusy(false) }
  }
  return (
    <div className="composer">
      <Avatar name={user.name} src={user.picture} size={30} />
      <div className="composer-box">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="Add a note"
          placeholder={user.role === 'customer' ? 'Add details or answer a question…' : 'Add a note for the team and the reporter…'}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }} />
        <div className="composer-foot"><small>Everyone on this report sees notes. Ctrl+Enter sends.</small>
          <Button variant="primary" className="sm" busy={busy} disabled={!text.trim()} onClick={send} icon={<Send size={14} />}>Send</Button></div>
      </div>
    </div>
  )
}
