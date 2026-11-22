// What can be done to an incident right now. The backend decides (allowed_transitions, the
// State pattern); this file turns each move into a clear button and asks only for what that
// move needs: a summary to resolve, a rating to close, a question when asking for info.
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, CircleHelp, Hand, Pencil, Play, RotateCcw, Sparkles, Star, ThumbsUp, UserPlus, Wand2, XCircle } from 'lucide-react'
import { api, ApiError, invalidate, type FieldInfo, type IncidentDetail, type Status, type User } from '../../api'
import { isAdmin, isStaff } from '../../lib/auth'
import { minutes, plural } from '../../lib/format'
import { Avatar, Button, Field, Input, Select, TextArea } from '../../ui/Controls'
import { Dialog } from '../../ui/Overlay'
import { useTechnicians } from '../incidents/data'
import confetti from 'canvas-confetti'

export const refreshIncident = (id: string) => invalidate(`incident:${id}`, `field:${id}`, `attachments:${id}`, 'incidents', 'overview', 'my-reports', 'notifications')

type Move = { target: Status; label: string; icon: ReactNode; primary?: boolean; ask?: 'resolve' | 'close' | 'info' | 'reopen' | 'provide' }
function movesFor(d: IncidentDetail, user: User): Move[] {
  const can = new Set(d.allowed_transitions)
  const status = d.incident.status
  const reporter = user.role === 'customer'
  const m: Move[] = []
  if (can.has('ACKNOWLEDGED')) m.push({ target: 'ACKNOWLEDGED', label: 'Acknowledge', icon: <Hand size={16} />, primary: true })
  if (can.has('IN_PROGRESS') && status === 'ACKNOWLEDGED') m.push({ target: 'IN_PROGRESS', label: 'Start work', icon: <Play size={16} />, primary: true })
  if (can.has('IN_PROGRESS') && status === 'PENDING_INFO') m.push(reporter
    ? { target: 'IN_PROGRESS', label: 'Send the info', icon: <Play size={16} />, primary: true, ask: 'provide' }
    : { target: 'IN_PROGRESS', label: 'Resume work', icon: <Play size={16} /> })
  if (can.has('RESOLVED')) m.push({ target: 'RESOLVED', label: 'Resolve', icon: <CheckCircle2 size={16} />, primary: true, ask: 'resolve' })
  if (can.has('PENDING_INFO')) m.push({ target: 'PENDING_INFO', label: 'Ask for info', icon: <CircleHelp size={16} />, ask: 'info' })
  if (can.has('VERIFIED')) m.push({ target: 'VERIFIED', label: reporter ? 'Yes, it’s fixed' : 'Verify', icon: <ThumbsUp size={16} />, primary: true })
  if (can.has('IN_PROGRESS') && status === 'RESOLVED') m.push({ target: 'IN_PROGRESS', label: reporter ? 'Still not fixed' : 'Reopen', icon: <RotateCcw size={16} />, ask: 'reopen' })
  if (can.has('CLOSED')) m.push({ target: 'CLOSED', label: reporter ? 'Rate and close' : 'Close', icon: <Star size={16} />, primary: reporter || status === 'VERIFIED', ask: 'close' })
  // Only one primary button at a time: the most natural next step.
  let seen = false
  return m.map(x => { if (x.primary && !seen) { seen = true; return x } return { ...x, primary: false } })
}

