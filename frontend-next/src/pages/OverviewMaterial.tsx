// Overview in the Material layout. Four summary numbers with their change, then the trend
// and the deadline gauge, then what needs a person (a table), then the team, the campus and
// recent fixes. One level of cards, nothing nested, every number links to its list.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Expand, Inbox, ListChecks, Radio, Timer } from 'lucide-react'
import { api, useQuery, OPEN_STATUSES, type Incident, type Overview, type Trends } from '../api'
import { useAuth } from '../lib/auth'
import { dateShort, minutes, timeAgo } from '../lib/format'
import { CampusMap, useCampusData } from '../components/map/CampusMap'
import { BarChart, Gauge } from '../components/charts/MCharts'
import { useIncidentList, sortIncidents } from '../features/incidents/data'
import { Avatar, Empty, Skeleton } from '../ui/Controls'
import { PriorityMark, SlaBadge, StatusIcon, pVar } from '../ui/Badges'
import { ScrollArea } from '../ui/ScrollArea'
import { AnimatedNumber } from '../components/AnimatedNumber'

const RANGES = [7, 14, 30] as const
const needsAttention = (list: Incident[]) => sortIncidents(list.filter(i => OPEN_STATUSES.includes(i.status) && (
  i.sla?.status === 'BREACHED' || i.sla?.status === 'AT_RISK' || (i.escalation?.level || 0) > 0 ||
  ((i.priority === 'P1' || i.priority === 'P2') && !i.assigned_to))), 'smart')
const place = (i: Incident) => i.location.hostel_name || i.location.academic_block || (i.location.type === 'online' ? 'Online' : '–')
const weekday = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/** Change from the previous period. For reports, fewer is better, so a fall is shown as good. */
function Delta({ now, before, lowerIsBetter = true, suffix = 'vs previous' }: { now: number; before: number; lowerIsBetter?: boolean; suffix?: string }) {
  if (!before) return <span className="m-delta" data-tone="flat"><span>{now ? `${now} this period, none before` : 'None in either period'}</span></span>
  const pct = before ? Math.round(((now - before) / before) * 100) : 100
  const up = now > before
  const good = pct === 0 ? null : up !== lowerIsBetter
  return (
    <span className="m-delta" data-tone={good === null ? 'flat' : good ? 'good' : 'bad'}>
      <b className="tabular">{pct === 0 ? null : up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{pct === 0 ? 'Same' : `${Math.abs(pct)}%`}</b><span>{suffix}</span>
    </span>
  )
}

function Kpi({ icon, label, value, to, children, tone }: { icon: ReactNode; label: string; value: ReactNode; to: string; children?: ReactNode; tone?: string }) {
  return (
    <Link to={to} viewTransition className="m-card m-kpi" data-tilt style={tone ? { '--k': tone } as CSSProperties : undefined}>
      <span className="m-kpi-icon">{icon}</span>
      <span className="m-kpi-label">{label}</span>
      <b className="m-kpi-value tabular">{value == null ? <Skeleton h={30} w={70} /> : typeof value === 'number' ? <AnimatedNumber value={value} /> : value}</b>
      <span className="m-kpi-foot">{children}</span>
    </Link>
  )
}

function Card({ title, sub, action, children, className }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`m-card ${className || ''}`}>
      <header className="m-card-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{action}</header>
      {children}
    </section>
  )
}

