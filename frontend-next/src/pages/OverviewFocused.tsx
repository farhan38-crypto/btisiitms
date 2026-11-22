// Overview for staff. Read top to bottom it answers: how bad is it (one strip of numbers),
// where and how is it trending (small map and chart side by side), what needs a person
// first (a dense list that fits on screen), then the team, services and recent history.
// The map and lists scroll inside their own frames; the page scroll stays the page's.
import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Expand, Radio } from 'lucide-react'
import { api, useQuery, useRecentLive, OPEN_STATUSES, type Incident, type Overview } from '../api'
import { useAuth } from '../lib/auth'
import { eventLabel, minutes, timeAgo } from '../lib/format'
import { CampusMap, useCampusData } from '../components/map/CampusMap'
import { ChartPanel } from '../components/charts/Charts'
import { useIncidentList, sortIncidents, useServices } from '../features/incidents/data'
import { Avatar, Empty, Skeleton } from '../ui/Controls'
import { PriorityMark, SlaBadge, StatusIcon, pVar } from '../ui/Badges'
import { ScrollArea } from '../ui/ScrollArea'

const needsAttention = (list: Incident[]) => sortIncidents(list.filter(i => OPEN_STATUSES.includes(i.status) && (
  i.sla?.status === 'BREACHED' || i.sla?.status === 'AT_RISK' || (i.escalation?.level || 0) > 0 ||
  ((i.priority === 'P1' || i.priority === 'P2') && !i.assigned_to))), 'smart')
const place = (i: Incident) => i.location.hostel_name || i.location.academic_block || (i.location.type === 'online' ? 'Online' : '')

/** One dense line per incident: everything needed to decide, nothing decorative. */
function Line({ i }: { i: Incident }) {
  return (
    <Link to={`/incidents/${i.id}`} viewTransition className="line" style={{ ['--k' as string]: pVar(i.priority) }}>
      <PriorityMark p={i.priority} />
      <em className="tabular">{i.number}</em>
      <b>{i.title}</b>
      <span className="line-place">{place(i)}</span>
      <span className="line-who">{i.assigned_name ? <><Avatar name={i.assigned_name} size={18} />{i.assigned_name.split(' ')[0]}</> : <span className="muted">Unassigned</span>}</span>
      <SlaBadge sla={i.sla} compact />
    </Link>
  )
}