export function ActionBar({ d, user, field, onEdit, compact }: { d: IncidentDetail; user: User; field?: FieldInfo | null; onEdit: () => void; compact?: boolean }) {
  const i = d.incident
  const [move, setMove] = useState<Move | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const moves = movesFor(d, user)
  const staff = isStaff(user), admin = isAdmin(user)
  const assignable = staff && (i.status === 'CLASSIFIED' || i.status === 'ASSIGNED')
  const mineToTake = user.role === 'technician' && assignable && i.assigned_to !== user.id

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast.success(ok); refreshIncident(i.id) }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'That didn’t work') }
    finally { setBusy(null) }
  }
  const direct = (m: Move) => m.ask ? setMove(m) : run(m.target, () => api.incidents.transition(i.id, { target_status: m.target }), `${i.number}: ${m.label.toLowerCase()}d`.replace('dd', 'd'))

  if (!moves.length && !assignable && !(staff && i.status !== 'CLOSED')) return null
  return (
    <div className={`actions ${compact ? 'actions-compact' : ''}`}>
      {mineToTake && <Button variant="primary" busy={busy === 'take'} icon={<Hand size={16} />}
        onClick={() => run('take', () => api.incidents.assign(i.id, user.id), `${i.number} is yours`)}>Take it</Button>}
      {moves.map(m => (
        <Button key={m.target + m.label} variant={m.primary && !mineToTake ? 'primary' : undefined} icon={m.icon} busy={busy === m.target} onClick={() => direct(m)}>{m.label}</Button>
      ))}
      {admin && assignable && <Button icon={<UserPlus size={16} />} onClick={() => setAssignOpen(true)}>{i.assigned_to ? 'Reassign' : 'Assign'}</Button>}
      {staff && i.status !== 'CLOSED' && <Button variant="quiet" icon={<Pencil size={15} />} onClick={onEdit} aria-label="Edit details">{compact ? '' : 'Edit'}</Button>}
      <TransitionDialog move={move} d={d} field={field} onClose={() => setMove(null)} />
      {admin && <AssignDialog open={assignOpen} d={d} onClose={() => setAssignOpen(false)} />}
    </div>
  )
}

function TransitionDialog({ move, d, field, onClose }: { move: Move | null; d: IncidentDetail; field?: FieldInfo | null; onClose: () => void }) {
  const i = d.incident
  const [text, setText] = useState(''); const [cause, setCause] = useState(''); const [code, setCode] = useState('')
  const [rating, setRating] = useState(5); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const needCode = move?.ask === 'resolve' && !!field?.handover?.required && !field.handover.verified_at
  const reset = () => { setText(''); setCause(''); setCode(''); setRating(5); setErr(null) }
  const close = () => { reset(); onClose() }
  if (!move) return <Dialog open={false} onClose={onClose}>{null}</Dialog>

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      if (move.ask === 'info' || move.ask === 'reopen' || move.ask === 'provide') {
        if (text.trim()) await api.incidents.addNote(i.id, move.ask === 'info' ? `Question: ${text.trim()}` : move.ask === 'reopen' ? `Still not fixed: ${text.trim()}` : text.trim(),
          move.ask === 'info' ? 'info_request' : 'reporter')
      }
      await api.incidents.transition(i.id, {
        target_status: move.target,
        ...(move.ask === 'resolve' ? { resolution_summary: text.trim(), root_cause: cause.trim() || undefined, handover_code: code.trim() || undefined } : {}),
        ...(move.ask === 'close' ? { feedback_rating: rating, feedback_comment: text.trim() || undefined } : {}),
      })
      if (move.ask === 'resolve' && !matchMedia('(prefers-reduced-motion: reduce)').matches) confetti({ particleCount: 70, spread: 70, origin: { y: .7 }, disableForReducedMotion: true })
      toast.success(move.ask === 'resolve' ? `${i.number} resolved` : move.ask === 'close' ? 'Thanks for the feedback' : `${i.number} updated`)
      refreshIncident(i.id); close()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'That didn’t work') }
    finally { setBusy(false) }
  }
  const valid = move.ask === 'resolve' ? text.trim().length > 3 && (!needCode || code.trim().length >= 4)
    : move.ask === 'info' || move.ask === 'reopen' ? text.trim().length > 2 : true

  const titles = { resolve: `Resolve ${i.number}`, close: 'How was the help?', info: 'Ask the reporter', reopen: 'What’s still wrong?', provide: 'Send the information' }
  return (
    <Dialog open onClose={close} title={titles[move.ask!]} size="md"
      description={move.ask === 'resolve' ? 'The reporter is told it’s fixed and asked to confirm.' : move.ask === 'info' ? 'They get a notification and your question appears on the report.' : undefined}
      footer={<><button className="btn" onClick={close}>Cancel</button><Button variant="primary" busy={busy} disabled={!valid} onClick={submit} icon={move.icon}>{move.label}</Button></>}>
      <div className="form">
        {move.ask === 'resolve' && <>
          {d.suggested_resolutions.length > 0 && (
            <div className="suggest">
              <span className="field-label"><Sparkles size={14} />Fixes that worked for similar reports</span>
              {d.suggested_resolutions.filter((s, k, all) => all.findIndex(x => x.summary === s.summary) === k).map(s => (
                <button key={s.id} type="button" className="suggest-item" onClick={() => { setText(s.summary); setCause(s.root_cause || '') }}>
                  <b>{s.summary}</b><small>{s.number} · {Math.round(s.score * 100)}% similar</small>
                </button>
              ))}
            </div>
          )}
          <Field label="What fixed it?"><TextArea autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="Replaced the faulty patch cable at the switch" rows={3} /></Field>
          <Field label="Root cause" optional><Input value={cause} onChange={e => setCause(e.target.value)} placeholder="Loose cable in rack 2" /></Field>
          {needCode && <Field label="Handover code" hint={`Ask the student for the 4-digit code on their report. ${plural(field!.handover!.attempts_left, 'attempt')} left.`}>
            <Input className="code-input" inputMode="numeric" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••" /></Field>}
        </>}
        {move.ask === 'close' && <>
          <div className="stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={rating === n} data-on={n <= rating || undefined} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}><Star size={30} /></button>)}
          </div>
          <Field label="Anything to add?" optional><TextArea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Quick and friendly, thanks!" /></Field>
        </>}
        {(move.ask === 'info' || move.ask === 'reopen' || move.ask === 'provide') &&
          <Field label={move.ask === 'info' ? 'Your question' : move.ask === 'reopen' ? 'Describe what’s still not working' : 'Your answer'} optional={move.ask === 'provide'}>
            <TextArea autoFocus value={text} onChange={e => setText(e.target.value)} rows={4} /></Field>}
        {err && <p className="form-error" role="alert"><XCircle size={15} />{err}</p>}
      </div>
    </Dialog>
  )
}

