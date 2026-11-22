// Notifications as an inbox: "Needs you" (things to act on) and "All", grouped by day.
// Used in the bell popover and on the /notifications page.
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Clock, FileImage, Flame, Info, MapPin, MessageSquare, Navigation, RotateCcw, ShieldAlert, UserCheck, Zap } from 'lucide-react'
import { api, useQuery, invalidate, type Notification } from '../../api'
import { dayLabel, timeAgo } from '../../lib/format'
import { Empty, Segmented, Skeleton } from '../../ui/Controls'

const KIND: Record<string, { icon: typeof Bell; tone: string; urgent?: boolean }> = {
  critical: { icon: Flame, tone: 'var(--p1)', urgent: true },
  sla_breached: { icon: AlertTriangle, tone: 'var(--p1)', urgent: true },
  sla_at_risk: { icon: Clock, tone: 'var(--p2)', urgent: true },
  escalation: { icon: Zap, tone: 'var(--p1)', urgent: true },
  correlation: { icon: Zap, tone: 'var(--p2)', urgent: true },
  assignment: { icon: UserCheck, tone: 'var(--a)', urgent: true },
  info_requested: { icon: Info, tone: 'var(--p2)', urgent: true },
  security: { icon: ShieldAlert, tone: 'var(--p2)', urgent: true },
  arrived: { icon: MapPin, tone: 'var(--b)', urgent: true },
  resolved: { icon: CircleCheck, tone: 'var(--ok)', urgent: true },
  en_route: { icon: Navigation, tone: 'var(--b)' },
  technician_assigned: { icon: UserCheck, tone: 'var(--b)' },
  reopened: { icon: RotateCcw, tone: 'var(--p2)' },
  note: { icon: MessageSquare, tone: 'var(--ink-2)' },
  attachment: { icon: FileImage, tone: 'var(--ink-2)' },
}
export const kindOf = (k: string) => KIND[k] || { icon: Bell, tone: 'var(--ink-2)' }

export function useNotifications() {
  return useQuery('notifications', () => api.notifications.list(), { pollMs: 60_000, staleMs: 10_000 })
}

export function NotificationList({ compact, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const { data, loading, set } = useNotifications()
  const [tab, setTab] = useState<'urgent' | 'all'>('urgent')
  const navigate = useNavigate()
  const items = data?.items || []
  const urgent = items.filter(n => kindOf(n.kind).urgent)
  const shown = (tab === 'urgent' ? urgent : items).slice(0, compact ? 12 : 50)
  const groups = useMemo(() => {
    const g: { day: string; items: Notification[] }[] = []
    for (const n of shown) {
      const d = dayLabel(n.created_at)
      if (g[g.length - 1]?.day !== d) g.push({ day: d, items: [] })
      g[g.length - 1]!.items.push(n)
    }
    return g
  }, [shown])

  const markRead = (n: Notification) => {
    if (n.read) return
    set(d => d && { items: d.items.map(x => x.id === n.id ? { ...x, read: true } : x), unread: Math.max(0, d.unread - 1) })
    api.notifications.read(n.id).catch(() => invalidate('notifications'))
  }
  const readAll = () => {
    set(d => d && { items: d.items.map(x => ({ ...x, read: true })), unread: 0 })
    api.notifications.readAll().finally(() => invalidate('notifications'))
  }
  const open = (n: Notification) => { markRead(n); onOpen?.(); if (n.incident_id) navigate(`/incidents/${n.incident_id}`) }

  return (
    <div className={`inbox ${compact ? 'inbox-compact' : ''}`}>
      <div className="inbox-bar">
        <Segmented size="sm" value={tab} onChange={setTab} label="Show"
          options={[{ value: 'urgent', label: 'Needs you', count: urgent.filter(n => !n.read).length }, { value: 'all', label: 'All', count: data?.unread }]} />
        <button type="button" className="btn btn-quiet sm" onClick={readAll} disabled={!data?.unread}><CheckCheck size={15} />Mark all read</button>
      </div>
      {loading ? <div className="inbox-skel">{[0, 1, 2].map(i => <Skeleton key={i} h={54} r={14} />)}</div>
        : !shown.length ? <Empty icon={<Bell size={20} />} title={tab === 'urgent' ? 'Nothing needs you right now' : 'No notifications yet'}>
            {tab === 'urgent' && items.length ? <>Everything else is under <button className="link" onClick={() => setTab('all')}>All</button>.</> : 'Updates about your incidents will appear here.'}
          </Empty>
        : groups.map(g => (
          <div key={g.day} className="inbox-group">
            <h3>{g.day}</h3>
            <ul>
              {g.items.map(n => {
                const k = kindOf(n.kind); const Icon = k.icon
                return (
                  <li key={n.id}>
                    <button type="button" className="inbox-item" data-unread={!n.read || undefined} onClick={() => open(n)} style={{ ['--k' as string]: k.tone }}>
                      <span className="inbox-icon"><Icon size={16} /></span>
                      <span className="inbox-text"><b>{n.title}</b><span>{n.message}</span></span>
                      <span className="inbox-meta"><small>{timeAgo(n.created_at)}</small>{n.incident_number && <em>{n.incident_number}</em>}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      {compact && <Link to="/notifications" className="inbox-all" onClick={onOpen}>Open the inbox</Link>}
    </div>
  )
}

export default function InboxPage() {
  return (
    <main className="page page-narrow">
      <header className="page-head"><div><h1>Inbox</h1><p>Updates on incidents you report, handle or manage.</p></div></header>
      <div className="surface pad"><NotificationList /></div>
    </main>
  )
}
