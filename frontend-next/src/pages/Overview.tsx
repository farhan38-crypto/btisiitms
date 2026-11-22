// Overview for staff. It answers the first questions in order: how bad is it right now,
// what needs a person first, is something bigger going on, where on campus, and is the team
// coping. Every number and row opens the list or incident behind it.
import { type CSSProperties, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowUpRight, Expand, Radio } from 'lucide-react'
import { api, useQuery, OPEN_STATUSES, type Incident, type Overview } from '../api'
import { useAuth } from '../lib/auth'
import { minutes } from '../lib/format'
import { pointAt } from '../lib/store'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { Panel } from '../components/Panel'
import { CampusMap, useCampusData } from '../components/map/CampusMap'
import { ChartPanel } from '../components/charts/Charts'
import { IncidentRow } from '../features/incidents/Rows'
import { useIncidentList, sortIncidents, useServices } from '../features/incidents/data'
import { Empty, Skeleton } from '../ui/Controls'

// The clicked card takes the shared name, so the browser morphs it into the next page's header.
const claimMorph = (e: MouseEvent<HTMLElement>) => { e.currentTarget.style.viewTransitionName = 'focus-card' }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

/** What needs a person first: breached or at-risk SLA, escalated, or urgent and unassigned. */
function needsAttention(list: Incident[]) {
  return sortIncidents(list.filter(i => OPEN_STATUSES.includes(i.status) && (
    i.sla?.status === 'BREACHED' || i.sla?.status === 'AT_RISK' || (i.escalation?.level || 0) > 0 ||
    ((i.priority === 'P1' || i.priority === 'P2') && !i.assigned_to))), 'smart')
}

