// One incident, everything about it. Used full-page (/incidents/:id) and as the peek pane
// beside the list on the Incidents page.
//
//   header   number · priority · status · SLA ring, title, where/what/who, lifecycle rail, actions
//   main     description, resolution, photos & voice notes, activity (notes + history)
//   side     details, field visit / handover code, related and duplicate reports
import { Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, ArrowUpRight, Copy, Link2, Phone, QrCode, Star, Zap } from 'lucide-react'
import { api, ApiError, OPEN_STATUSES, type IncidentDetail, type IncidentUpdate, type User } from '../../api'
import { isStaff } from '../../lib/auth'
import { dateTime, minutes, PRIORITY_LABEL, timeAgo } from '../../lib/format'
import { Avatar, Button, Empty, Field, Input, Select, Skeleton, TextArea } from '../../ui/Controls'
import { PriorityBadge, SlaRing, StatusBadge, StatusIcon, PriorityMark, pVar, SlaBadge } from '../../ui/Badges'
import { Dialog } from '../../ui/Overlay'
import { useIncident, useBuildingList } from '../incidents/data'
import { LifecycleRail, trackerHeadline } from './Lifecycle'
import { ActionBar, refreshIncident } from './Actions'
import { Activity } from './Activity'
import { Attachments } from './Attachments'
import { FieldCard, useField } from './FieldCard'
import { useAuth } from '../../lib/auth'
import { useIsPhone } from '../../lib/media'
import { isHostel } from '../../lib/format'

export function IncidentView({ id, variant = 'page' }: { id: string; variant?: 'page' | 'peek' }) {
  const { user } = useAuth()
  const { data: d, error, loading } = useIncident(id)
  const { data: field } = useField(id, !!d)
  const [edit, setEdit] = useState(false)
  const phone = useIsPhone()
  if (error && !d) return <Empty icon={<AlertTriangle size={20} />} title={error instanceof ApiError && error.status === 404 ? 'This incident doesn’t exist' : error instanceof ApiError && error.status === 403 ? 'You can’t see this incident' : 'Couldn’t load this incident'}>
    {error instanceof ApiError ? error.message : ''}</Empty>
  if (loading || !d || !user) return <ViewSkeleton />
  const i = d.incident
  const staff = isStaff(user)
  const reporter = user.id === i.reporter_id && !staff
  const open = OPEN_STATUSES.includes(i.status)
  const peek = variant === 'peek'
  const headline = reporter ? trackerHeadline(i) : null
  const copy = () => { navigator.clipboard?.writeText(`${location.origin}/incidents/${i.id}`).then(() => toast.success('Link copied')) }

  return (
    <article className={`iv iv-${variant}`} style={{ ['--k' as string]: pVar(i.priority) }}>
      <header className="iv-head">
        <div className="iv-top">
          <button type="button" className="iv-num" onClick={copy} title="Copy a link to this incident"><b className="tabular">{i.number}</b><Copy size={12} /></button>
          <PriorityBadge p={i.priority} long={!peek} />
          <StatusBadge s={i.status} />
          {i.escalation?.level ? <span className="badge warn"><Zap size={12} />Escalated to {i.escalation.label}</span> : null}
          {peek && <Link to={`/incidents/${i.id}`} viewTransition className="btn sm iv-open"><ArrowUpRight size={14} />Open</Link>}
        </div>
        <div className="iv-title">
          <div>
            {headline && <p className="iv-headline"><b>{headline.title}</b> {headline.sub}</p>}
            <h1>{i.title}</h1>
            <p className="iv-meta">
              <span>{i.location.formatted}</span><span>{i.service_name}</span><span>{i.category}</span>
              <span>Reported {staff ? <>by <b>{i.reporter_name}</b> </> : ''}{timeAgo(i.created_at)}</span>
            </p>
          </div>
          {open && staff && <SlaRing sla={i.sla} open size={peek ? 58 : 72} />}
        </div>
        <LifecycleRail incident={i} audit={d.audit} forReporter={reporter} />
        <ActionBar d={d} user={user} field={field} onEdit={() => setEdit(true)} compact={peek} />
      </header>

      <div className="iv-body">
        <div className="iv-main">
          <section className="card iv-desc">
            <p className="prose">{i.description}</p>
            {(i.asset || i.phone) && <div className="iv-tags">
              {i.asset && <span className="badge"><QrCode size={12} />{i.asset.name} · {i.asset.code}</span>}
            </div>}
          </section>
          {i.resolution && (
            <section className="card iv-resolution">
              <h3>How it was fixed</h3>
              <p className="prose">{i.resolution.summary}</p>
              {i.resolution.root_cause && <p className="muted small">Cause: {i.resolution.root_cause}</p>}
              <p className="muted small">Resolved {dateTime(i.resolution.resolved_at)}{i.sla ? ` · ${i.sla.status === 'MET' ? 'within the SLA' : 'after the SLA deadline'}` : ''}</p>
              {i.closure && <p className="rating" aria-label={`Rated ${i.closure.feedback_rating} out of 5`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} size={15} data-on={n <= i.closure!.feedback_rating || undefined} />)}
                {i.closure.feedback_comment && <span>“{i.closure.feedback_comment}”</span>}</p>}
            </section>
          )}
          {(peek || phone) && <Side d={d} user={user} field={field} peek />}
          <Attachments incident={i} user={user} compact={peek} />
          <Activity incident={i} audit={d.audit} user={user} />
        </div>
        {!peek && !phone && <aside className="iv-side"><Side d={d} user={user} field={field} /></aside>}
      </div>
      {staff && <EditDialog open={edit} d={d} onClose={() => setEdit(false)} />}
    </article>
  )
}

