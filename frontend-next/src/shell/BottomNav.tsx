// Phones: a floating glass tab bar at the bottom, in thumb reach (iOS 26 / Linear mobile
// style). Report is the raised main action. It shrinks while you scroll down and comes
// back when you scroll up. "You" opens a sheet with everything else.
import { LayoutGroup, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Bell, BookOpen, History, LogOut, Moon, Palette, Sun, Plus, QrCode, Search, Settings, ShieldCheck, Users } from 'lucide-react'
import { useAuth, isStaff, isAdmin } from '../lib/auth'
import { ROLE_LABEL } from '../lib/format'
import { Avatar } from '../ui/Controls'
import { Dialog } from '../ui/Overlay'
import { useNotifications } from '../features/inbox/Inbox'
import { openAppearance } from '../components/ThemePicker'
import { useSchemeToggle } from '../components/SchemeToggle'
import { navItems, useActiveNav } from './TopBar'

export function BottomNav({ onSearch }: { onSearch: () => void }) {
  const { user, signOut } = useAuth()
  const staff = isStaff(user)
  const { data } = useNotifications()
  const unread = data?.unread || 0
  const [me, setMe] = useState(false)
  const scheme = useSchemeToggle()
  const [min, setMin] = useState(false)
  const { scrollY } = useScroll()
  useMotionValueEvent(scrollY, 'change', y => {
    const prev = scrollY.getPrevious() ?? 0
    if (y < 60) setMin(false)
    else if (y > prev + 6) setMin(true)
    else if (y < prev - 6) setMin(false)
  })
  const { pathname } = useLocation()
  useEffect(() => { setMe(false); setMin(false) }, [pathname])

  const base = navItems(staff)
  const tabs = [base[0]!, base[1]!, ...(staff ? [base[2]!] : [{ to: '/notifications', label: 'Inbox', icon: Bell }])]
  const active = useActiveNav([...tabs, { to: '/notifications' }])
  if (!user) return null
  return (
    <>
      <nav className="tabbar glass" data-min={min || undefined} aria-label="Main">
        <LayoutGroup id="tabs">
          <Tab t={tabs[0]!} on={active === tabs[0]!.to} unread={unread} />
          <Tab t={tabs[1]!} on={active === tabs[1]!.to} unread={unread} />
          <Link to="/incidents/new" viewTransition className="tab-cta" aria-label="Report a problem"><Plus size={24} /></Link>
          <Tab t={tabs[2]!} on={active === tabs[2]!.to} unread={unread} />
          <button type="button" className="tab" onClick={() => setMe(true)} aria-haspopup="dialog" aria-expanded={me}>
            <span className="tab-icon"><Avatar name={user.name} src={user.picture} size={24} />{staff && unread > 0 && <span className="dot-count tabular">{unread}</span>}</span>
            <span className="tab-label">You</span>
          </button>
        </LayoutGroup>
      </nav>
      <Dialog open={me} onClose={() => setMe(false)} title={user.name} description={`${ROLE_LABEL[user.role]} · ${user.email}`}>
        <div className="menu sheet-menu">
          <button type="button" className="menu-item" onClick={() => { setMe(false); onSearch() }}><Search size={18} />Search</button>
          {staff && <Link to="/notifications" className="menu-item"><Bell size={18} />Inbox{unread > 0 && <b className="menu-count">{unread}</b>}</Link>}
          <button type="button" className="menu-item" onClick={() => scheme.toggle()}>{scheme.dark ? <Sun size={18} /> : <Moon size={18} />}{scheme.dark ? 'Light mode' : 'Dark mode'}</button>
          <button type="button" className="menu-item" onClick={() => { setMe(false); openAppearance() }}><Palette size={18} />Appearance</button>
          <Link to="/account" className="menu-item"><ShieldCheck size={18} />Account and security</Link>
          <Link to="/docs" className="menu-item"><BookOpen size={18} />How it works</Link>
          {isAdmin(user) && <>
            <span className="menu-label">Administration</span>
            <Link to="/admin/users" className="menu-item"><Users size={18} />Users and roles</Link>
            <Link to="/admin/settings" className="menu-item"><Settings size={18} />Configuration</Link>
            <Link to="/admin/audit" className="menu-item"><History size={18} />Audit and SLA log</Link>
            <Link to="/admin/assets" className="menu-item"><QrCode size={18} />QR stickers</Link>
          </>}
          <button type="button" className="menu-item danger" onClick={signOut}><LogOut size={18} />Sign out</button>
        </div>
      </Dialog>
    </>
  )
}

function Tab({ t, on, unread }: { t: { to: string; label: string; icon: typeof Bell }; on: boolean; unread: number }) {
  const Icon = t.icon
  return (
    <NavLink to={t.to} viewTransition className="tab" data-on={on || undefined} aria-current={on ? 'page' : undefined}>
      {on && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <span className="tab-icon"><Icon size={21} />{t.to === '/notifications' && unread > 0 && <span className="dot-count tabular">{unread}</span>}</span>
      <span className="tab-label">{t.label.replace('Campus map', 'Map').replace('My reports', 'Reports')}</span>
    </NavLink>
  )
}
