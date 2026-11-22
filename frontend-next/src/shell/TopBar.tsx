// Desktop: a floating liquid-glass bar. It narrows once you scroll; a highlight slides
// between sections. Admin pages, account and help live in the avatar menu; everything is
// also one Ctrl/⌘ K away. Phones use BottomNav instead (see Shell).
import { LayoutGroup, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { Bell, BookOpen, ChevronDown, History, Inbox, LayoutGrid, ListChecks, LogOut, Map as MapIcon, Plus, QrCode, Search, Settings, ShieldCheck, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/format'
import { modKey } from '../lib/media'
import { ThemePicker } from '../components/ThemePicker'
import { SchemeToggle } from '../components/SchemeToggle'
import { Avatar, Kbd } from '../ui/Controls'
import { Popover } from '../ui/Overlay'
import { NotificationList, useNotifications } from '../features/inbox/Inbox'
import { LivePanel } from './LivePanel'

export interface NavItem { to: string; label: string; icon: typeof LayoutGrid; minor?: boolean }
/** The phone tab bar's first tabs. */
export function navItems(staff: boolean): NavItem[] {
  return [
    { to: '/', label: staff ? 'Overview' : 'Home', icon: LayoutGrid },
    { to: '/incidents', label: staff ? 'Incidents' : 'My reports', icon: ListChecks },
    ...(staff ? [{ to: '/map', label: 'Campus map', icon: MapIcon }] : []),
  ]
}
/** Desktop: everything a role uses often sits in the bar (the avatar menu keeps account things). */
export function desktopNav(role: string): NavItem[] {
  if (role === 'admin') return [
    { to: '/', label: 'Overview', icon: LayoutGrid }, { to: '/incidents', label: 'Incidents', icon: ListChecks },
    { to: '/map', label: 'Map', icon: MapIcon }, { to: '/admin/users', label: 'People', icon: Users, minor: true },
    { to: '/admin/settings', label: 'Settings', icon: Settings, minor: true }, { to: '/admin/audit', label: 'Audit', icon: History, minor: true },
    { to: '/admin/assets', label: 'Stickers', icon: QrCode, minor: true },
  ]
  if (role === 'technician') return [
    { to: '/', label: 'Overview', icon: LayoutGrid }, { to: '/incidents', label: 'Incidents', icon: ListChecks },
    { to: '/incidents?view=mine', label: 'My queue', icon: Inbox }, { to: '/map', label: 'Map', icon: MapIcon },
    { to: '/notifications', label: 'Inbox', icon: Bell, minor: true }, { to: '/docs', label: 'Help', icon: BookOpen, minor: true },
  ]
  return [
    { to: '/', label: 'Home', icon: LayoutGrid }, { to: '/incidents', label: 'My reports', icon: ListChecks },
    { to: '/notifications', label: 'Inbox', icon: Bell }, { to: '/account', label: 'Account', icon: ShieldCheck }, { to: '/docs', label: 'Help', icon: BookOpen },
  ]
}
export function useActiveNav(items: { to: string }[]) {
  const { pathname, search } = useLocation()
  if (pathname === '/incidents/new') return null
  const here = pathname + search
  const withQuery = items.find(i => i.to.includes('?') && here.startsWith(i.to))
  if (withQuery) return withQuery.to
  return items.filter(i => !i.to.includes('?')).sort((a, b) => b.to.length - a.to.length)
    .find(i => i.to === '/' ? pathname === '/' : pathname.startsWith(i.to))?.to ?? null
}

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { user } = useAuth()
  const { scrollY } = useScroll()
  const [compact, setCompact] = useState(false)
  useMotionValueEvent(scrollY, 'change', y => setCompact(y > 48))
  // Every layout puts a role's everyday pages in the bar.
  const items = desktopNav(user?.role || 'customer')
  const active = useActiveNav(items)

  return (
    <motion.header className="topbar glass" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }} data-compact={compact || undefined}>
      <NavLink to="/" className="brand" aria-label="BITS reports home">
        <img src="/bits-crest.png" alt="" width={28} height={28} />
        <span className="brand-name">BITS reports</span>
      </NavLink>
      <LayoutGroup id="nav">
        <nav className="nav" aria-label="Main">
          {items.map(({ to, label, icon: Icon, minor }) => {
            const on = to === active
            return (
              <NavLink key={to} to={to} viewTransition className="nav-item" data-minor={minor || undefined} data-on={on || undefined} aria-current={on ? 'page' : undefined} title={label}>
                {on && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <Icon size={16} /><span className="nav-label">{label}</span>
              </NavLink>
            )
          })}
        </nav>
      </LayoutGroup>
      <div className="bar-right">
        <button type="button" className="search-trigger" onClick={onSearch} aria-label={`Search (${modKey} K)`}>
          <Search size={15} /><span>Search</span><Kbd>{modKey} K</Kbd>
        </button>
        <NavLink to="/incidents/new" viewTransition className="btn btn-primary bar-cta" title="Report a problem"><Plus size={16} /><span>Report</span></NavLink>
        <LivePanel />
        <BellButton />
        <SchemeToggle />
        <ThemePicker />
        <AccountMenu />
      </div>
    </motion.header>
  )
}

export function BellButton({ className }: { className?: string }) {
  const { data } = useNotifications()
  const unread = data?.unread || 0
  return (
    <Popover title="Inbox" width={400} className="pop-inbox" trigger={({ toggle, ref, props }) => (
      <button ref={ref} {...props} type="button" className={`icon-btn ${className || ''}`} onClick={toggle} aria-label={`Inbox${unread ? `, ${unread} unread` : ''}`}>
        <Bell size={18} />{unread > 0 && <span className="dot-count tabular">{unread > 99 ? '99+' : unread}</span>}
      </button>
    )}>
      {close => <NotificationList compact onOpen={close} />}
    </Popover>
  )
}

export function AccountMenu() {
  const { user, signOut } = useAuth()
  const { data } = useNotifications()
  if (!user) return null
  return (
    <Popover title={user.name} width={280} trigger={({ toggle, ref, props }) => (
      <button ref={ref} {...props} type="button" className="avatar-btn" onClick={toggle} title={`${user.name}: menu`}>
        <Avatar name={user.name} src={user.picture} size={30} /><ChevronDown size={14} />
      </button>
    )}>
      {close => (
        <div className="menu" role="menu" onClick={e => { if ((e.target as HTMLElement).closest('a,button')) close() }}>
          <div className="menu-who"><b>{user.name}</b><small>{user.email}</small><em>{ROLE_LABEL[user.role]}{user.student_id ? `, ID ${user.student_id}` : ''}</em></div>
          <span className="menu-label">You</span>
          <MenuLink to="/notifications" icon={Bell}>Inbox{!!data?.unread && <b className="menu-count">{data.unread}</b>}</MenuLink>
          <MenuLink to="/account" icon={ShieldCheck}>Account and security</MenuLink>
          <MenuLink to="/docs" icon={BookOpen}>How it works</MenuLink>
          <button type="button" role="menuitem" className="menu-item danger" onClick={signOut}><LogOut size={16} />Sign out</button>
        </div>
      )}
    </Popover>
  )
}
const MenuLink = ({ to, icon: Icon, children }: { to: string; icon: typeof Users; children: ReactNode }) => (
  <Link to={to} viewTransition role="menuitem" className="menu-item"><Icon size={16} />{children}</Link>
)