export default function OverviewPage() {
  const { user, theme } = useAuth()
  const { data: ov } = useQuery<Overview>('overview', () => api.reports.overview())
  const { data: list } = useIncidentList({})
  const { data: svcs } = useServices()
  const { data, buildings, moveBuilding } = useCampusData()
  const t = ov?.totals
  const attention = list ? needsAttention(list) : null
  const mine = user?.role === 'technician' && list ? list.filter(i => i.assigned_to === user.id && OPEN_STATUSES.includes(i.status)).length : null
  const metrics = [
    { label: 'Open reports', value: t?.open, colour: theme.a, to: '/incidents?view=open', go: 'See every open report' },
    { label: 'Urgent (P1) open', value: t?.p1_open, colour: theme.status.P1, to: '/incidents?view=urgent', go: 'See the urgent reports' },
    { label: 'SLA met', value: ov?.sla.compliance_rate, suffix: '%', colour: theme.b, to: '/incidents?view=sla', go: 'See the reports at risk or late' },
    { label: 'Resolved today', value: t?.resolved_today, colour: theme.c || theme.b, to: '/incidents?view=today', go: 'See what was resolved today' },
  ]
  const serviceId = (name: string) => svcs?.find(s => s.name === name)?.id
  return (
    <main className="page">
      <header className="hero">
        <motion.p className="eyebrow-line" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{greeting()}, {user?.name.split(' ')[0]}{mine ? ` · ${mine} assigned to you` : ''}</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, ease: [0.22, 1, 0.36, 1] }}>
          {t ? <>{t.open} open {t.open === 1 ? 'report' : 'reports'} on campus{t.p1_open ? <>, <Link to="/incidents?view=urgent" viewTransition className="urgent" onClick={claimMorph}>{t.p1_open} urgent</Link></> : null}.</> : 'Loading the campus…'}
        </motion.h1>
      </header>

      <div className="metrics">
        {metrics.map((m, i) => (
          // The animation lives on a plain wrapper: React Router's Link hands motion a new ref on
          // every render, which made motion replay the entrance (cards blinking on hover / live updates).
          <motion.div key={m.label} className="metric-wrap"
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06, duration: .6, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }} whileTap={{ scale: .97 }}>
            <Link to={m.to} viewTransition className="metric glass glass-hover" data-tilt style={{ '--k': m.colour } as CSSProperties}
              aria-label={`${m.label}: ${m.value ?? '…'}${m.suffix || ''}. ${m.go}`} title={m.go} onClick={claimMorph}
              onPointerEnter={() => pointAt(null, m.colour)} onPointerLeave={() => pointAt(null, null)}>
              <span className="metric-label">{m.label}</span>
              <strong className="metric-value"><AnimatedNumber value={m.value} suffix={m.suffix} /></strong>
              <ArrowUpRight size={18} className="metric-go" aria-hidden />
              <i className="metric-glow" />
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="ov-grid">
        <Panel title="Needs attention" hint="Late or about to be, escalated, or urgent with nobody on it. Most pressing first."
          action={<Link to="/incidents?view=sla" viewTransition className="btn sm">All at risk</Link>} className="attention">
          {!attention ? <div className="ilist">{[0, 1, 2].map(k => <Skeleton key={k} h={58} r={14} />)}</div>
            : !attention.length ? <Empty title="Nothing is slipping">Every open report is on track and has someone on it.</Empty>
            : <div className="ilist">{attention.slice(0, 6).map(i => <IncidentRow key={i.id} i={i} />)}
                {attention.length > 6 && <Link to="/incidents?view=sla" className="more-link">{attention.length - 6} more</Link>}</div>}
        </Panel>
        <div className="ov-col">
          {ov && ov.correlations.length > 0 && (
            <Panel title="Possible major incident" className="correlations">
              {ov.correlations.slice(0, 2).map(c => (
                <div key={c.service_id} className="corr">
                  <Radio size={16} className="corr-icon" />
                  <div><b>{c.count} reports on {c.service_name}</b><p>{c.suggestion}</p>
                    <div className="corr-list">{c.incidents.slice(0, 4).map(r => <Link key={r.id} to={`/incidents/${r.id}`} className="badge">{r.number}</Link>)}</div></div>
                </div>
              ))}
            </Panel>
          )}
          {ov && <Panel title="Team workload" hint="Open reports each technician holds, against their limit." className="workload">
            <ul className="wl">
              {ov.technician_workload.filter(w => w.is_active).sort((a, b) => b.open / (b.max_concurrent || 1) - a.open / (a.max_concurrent || 1)).map(w => {
                const share = Math.min(1, w.open / Math.max(1, w.max_concurrent))
                const tone = share >= 1 ? 'var(--p1)' : share >= .7 ? 'var(--p2)' : 'var(--a)'
                return (
                  <li key={w.id}>
                    <Link to={`/incidents?view=open&assignee=${w.id}`} viewTransition className="wl-row" style={{ '--k': tone } as CSSProperties}>
                      <span className="wl-name"><b>{w.name}</b><small>{w.skills.slice(0, 3).join(', ') || 'General'}</small></span>
                      <span className="wl-bar" role="img" aria-label={`${w.open} of ${w.max_concurrent} open`}><i style={{ width: `${share * 100}%` }} /></span>
                      <span className="wl-num tabular"><b>{w.open}</b>/{w.max_concurrent}<small>{w.resolved} fixed</small></span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Panel>}
        </div>
      </div>

      <Panel title="Campus, live" hint="Every open report from the last 30 days, at its building. Tap a pin for directions."
        action={<Link to="/map" viewTransition className="btn sm"><Expand size={15} />Full map</Link>} className="map-panel">
        <CampusMap data={data} buildings={buildings} className="map-embed" onMoveBuilding={moveBuilding} />
      </Panel>

      <div className="widgets">
        <Panel title="Reports over time" delay={0.05} className="graph-panel">
          <ChartPanel theme={theme} mapData={data} />
        </Panel>
        {ov && <Panel title="SLA by service" hint={`${ov.sla.met} fixed in time, ${ov.sla.breached} late${ov.totals.avg_resolution_minutes ? `. Average fix: ${minutes(ov.totals.avg_resolution_minutes)}` : ''}.`} delay={0.1}>
          <ul className="wl">
            {ov.by_service.filter(r => r.total > 0).slice(0, 8).map(r => {
              const late = r.total ? r.breached / r.total : 0
              const id = serviceId(r.name)
              return (
                <li key={r.name}>
                  <Link to={id ? `/incidents?view=all&service=${id}` : '/incidents?view=all'} viewTransition className="wl-row" style={{ '--k': late > .3 ? 'var(--p1)' : late > .1 ? 'var(--p2)' : 'var(--b)' } as CSSProperties}>
                    <span className="wl-name"><b>{r.name}</b><small>{r.open} open of {r.total}</small></span>
                    <span className="wl-bar" role="img" aria-label={`${Math.round((1 - late) * 100)}% on time`}><i style={{ width: `${(1 - late) * 100}%` }} /></span>
                    <span className="wl-num tabular"><b>{Math.round((1 - late) * 100)}%</b><small>{r.breached} late</small></span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Panel>}
      </div>
    </main>
  )
}