export default function OverviewMaterial() {
  const { user } = useAuth()
  const [days, setDays] = useState<(typeof RANGES)[number]>(14)
  const [series, setSeries] = useState<'created' | 'resolved'>('created')
  const { data: ov } = useQuery<Overview>('overview', () => api.reports.overview())
  const { data: tr } = useQuery<Trends>(`trends:${days * 2}`, () => api.reports.trends(days * 2))
  const { data: list } = useIncidentList({})
  const { data: map, buildings } = useCampusData()
  const t = ov?.totals
  const tech = user?.role === 'technician'

  const attention = useMemo(() => (list ? needsAttention(list) : null), [list])
  const mine = useMemo(() => (user && list ? list.filter(i => i.assigned_to === user.id && OPEN_STATUSES.includes(i.status)) : []), [list, user])
  const resolved = useMemo(() => (list || []).filter(i => i.resolution?.resolved_at).sort((a, b) => b.resolution!.resolved_at.localeCompare(a.resolution!.resolved_at)).slice(0, 4), [list])

  // this period and the one before it, from one request twice as long
  const period = useMemo(() => {
    const rows = tr?.daily || []
    const cur = rows.slice(-days), prev = rows.slice(0, Math.max(0, rows.length - days))
    const sum = (r: typeof rows, k: 'created' | 'resolved') => r.reduce((a, d) => a + d[k], 0)
    return { cur, created: sum(cur, 'created'), createdBefore: sum(prev, 'created'), resolved: sum(cur, 'resolved'), resolvedBefore: sum(prev, 'resolved') }
  }, [tr, days])
  const bars = period.cur.map(d => ({ key: d.date, label: dateShort(d.date + 'T12:00:00'), long: weekday(d.date), value: d[series] }))
  const sla = ov?.sla
  const slaTotal = sla ? sla.met + sla.breached : 0

  return (
    <main className="page m-page">
      <header className="m-head">
        <div>
          <h1>Overview</h1>
          <p>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}{t ? ` · ${t.open} open on campus${tech ? `, ${mine.length} with you` : ''}` : ''}</p>
        </div>
        <div className="m-range" role="group" aria-label="Period">
          {RANGES.map(r => <button key={r} type="button" data-on={days === r || undefined} aria-pressed={days === r} onClick={() => setDays(r)}>{r} days</button>)}
        </div>
      </header>

      <div className="m-kpis">
        <Kpi icon={<ListChecks size={20} />} label="Open reports" value={t?.open} to="/incidents?view=open" tone="var(--a)">
          {tr ? <Delta now={period.created} before={period.createdBefore} suffix={`new vs previous ${days} days`} /> : null}
        </Kpi>
        {tech
          ? <Kpi icon={<Inbox size={20} />} label="With you" value={mine.length} to="/incidents?view=mine" tone="var(--p2)">
              <span className="m-sub">{mine.filter(i => i.sla?.status === 'AT_RISK' || i.sla?.status === 'BREACHED').length} due soon or late</span></Kpi>
          : <Kpi icon={<AlarmClock size={20} />} label="Late or due soon" value={t ? t.breached + t.at_risk : undefined} to="/incidents?view=sla" tone="var(--p1)">
              {t && <span className="m-sub">{t.breached} late · {t.at_risk} at risk</span>}</Kpi>}
        <Kpi icon={<CheckCircle2 size={20} />} label="Fixed in the period" value={tr ? period.resolved : undefined} to="/incidents?view=done" tone="var(--ok)">
          {tr ? <Delta now={period.resolved} before={period.resolvedBefore} lowerIsBetter={false} suffix={`vs previous ${days} days`} /> : null}
        </Kpi>
        <Kpi icon={<Timer size={20} />} label="Average time to fix" value={t ? minutes(t.avg_resolution_minutes) : undefined} to="/incidents?view=done" tone="var(--b)">
          {t && <span className="m-sub">{t.resolved_today} fixed today</span>}
        </Kpi>
      </div>

      <div className="m-row m-row-chart">
        <Card title={series === 'created' ? 'Reports received' : 'Reports fixed'}
          sub={tr ? <><b className="m-big tabular">{series === 'created' ? period.created : period.resolved}</b> in the last {days} days</> : 'Loading…'}
          action={<div className="m-toggle" role="group" aria-label="Series">
            <button type="button" data-on={series === 'created' || undefined} onClick={() => setSeries('created')}>Received</button>
            <button type="button" data-on={series === 'resolved' || undefined} onClick={() => setSeries('resolved')}>Fixed</button></div>}>
          {tr ? <BarChart data={bars} unit={series === 'created' ? ['report', 'reports'] : ['fix', 'fixes']} height={236} /> : <Skeleton h={236} />}
        </Card>
        <Card title="Deadlines" sub="Closed reports fixed in time">
          {sla ? <>
            <div className="m-gauge-wrap"><Gauge value={sla.compliance_rate} label={`${sla.met} of ${slaTotal || 0} on time`} /></div>
            <ul className="m-legend">
              {([['On time', sla.met, 'var(--ok)', '/incidents?view=done'], ['Late', sla.breached, 'var(--p1)', '/incidents?view=sla'],
                ['At risk now', sla.at_risk, 'var(--p2)', '/incidents?view=sla'], ['On track now', sla.on_track, 'var(--a)', '/incidents?view=open']] as const).map(([l, n, c, to]) => (
                <li key={l}><Link to={to}><i style={{ background: c }} />{l}<b className="tabular">{n}</b></Link></li>))}
            </ul>
          </> : <Skeleton h={220} />}
        </Card>
      </div>

      <div className="m-row m-row-table">
        <Card title="Needs attention" sub="Late, at risk, escalated, or urgent with nobody on it"
          action={<Link to="/incidents?view=sla" viewTransition className="m-link">View all<ArrowRight size={15} /></Link>}>
          {!attention ? <Skeleton h={240} /> : !attention.length
            ? <Empty title="Nothing is slipping">Every open report is on track and has someone on it.</Empty>
            : (
              <ScrollArea className="m-table-wrap">
                <table className="m-table">
                  <thead><tr><th>Incident</th><th>Place</th><th>Assigned</th><th className="r">Due</th></tr></thead>
                  <tbody>{attention.map(i => (
                    <tr key={i.id} style={{ '--k': pVar(i.priority) } as CSSProperties}>
                      <td><Link to={`/incidents/${i.id}`} viewTransition className="m-inc"><PriorityMark p={i.priority} /><span><b>{i.title}</b><small className="tabular">{i.number} · {i.priority}</small></span></Link></td>
                      <td className="muted">{place(i)}</td>
                      <td>{i.assigned_name ? <span className="m-who"><Avatar name={i.assigned_name} size={22} />{i.assigned_name.split(' ')[0]}</span> : <span className="m-none">Nobody yet</span>}</td>
                      <td className="r"><SlaBadge sla={i.sla} compact /></td>
                    </tr>))}</tbody>
                </table>
              </ScrollArea>
            )}
        </Card>
        <Card title="Team workload" sub="Open reports against each person's limit">
          {!ov ? <Skeleton h={200} /> : (
            <ul className="m-bars">
              {ov.technician_workload.filter(w => w.is_active).sort((a, b) => b.open / (b.max_concurrent || 1) - a.open / (a.max_concurrent || 1)).slice(0, 6).map(w => {
                const share = Math.min(1, w.open / Math.max(1, w.max_concurrent))
                return (
                  <li key={w.id}><Link to={`/incidents?view=open&assignee=${w.id}`} style={{ '--k': share >= 1 ? 'var(--p1)' : share >= .7 ? 'var(--p2)' : 'var(--a)' } as CSSProperties}>
                    <Avatar name={w.name} size={28} />
                    <span className="m-bars-main"><span className="m-bars-top"><b>{w.name}</b><em className="tabular">{w.open} of {w.max_concurrent}</em></span>
                      <span className="m-meter"><i style={{ width: `${share * 100}%` }} /></span></span>
                  </Link></li>)
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="m-row m-row-map">
        <Card title="Campus" sub="Ctrl/⌘ + scroll to zoom, or two fingers on a phone" className="m-mapcard"
          action={<Link to="/map" viewTransition className="m-link"><Expand size={15} />Full map</Link>}>
          <CampusMap data={map} buildings={buildings} embedded className="map-compact m-map" />
        </Card>
        <div className="m-stack">
          <Card title="By building" sub={`Open reports, last ${days * 2} days`}>
            {!tr ? <Skeleton h={240} /> : !tr.buildings.length ? <Empty title="No open reports in buildings" /> : (
                <table className="m-table m-table-compact">
                  <thead><tr><th>Building</th><th className="r">Urgent</th><th className="r">Open</th></tr></thead>
                  <tbody>{tr.buildings.slice(0, 5).map(b => {
                  const max = tr.buildings[0]!.total || 1
                  return (
                      <tr key={b.building}>
                        <td><Link to={`/incidents?view=open&q=${encodeURIComponent(b.building)}`} className="m-bld"><span>{b.building}</span><i style={{ width: `${(b.total / max) * 100}%` }} /></Link></td>
                        <td className="r tabular">{b.P1 + b.P2 ? <span className="m-urgent">{b.P1 + b.P2}</span> : <span className="muted">0</span>}</td>
                        <td className="r tabular"><b>{b.total}</b></td>
                      </tr>)
                })}</tbody>
                </table>
            )}
            </Card>
          <Card title="Recently fixed" action={<Link to="/incidents?view=done" className="m-link">All<ArrowRight size={15} /></Link>}>
            {!list ? <Skeleton h={200} /> : !resolved.length ? <Empty title="Nothing fixed yet" /> : (
                <ul className="m-list">{resolved.map(i => (
                  <li key={i.id}><Link to={`/incidents/${i.id}`}><span className="m-list-icon"><StatusIcon s={i.status} size={16} /></span>
                    <span><b>{i.title}</b><small>{i.assigned_name || 'Fixed'} · {timeAgo(i.resolution!.resolved_at)}{i.sla?.status === 'BREACHED' ? ' · late' : ' · on time'}</small></span></Link></li>))}</ul>
            )}
            </Card>
        </div>
      </div>

      {ov && (ov.correlations.length > 0 || (map?.outages.length || 0) > 0) && (
        <div className="m-alerts">
          {ov.correlations.map(c => (
            <Link key={c.service_id} to={`/incidents/${c.incidents[0]?.id || ''}`} className="m-alert"><Radio size={18} />
              <span><b>{c.count} reports on {c.service_name}</b> within {minutes(c.window_minutes)}. Check the service before fixing them one by one.</span><ArrowRight size={16} /></Link>))}
          {map?.outages.map(o => (
            <Link key={o.building} to={`/incidents/${o.incidents[0]?.id || ''}`} className="m-alert"><Radio size={18} />
              <span><b>{o.count} reports from {o.building}</b> within {minutes(o.window_minutes)}. Possibly a building-wide outage.</span><ArrowRight size={16} /></Link>))}
        </div>
      )}

    </main>
  )
}
