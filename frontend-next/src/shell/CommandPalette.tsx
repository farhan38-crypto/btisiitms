// Ctrl/⌘ K: go anywhere, run an action, or find an incident by number, title,
// place, reporter or student ID (searches the backend as you type).
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, BookOpen, CornerDownLeft, History, LayoutGrid, ListChecks, LogOut, Map as MapIcon, Moon, Plus, QrCode, Search, Settings, ShieldCheck, Sun, Users } from 'lucide-react'
import { api, type Incident } from '../api'
import { useAuth, isStaff, isAdmin } from '../lib/auth'
import { PriorityMark, StatusIcon } from '../ui/Badges'
import { Kbd } from '../ui/Controls'

interface Cmd { id: string; label: string; hint?: string; icon: ReactNode; run: () => void; group: string; keywords?: string }

export function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open() }
      else if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut, theme, setTheme, prefs } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Incident[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setSel(0); setFound([]); setTimeout(() => input.current?.focus(), 20) } }, [open])
  // Search incidents on the server, a moment after typing stops.
  useEffect(() => {
    const term = q.trim()
    if (!open || term.length < 2) { setFound([]); return }
    const c = new AbortController()
    const t = window.setTimeout(() => { api.incidents.list({ q: term, limit: 8 }).then(setFound).catch(() => {}) }, 180)
    return () => { window.clearTimeout(t); c.abort() }
  }, [q, open])

  const go = (to: string) => () => { onClose(); navigate(to) }
  const commands = useMemo<Cmd[]>(() => {
    if (!user) return []
    const staff = isStaff(user), admin = isAdmin(user)
    const c: Cmd[] = [
      { id: 'new', group: 'Actions', label: 'Report a problem', icon: <Plus size={16} />, run: go('/incidents/new'), keywords: 'new create incident ticket' },
      { id: 'theme', group: 'Actions', label: theme.scheme === 'dark' ? 'Switch to a light theme' : 'Switch to a dark theme', icon: theme.scheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
        run: () => { onClose(); setTheme(theme.scheme === 'dark' ? (prefs.auto_light || 'paper') : (prefs.auto_dark || 'aurora')) }, keywords: 'appearance dark light mode' },
      { id: 'home', group: 'Go to', label: staff ? 'Overview' : 'Home', icon: <LayoutGrid size={16} />, run: go('/') },
      { id: 'inc', group: 'Go to', label: staff ? 'Incidents' : 'My reports', icon: <ListChecks size={16} />, run: go('/incidents') },
      ...(staff ? [
        { id: 'mine', group: 'Go to', label: 'Assigned to me', icon: <ListChecks size={16} />, run: go('/incidents?view=mine') },
        { id: 'urgent', group: 'Go to', label: 'Urgent (P1 and P2)', icon: <ListChecks size={16} />, run: go('/incidents?view=urgent') },
        { id: 'map', group: 'Go to', label: 'Campus map', icon: <MapIcon size={16} />, run: go('/map') },
      ] : []),
      { id: 'inbox', group: 'Go to', label: 'Inbox', icon: <Bell size={16} />, run: go('/notifications'), keywords: 'notifications' },
      { id: 'acct', group: 'Go to', label: 'Account and security', icon: <ShieldCheck size={16} />, run: go('/account'), keywords: 'password 2fa authenticator profile' },
      { id: 'docs', group: 'Go to', label: 'How it works', icon: <BookOpen size={16} />, run: go('/docs'), keywords: 'help docs' },
      ...(admin ? [
        { id: 'users', group: 'Administration', label: 'Users and roles', icon: <Users size={16} />, run: go('/admin/users') },
        { id: 'cfg', group: 'Administration', label: 'Configuration', icon: <Settings size={16} />, run: go('/admin/settings'), keywords: 'sla services categories strategy' },
        { id: 'audit', group: 'Administration', label: 'Audit log and SLA breaches', icon: <History size={16} />, run: go('/admin/audit') },
        { id: 'qr', group: 'Administration', label: 'QR stickers', icon: <QrCode size={16} />, run: go('/admin/assets'), keywords: 'assets equipment' },
      ] : []),
      { id: 'out', group: 'Account', label: 'Sign out', icon: <LogOut size={16} />, run: () => { onClose(); signOut() } },
    ]
    return c
  }, [user, theme.scheme, prefs]) // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim().toLowerCase()
  const matches = commands.filter(c => !term || `${c.label} ${c.keywords || ''}`.toLowerCase().includes(term))
  const incidentCmds: Cmd[] = found.map(i => ({ id: i.id, group: 'Incidents', label: `${i.number} · ${i.title}`, hint: i.location?.formatted,
    icon: <span className="cp-inc"><PriorityMark p={i.priority} /><StatusIcon s={i.status} /></span>, run: go(`/incidents/${i.id}`) }))
  const all = [...incidentCmds, ...matches]
  useEffect(() => { setSel(0) }, [q, found.length])
  useEffect(() => { list.current?.querySelector('[data-sel]')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(all.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); all[sel]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  let lastGroup = ''
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="ov-root cp-root">
          <motion.div className="ov-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div className="cp glass" role="dialog" aria-label="Command palette" onKeyDown={key}
            initial={{ opacity: 0, y: -12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: .98 }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}>
            <label className="cp-search"><Search size={18} />
              <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search incidents, pages and actions…"
                role="combobox" aria-expanded="true" aria-controls="cp-list" aria-activedescendant={all[sel] ? `cp-${all[sel]!.id}` : undefined} />
              <Kbd>Esc</Kbd>
            </label>
            <div className="cp-list" id="cp-list" role="listbox" ref={list}>
              {all.length === 0 && <p className="cp-none">No matches for “{q}”.</p>}
              {all.map((c, i) => {
                const head = c.group !== lastGroup ? (lastGroup = c.group) : null
                return (
                  <div key={c.id}>
                    {head && <div className="cp-group">{head}</div>}
                    <button type="button" id={`cp-${c.id}`} role="option" aria-selected={i === sel} data-sel={i === sel || undefined}
                      className="cp-item" onMouseMove={() => setSel(i)} onClick={c.run}>
                      <span className="cp-icon">{c.icon}</span>
                      <span className="cp-label">{c.label}{c.hint && <small>{c.hint}</small>}</span>
                      {i === sel && <CornerDownLeft size={14} className="cp-enter" />}
                    </button>
                  </div>
                )
              })}
            </div>
            <footer className="cp-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>/</Kbd> opens this from anywhere</span></footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>, document.body)
}
