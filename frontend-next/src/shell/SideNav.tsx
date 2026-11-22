// Material layout shell (desktop): a navigation drawer on the left and a slim app bar on top.
// The drawer groups a role's pages; the app bar holds search, reporting and account things.
// On narrower screens the drawer folds into an icon rail. Phones keep the bottom tab bar.
import { useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { LayoutGroup, motion } from 'motion/react'
import { Bell, BookOpen, History, Inbox, LayoutGrid, ListChecks, Map as MapIcon, Palette, Plus, QrCode, Search, Settings, ShieldCheck, Users } from 'lucide-react'
import { useAuth, isStaff } from '../lib/auth'
import { modKey } from '../lib/media'
import { api, useQuery, type Overview } from '../api'
import { Kbd } from '../ui/Controls'
import { ThemePicker, openAppearance } from '../components/ThemePicker'
import { SchemeToggle } from '../components/SchemeToggle'
import { useNotifications } from '../features/inbox/Inbox'
import { LivePanel } from './LivePanel'
import { AccountMenu, BellButton, useActiveNav, type NavItem } from './TopBar'

interface Group { title?: string; items: (NavItem & { count?: number })[] }

function groupsFor(role: string, open?: number, unread?: number): Group[] {
  if (role === 'admin') return [
    { items: [{ to: '/', label: 'Overview', icon: LayoutGrid }, { to: '/incidents', label: 'Incidents', icon: ListChecks, count: open },
      { to: '/map', label: 'Campus map', icon: MapIcon }, { to: '/notifications', label: 'Inbox', icon: Bell, count: unread }] },
    { title: 'Administration', items: [{ to: '/admin/users', label: 'People', icon: Users }, { to: '/admin/settings', label: 'Settings', icon: Settings },
      { to: '/admin/audit', label: 'Audit log', icon: History }, { to: '/admin/assets', label: 'QR stickers', icon: QrCode }] },
  ]
  if (role === 'technician') return [
    { items: [{ to: '/', label: 'Overview', icon: LayoutGrid }, { to: '/incidents', label: 'Incidents', icon: ListChecks, count: open },
      { to: '/incidents?view=mine', label: 'My queue', icon: Inbox }, { to: '/map', label: 'Campus map', icon: MapIcon },
      { to: '/notifications', label: 'Inbox', icon: Bell, count: unread }] },
  ]
  return [
    { items: [{ to: '/', label: 'Home', icon: LayoutGrid }, { to: '/incidents', label: 'My reports', icon: ListChecks },
      { to: '/notifications', label: 'Inbox', icon: Bell, count: unread }, { to: '/account', label: 'Account', icon: ShieldCheck }] },
  ]
}

export function SideNav() {
  const { user } = useAuth()
  const staff = isStaff(user)
  const { data: ov } = useQuery<Overview>(staff ? 'overview' : null, () => api.reports.overview())
  const { data: notes } = useNotifications()
  const groups = groupsFor(user?.role || 'customer', ov?.totals.open, notes?.unread || undefined)
  const active = useActiveNav(groups.flatMap(g => g.items))
  // Pages make room for the drawer only while it is shown (not on phones or the sign-in page).
  useEffect(() => { document.documentElement.dataset.mshell = 'true'; return () => { delete document.documentElement.dataset.mshell } }, [])
  if (!user) return null
  return (
    <aside className="m-drawer" aria-label="Main">
      <Link to="/" className="m-brand" aria-label="BITS reports home">
        <img src="/bits-crest.png" alt="" width={30} height={30} /><span>BITS reports</span>
      </Link>
      <Link to="/incidents/new" viewTransition className="m-fab" title="Report a problem"><Plus size={20} /><span>Report a problem</span></Link>
      <LayoutGroup id="side-nav">
      <nav className="m-nav">
        {groups.map((g, gi) => (
          <div key={gi} className="m-group">
            {g.title && <span className="m-group-title">{g.title}</span>}
            {g.items.map(({ to, label, icon: Icon, count }) => {
              const on = to === active
              return (
                <NavLink key={to} to={to} viewTransition className="m-item" data-on={on || undefined} aria-current={on ? 'page' : undefined} title={label}>
                  {on && <motion.span layoutId="side-pill" className="m-pill" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
                  <Icon size={19} /><span className="m-label">{label}</span>
                  {!!count && <em className="m-count tabular">{count > 99 ? '99+' : count}</em>}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
      </LayoutGroup>
      <div className="m-drawer-foot">
        <NavLink to="/docs" className="m-item" data-on={active === '/docs' || undefined} title="Help"><BookOpen size={19} /><span className="m-label">Help</span></NavLink>
        <button type="button" className="m-item" onClick={() => openAppearance()} title="Appearance"><Palette size={19} /><span className="m-label">Appearance</span></button>
      </div>
    </aside>
  )
}

export function AppBar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="m-appbar">
      <button type="button" className="m-search" onClick={onSearch} aria-label={`Search (${modKey} K)`}>
        <Search size={18} /><span>Search incidents, people and pages</span><Kbd>{modKey} K</Kbd>
      </button>
      <div className="m-appbar-right">
        <LivePanel />
        <BellButton />
        <SchemeToggle />
        <ThemePicker />
        <AccountMenu />
      </div>
    </header>
  )
}