export default function OverviewPage() {
  const { user, theme } = useAuth()
  const { data: ov } = useQuery<Overview>('overview', () => api.reports.overview())
  const { data: list } = useIncidentList({})
  const { data: svcs } = useServices()
  const { data, buildings } = useCampusData()
  const recent = useRecentLive()
  const t = ov?.totals
  const attention = useMemo(() => (list ? needsAttention(list) : null), [list])
  const mine = useMemo(() => (user && list ? sortIncidents(list.filter(i => i.assigned_to === user.id && OPEN_STATUSES.includes(i.status)), 'smart') : []), [list, user])
  const unassigned = useMemo(() => (list ? sortIncidents(list.filter(i => !i.assigned_to && OPEN_STATUSES.includes(i.status)), 'smart') : []), [list])
  const resolved = useMemo(() => (list || []).filter(i => i.resolution?.resolved_at).sort((a, b) => b.resolution!.resolved_at.localeCompare(a.resolution!.resolved_at)).slice(0, 6), [list])
  const serviceId = (name: string) => svcs?.find(s => s.name === name)?.id
  const tech = user?.role === 'technician'

  const stats = [
    { label: 'Open', value: t?.open, to: '/incidents?view=open' },
    { label: 'Urgent (P1)', value: t?.p1_open, to: '/incidents?view=urgent', tone: 'var(--p1)' },
    { label: 'At risk', value: t?.at_risk, to: '/incidents?view=sla', tone: 'var(--p2)' },
    { label: 'Escalated', value: t?.escalated_open, to: '/incidents?view=escalated' },
    { label: 'Unassigned', value: unassigned.length, to: '/incidents?view=unassigned' },
    { label: 'SLA met', value: ov ? `${ov.sla.compliance_rate}%` : undefined, to: '/incidents?view=done' },
    { label: 'Resolved today', value: t?.resolved_today, to: '/incidents?view=today' },
    { label: 'Average fix', value: t?.avg_resolution_minutes != null ? minutes(t.avg_resolution_minutes) : undefined, to: '/incidents?view=done' },
  ]

  return (
    <main className="page page-wide overview">
      <header className="ovf-head">
        <h1>Overview</h1>
        <p>{t ? `${t.open} open on campus${tech ? `, ${mine.length} assigned to you` : ''}.` : 'Loading…'}</p>
      </header>

      <nav className="stats surface" aria-label="Key numbers">
        {stats.map(s => (
          <Link key={s.label} to={s.to} viewTransition className="stat" style={s.tone ? { ['--k' as string]: s.tone } : undefined}>
            <small>{s.label}</small><b className="tabular" data-tone={s.tone && Number(s.value) > 0 ? '' : undefined}>{s.value ?? '–'}</b>
          </Link>
        ))}
      </nav>

      <div className="ov-top">
        <section className="frame surface">
          <header className="frame-head"><h2>Campus</h2><span className="muted small ov-map-hint">Ctrl/⌘ + scroll to zoom</span>
            <Link to="/map" viewTransition className="btn sm btn-quiet"><Expand size={14} />Full map</Link></header>
          <CampusMap data={data} buildings={buildings} embedded className="map-compact" />
        </section>
        <section className="frame surface ov-chart">
          <ChartPanel theme={theme} mapData={data} compact />
        </section>
      </div>

      <div className="ov-mid">
        <section className="frame surface">
          <header className="frame-head"><h2>Needs attention</h2>{attention && <span className="count tabular">{attention.length}</span>}
            <Link to="/incidents?view=sla" viewTransition className="btn sm btn-quiet">Open the list</Link></header>
          {!attention ? <div className="lines">{[0, 1, 2, 3].map(k => <Skeleton key={k} h={36} />)}</div>
            : !attention.length ? <Empty title="Nothing is slipping">Every open report is on track and has someone on it.</Empty>
            : <ScrollArea className="lines lines-scroll">{attention.map(i => <Line key={i.id} i={i} />)}</ScrollArea>}
        </section>
        <section className="frame surface">
          {tech ? <>
            <header className="frame-head"><h2>Your queue</h2><span className="count tabular">{mine.length}</span>
              <Link to="/incidents?view=mine" viewTransition className="btn sm btn-quiet">Open</Link></header>
            {!mine.length ? <Empty title="Your queue is empty">Take one from Unassigned.</Empty>
              : <ScrollArea className="lines lines-scroll">{mine.map(i => <Line key={i.id} i={i} />)}</ScrollArea>}
          </> : <>
            <header className="frame-head"><h2>Waiting for a technician</h2><span className="count tabular">{unassigned.length}</span>
              <Link to="/incidents?view=unassigned" viewTransition className="btn sm btn-quiet">Assign</Link></header>
            {!unassigned.length ? <Empty title="Everything has an owner" />
              : <ScrollArea className="lines lines-scroll">{unassigned.map(i => <Line key={i.id} i={i} />)}</ScrollArea>}
          </>}
        </section>
      </div>

      {ov && (ov.correlations.length > 0 || (data?.outages.length || 0) > 0) && (
        <section className="frame surface">
          <header className="frame-head"><h2>Possible bigger problems</h2><span className="muted small">Several reports in a short time</span></header>
          <div className="corr-grid">
            {ov.correlations.map(c => (
              <div key={c.service_id} className="corr"><Radio size={15} className="corr-icon" />
                <div><b>{c.count} reports on {c.service_name}</b><p>within {minutes(c.window_minutes)}. Check the service before fixing reports one by one.</p>
                  <div className="corr-list">{c.incidents.slice(0, 5).map(r => <Link key={r.id} to={`/incidents/${r.id}`} className="badge">{r.number}</Link>)}</div></div></div>
            ))}
            {data?.outages.map(o => (
              <div key={o.building} className="corr"><Radio size={15} className="corr-icon" />
                <div><b>{o.count} reports from {o.building}</b><p>within {minutes(o.window_minutes)}. Check for a building-wide outage.</p>
                  <div className="corr-list">{o.incidents.slice(0, 5).map(r => <Link key={r.id} to={`/incidents/${r.id}`} className="badge">{r.number}</Link>)}</div></div></div>
            ))}
          </div>
        </section>
      )}

      {ov && <div className="ov-grid3">
        <section className="frame surface">
          <header className="frame-head"><h2>Team workload</h2></header>
          <ul className="wl">
            {ov.technician_workload.filter(w => w.is_active).sort((a, b) => b.open / (b.max_concurrent || 1) - a.open / (a.max_concurrent || 1)).map(w => {
              const share = Math.min(1, w.open / Math.max(1, w.max_concurrent))
              return (
                <li key={w.id}>
                  <Link to={`/incidents?view=open&assignee=${w.id}`} viewTransition className="wl-row" style={{ '--k': share >= 1 ? 'var(--p1)' : share >= .7 ? 'var(--p2)' : 'var(--a)' } as CSSProperties}>
                    <span className="wl-name"><b>{w.name}</b><small>{w.resolved} fixed</small></span>
                    <span className="wl-bar" role="img" aria-label={`${w.open} of ${w.max_concurrent} open`}><i style={{ width: `${share * 100}%` }} /></span>
                    <span className="wl-num tabular"><b>{w.open}</b>/{w.max_concurrent}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="frame surface">
          <header className="frame-head"><h2>SLA by service</h2></header>
          <ul className="wl">
            {ov.by_service.filter(r => r.total > 0).slice(0, 7).map(r => {
              const ok = r.total ? 1 - r.breached / r.total : 1
              const id = serviceId(r.name)
              return (
                <li key={r.name}>
                  <Link to={id ? `/incidents?view=all&service=${id}` : '/incidents?view=all'} viewTransition className="wl-row" style={{ '--k': ok < .7 ? 'var(--p1)' : ok < .9 ? 'var(--p2)' : 'var(--ok)' } as CSSProperties}>
                    <span className="wl-name"><b>{r.name}</b><small>{r.open} open of {r.total}</small></span>
                    <span className="wl-bar"><i style={{ width: `${ok * 100}%` }} /></span>
                    <span className="wl-num tabular"><b>{Math.round(ok * 100)}%</b></span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="frame surface">
          <header className="frame-head"><h2>Missed deadlines</h2><Link to={user?.role === 'admin' ? '/admin/audit' : '/incidents?view=sla'} className="btn sm btn-quiet">All</Link></header>
          {!ov.recent_violations.length ? <Empty title="No missed deadlines" /> : (
            <ul className="mini-list">{ov.recent_violations.slice(0, 6).map(v => (
              <li key={v.id}><Link to={`/incidents/${v.incident_id}`}><PriorityMark p={v.priority} />
                <span><b>{v.incident_number} · {v.title}</b><small>{v.kind === 'response' ? 'Response' : 'Resolution'} missed {timeAgo(v.detected_at)}{v.assigned_name ? ` · ${v.assigned_name}` : ''}</small></span></Link></li>))}</ul>
          )}
        </section>
        <section className="frame surface">
          <header className="frame-head"><h2>Recently resolved</h2><Link to="/incidents?view=done" className="btn sm btn-quiet">All</Link></header>
          <ul className="mini-list">{resolved.map(i => (
            <li key={i.id}><Link to={`/incidents/${i.id}`}><StatusIcon s={i.status} />
              <span><b>{i.number} · {i.title}</b><small>{i.assigned_name || 'Resolved'} · {timeAgo(i.resolution!.resolved_at)}{i.sla?.status === 'MET' ? ' · on time' : i.sla?.status === 'BREACHED' ? ' · late' : ''}</small></span></Link></li>))}</ul>
        </section>
        <section className="frame surface">
          <header className="frame-head"><h2>Happening now</h2><span className="muted small">Live</span></header>
          {!recent.length ? <p className="muted small">Changes appear here as they happen.</p> : (
            <ul className="mini-list">{recent.slice(0, 7).map((e, k) => (
              <li key={k}><Link to={`/incidents/${e.incident_id}`}><PriorityMark p={e.priority} />
                <span><b>{eventLabel(e.type)} · {e.number}</b><small>{e.actor_name ? `${e.actor_name} · ` : ''}{timeAgo(e.timestamp)}</small></span></Link></li>))}</ul>
          )}
        </section>
        <section className="frame surface">
          <header className="frame-head"><h2>Shortcuts</h2></header>
          <div className="ovf-shortcuts">
            <Link to="/incidents/new" className="btn sm">Report a problem</Link>
            <Link to="/incidents?view=escalated" className="btn sm">Escalated</Link>
            <Link to="/incidents?layout=board" className="btn sm">Board view</Link>
            {user?.role === 'admin' && <><Link to="/admin/users" className="btn sm">Add a technician</Link><Link to="/admin/settings" className="btn sm">Assignment rules</Link><Link to="/admin/assets" className="btn sm">Print QR stickers</Link></>}
            <Link to="/docs" className="btn sm">How it works</Link>
          </div>
        </section>
      </div>}
    </main>
  )
}
