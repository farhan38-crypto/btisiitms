// Home for students: the report that's in motion right now, told like a delivery tracker,
// one-tap shortcuts to report common problems, and everything reported before.
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight, Plus } from 'lucide-react'
import { api, useQuery, OPEN_STATUSES, type Incident } from '../../api'
import { useAuth } from '../../lib/auth'
import { timeAgo } from '../../lib/format'
import { Empty, Skeleton } from '../../ui/Controls'
import { pVar } from '../../ui/Badges'
import { steps, trackerHeadline, LifecycleRail } from '../incident/Lifecycle'
import { PRESETS } from '../report/presets'
import { FieldCard, useField } from '../incident/FieldCard'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
export const useMyReports = () => useQuery('my-reports', () => api.incidents.list({ limit: 100 }), { staleMs: 15_000 })

export function ReportCard({ i }: { i: Incident }) {
  const s = steps(i, [], true)
  const h = trackerHeadline(i)
  const open = OPEN_STATUSES.includes(i.status)
  return (
    <Link to={`/incidents/${i.id}`} viewTransition className="rcard" data-open={open || undefined} style={{ ['--k' as string]: open ? 'var(--a)' : 'var(--ok)' }}>
      <span className="rcard-top"><em className="tabular">{i.number}</em><small>{timeAgo(i.created_at)}</small></span>
      <b className="rcard-title">{i.title}</b>
      <span className="rcard-status">{h.title}</span>
      <span className="dots" aria-label={`${s.filter(x => x.done).length} of ${s.length} steps done`}>
        {s.map(x => <i key={x.key} data-done={x.done || undefined} data-current={x.current || undefined} />)}
      </span>
      <small className="rcard-place">{i.location.formatted}</small>
    </Link>
  )
}

function Tracker({ i }: { i: Incident }) {
  const { user } = useAuth()
  const h = trackerHeadline(i)
  const onSite = i.location.type !== 'online'
  const { data: field } = useField(i.id, onSite)
  const { data: d } = useQuery(`incident:${i.id}`, () => api.incidents.get(i.id))
  return (
    <motion.section className="tracker surface" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, ease: [0.22, 1, 0.36, 1] }}
      style={{ ['--k' as string]: pVar(i.priority) }}>
      <div className="tracker-main">
        <span className="tracker-num tabular">{i.number} · {i.title}</span>
        <h2>{h.title}</h2>
        <p>{h.sub}</p>
        <LifecycleRail incident={i} audit={d?.audit || []} forReporter />
        <Link to={`/incidents/${i.id}`} viewTransition className="btn">Open the report<ArrowRight size={15} /></Link>
      </div>
      {onSite && user && field?.handover && !field.handover.verified_at && <div className="tracker-side"><FieldCard incident={i} user={user} field={field} /></div>}
    </motion.section>
  )
}

export default function StudentHome() {
  const { user } = useAuth()
  const { data, loading } = useMyReports()
  const mine = data || []
  const active = mine.filter(i => OPEN_STATUSES.includes(i.status) || i.status === 'RESOLVED')
  const lead = active[0]
  return (
    <main className="page page-home">
      <header className="page-head home-head">
        <div>
          <motion.p className="eyebrow-line" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{greeting()}, {user?.name.split(' ')[0]}</motion.p>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, ease: [0.22, 1, 0.36, 1] }}>
            {loading ? 'Checking your reports…' : lead ? `${active.length === 1 ? 'One report' : `${active.length} reports`} in motion.` : 'Something not working?'}
          </motion.h1>
        </div>
        <Link to="/incidents/new" viewTransition className="btn btn-primary big"><Plus size={18} />Report a problem</Link>
      </header>

      {loading ? <Skeleton h={220} r={28} /> : lead && <Tracker i={lead} />}

      <section className="section">
        <header className="section-head"><div><h2>Report in one tap</h2><p>Pick what’s wrong; you can add details on the next screen.</p></div></header>
        <div className="quick">
          {PRESETS.map((p, k) => (
            <motion.div key={p.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .05 + k * .03 }}>
              <Link to={`/incidents/new?type=${p.key}`} viewTransition className="quick-item"><span className="quick-icon"><p.icon size={20} /></span><b>{p.label}</b><small>{p.hint}</small></Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="section">
        <header className="section-head"><div><h2>Your reports</h2></div>{mine.length > 6 && <Link to="/incidents?view=all" className="btn sm">See all</Link>}</header>
        {loading ? <div className="cards">{[0, 1, 2].map(k => <Skeleton key={k} h={150} r={22} />)}</div>
          : !mine.length ? <Empty title="No reports yet">When you report something, you can follow it here as it’s fixed.</Empty>
          : <div className="cards">{mine.slice(0, 6).map(i => <ReportCard key={i.id} i={i} />)}</div>}
      </section>
    </main>
  )
}