function Side({ d, user, field, peek }: { d: IncidentDetail; user: User; field: ReturnType<typeof useField>['data']; peek?: boolean }) {
  const i = d.incident
  const staff = isStaff(user)
  const dupes = (i.possible_duplicates || []).filter(x => x.id !== i.id)
  return (
    <div className={`side ${peek ? 'side-peek' : ''}`}>
      <div className="card props">
        <dl>
          <dt>Priority</dt><dd><PriorityMark p={i.priority} />{i.priority} · {PRIORITY_LABEL[i.priority]}{staff && <small>impact {i.impact}/3, urgency {i.urgency}/3{i.affected_users > 1 ? `, ${i.affected_users} people` : ''}</small>}</dd>
          <dt>Status</dt><dd><StatusIcon s={i.status} />{i.status === 'CLASSIFIED' ? 'Waiting for a technician' : i.status.replace('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase())}</dd>
          <dt>Assignee</dt><dd>{i.assigned_name ? <><Avatar name={i.assigned_name} size={20} />{i.assigned_name}</> : <span className="muted">Nobody yet</span>}</dd>
          {i.sla && <><dt>SLA</dt><dd><SlaBadge sla={i.sla} open={OPEN_STATUSES.includes(i.status)} /><small>Respond {minutes(i.sla.response_minutes)} · resolve {minutes(i.sla.resolution_minutes)}<br />Due {dateTime(i.sla.resolution_due_at)}</small></dd></>}
          <dt>Service</dt><dd>{i.service_name}</dd>
          <dt>Category</dt><dd>{i.category}</dd>
          {staff && <><dt>Reporter</dt><dd><Avatar name={i.reporter_name} size={20} /><span>{i.reporter_name}<small>{[i.student_id && `ID ${i.student_id}`, i.reporter_email].filter(Boolean).join(' · ')}</small></span></dd></>}
          {staff && i.phone && <><dt>Phone</dt><dd><a className="link" href={`tel:${i.phone.replace(/\s/g, '')}`}><Phone size={13} />{i.phone}</a></dd></>}
          <dt>Created</dt><dd>{dateTime(i.created_at)}</dd>
        </dl>
      </div>
      {(i.location.type !== 'online' || (staff && field?.geo)) && <FieldCard incident={i} user={user} field={field} />}
      {staff && (d.related.length > 0 || dupes.length > 0) && (
        <div className="card">
          <header className="card-head"><h3><Link2 size={15} />Related reports</h3></header>
          <ul className="mini-list">
            {[...dupes.map(x => ({ ...x, reason: `possible duplicate (${Math.round((x.score || 0) * 100)}% match)` })), ...d.related.filter(r => !dupes.some(x => x.id === r.id))].slice(0, 6).map(r => (
              <li key={r.id}><Link to={`/incidents/${r.id}`} viewTransition style={{ ['--k' as string]: pVar(r.priority) }}>
                <StatusIcon s={r.status} /><span><b>{r.number} · {r.title}</b><small>{r.reason}</small></span></Link></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EditDialog({ open, d, onClose }: { open: boolean; d: IncidentDetail; onClose: () => void }) {
  const i = d.incident
  const { data: b } = useBuildingList()
  const [f, setF] = useState<IncidentUpdate>({})
  const [busy, setBusy] = useState(false)
  const v = <K extends keyof IncidentUpdate>(k: K) => (f[k] ?? (k === 'location_type' ? i.location.type : k === 'academic_block' ? i.location.academic_block : k === 'hostel_name' ? i.location.hostel_name : k === 'room_number' ? i.location.room_number : (i as unknown as Record<string, unknown>)[k])) as IncidentUpdate[K]
  const set = (p: IncidentUpdate) => setF(x => ({ ...x, ...p }))
  const save = async () => {
    setBusy(true)
    try {
      const r = await api.incidents.update(i.id, f)
      toast.success(r.priority !== i.priority ? `Saved. Priority is now ${r.priority}.` : 'Saved'); refreshIncident(i.id); setF({}); onClose()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  const names = (b?.buildings || []).map(x => x.name)
  const lt = v('location_type')
  return (
    <Dialog open={open} onClose={() => { setF({}); onClose() }} title={`Edit ${i.number}`} description="Changing impact or urgency recalculates the priority and the SLA." size="lg"
      footer={<><button className="btn" onClick={() => { setF({}); onClose() }}>Cancel</button><Button variant="primary" busy={busy} disabled={!Object.keys(f).length} onClick={save}>Save changes</Button></>}>
      <div className="form">
        <Field label="Title"><Input value={v('title') || ''} onChange={e => set({ title: e.target.value })} /></Field>
        <Field label="Description"><TextArea rows={4} value={v('description') || ''} onChange={e => set({ description: e.target.value })} /></Field>
        <div className="grid-3">
          <Field label="Impact"><Select value={v('impact')} onChange={e => set({ impact: +e.target.value })}><option value={1}>1 · One person</option><option value={2}>2 · A group or lab</option><option value={3}>3 · Many people</option></Select></Field>
          <Field label="Urgency"><Select value={v('urgency')} onChange={e => set({ urgency: +e.target.value })}><option value={1}>1 · Can wait</option><option value={2}>2 · Today</option><option value={3}>3 · Right now</option></Select></Field>
          <Field label="People affected"><Input type="number" min={1} value={v('affected_users') || 1} onChange={e => set({ affected_users: Math.max(1, +e.target.value || 1) })} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Where"><Select value={lt} onChange={e => set({ location_type: e.target.value as 'online' })}><option value="academics">Academic area</option><option value="hostel">Hostel</option><option value="online">Online</option></Select></Field>
          {lt === 'hostel' ? <Field label="Hostel"><Select value={v('hostel_name') || ''} onChange={e => set({ hostel_name: e.target.value })}><option value="">Choose…</option>{names.filter(isHostel).map(n => <option key={n}>{n}</option>)}</Select></Field>
            : lt === 'academics' ? <Field label="Building"><Select value={v('academic_block') || ''} onChange={e => set({ academic_block: e.target.value })}><option value="">Choose…</option>{names.filter(n => !isHostel(n)).map(n => <option key={n}>{n}</option>)}</Select></Field> : <span />}
          {lt !== 'online' && <Field label="Room"><Input value={v('room_number') || ''} onChange={e => set({ room_number: e.target.value })} /></Field>}
        </div>
      </div>
    </Dialog>
  )
}

function ViewSkeleton() {
  return (
    <div className="iv iv-wait" aria-busy="true">
      <Skeleton h={22} w={220} /><Skeleton h={40} w="70%" /><Skeleton h={16} w="50%" /><Skeleton h={54} r={16} /><Skeleton h={160} r={20} />
    </div>
  )
}

export function IncidentViewSuspense(props: { id: string; variant?: 'page' | 'peek' }) {
  return <Suspense fallback={<ViewSkeleton />}><IncidentView {...props} /></Suspense>
}