const BREAKDOWN: Record<string, string> = { skill: 'Skills', load: 'Free time', experience: 'Experience', service: 'Service', speed: 'Speed' }

export function AssignDialog({ open, d, onClose }: { open: boolean; d: IncidentDetail; onClose: () => void }) {
  const i = d.incident
  const { data: techs } = useTechnicians(open)
  const [busy, setBusy] = useState<string | null>(null)
  const [other, setOther] = useState('')
  const assign = async (tid: string | 'auto') => {
    setBusy(tid)
    try {
      const r = tid === 'auto' ? await api.incidents.autoAssign(i.id) : await api.incidents.assign(i.id, tid)
      toast.success(`Assigned to ${r.assigned_name}`); refreshIncident(i.id); onClose()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not assign') }
    finally { setBusy(null) }
  }
  const recs = d.recommendations
  return (
    <Dialog open={open} onClose={onClose} title={`Assign ${i.number}`} description="Ranked by skills, free capacity and experience with similar reports." size="md"
      footer={<Button icon={<Wand2 size={16} />} busy={busy === 'auto'} onClick={() => assign('auto')}>Use the assignment strategy</Button>}>
      <ul className="recs">
        {recs.map((r, k) => (
          <li key={r.technician_id}>
            <button type="button" className="rec" disabled={!!busy} onClick={() => assign(r.technician_id)} data-best={k === 0 || undefined} data-full={!r.has_capacity || undefined}>
              <Avatar name={r.name} size={34} />
              <span className="rec-main">
                <b>{r.name}{k === 0 && <em>Best match</em>}</b>
                <small>{r.skills.join(', ') || 'General'} · {r.open_count}/{r.max_concurrent} open{!r.has_capacity && ' · full'}</small>
                <span className="rec-bars">{Object.entries(r.breakdown).slice(0, 4).map(([k2, v]) =>
                  <span key={k2} title={`${BREAKDOWN[k2] || k2}: ${Math.round(Number(v) * 100)}%`}><i style={{ width: `${Math.min(100, Number(v) * 100)}%` }} />{BREAKDOWN[k2] || k2}</span>)}</span>
              </span>
              <span className="rec-score tabular" title="Match score out of 100">{Math.round(r.score * 100)}</span>
            </button>
          </li>
        ))}
      </ul>
      {techs && techs.length > recs.length && (
        <Field label="Someone else">
          <div className="inline"><Select value={other} onChange={e => setOther(e.target.value)}><option value="">Choose a technician…</option>
            {techs.filter(t => !recs.some(r => r.technician_id === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            <Button disabled={!other} busy={busy === other} onClick={() => assign(other)}>Assign</Button></div>
        </Field>
      )}
      {i.sla && <p className="muted small">SLA: respond within {minutes(i.sla.response_minutes)}, resolve within {minutes(i.sla.resolution_minutes)}.</p>}
    </Dialog>
  )
}
