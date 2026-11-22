// ⌘K / Ctrl+K command palette: jump to any page, open an incident by number or title,
// or run an action (new report, switch theme, board view…). Keyboard first, mouse friendly.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutDashboard, Ticket, Plus, Map as MapIcon, QrCode, Users, Settings, History, BookOpen, ShieldCheck,
  Bell, Moon, Columns3, CornerDownLeft, Hash
} from 'lucide-react';
import api from '../api';
import { AnimatePresence, motion } from '../motion';

// Match: a plain substring first; otherwise a loose "typo-tolerant" match where the typed letters
// appear in order with at most two letters skipped between them. Returns matched indexes or null.
function fuzzy(text, query) {
  if (!query) return [];
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  const at = t.indexOf(q);
  if (at >= 0) return [...q].map((_, i) => at + i);
  const compact = q.replace(/\s+/g, '');
  const hits = [];
  let from = 0;
  for (const ch of compact) {
    const pos = t.indexOf(ch, from);
    if (pos < 0 || (hits.length && pos - hits[hits.length - 1] > 3)) return null;
    hits.push(pos);
    from = pos + 1;
  }
  return hits;
}

function Highlight({ text, hits }) {
  if (!hits?.length) return text;
  const set = new Set(hits);
  return [...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <React.Fragment key={i}>{ch}</React.Fragment>));
}

export function useCommandPaletteShortcut(setOpen) {
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

export default function CommandPalette({ open, onClose, user, onToggleTheme }) {
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [incidents, setIncidents] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const admin = user.role === 'admin';
  const staff = admin || user.role === 'technician';

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Incidents matching what's typed (server search, debounced).
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (q.length < 2) { setIncidents([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.get('/incidents', { params: { q, limit: 6 } })
        .then(r => { if (!cancelled) setIncidents(r.data.slice(0, 6)); })
        .catch(() => {});
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  const commands = useMemo(() => [
    staff && { group: 'Go to', label: 'Overview', icon: LayoutDashboard, run: () => nav('/admin'), keys: 'dashboard home' },
    { group: 'Go to', label: user.role === 'customer' ? 'My reports' : 'Incidents', icon: Ticket, run: () => nav('/incidents'), keys: 'list tickets queue' },
    staff && { group: 'Go to', label: 'Incident board', icon: Columns3, run: () => { localStorage.setItem('bits-incident-view', 'board'); nav('/incidents'); }, keys: 'kanban drag' },
    staff && { group: 'Go to', label: 'Campus map', icon: MapIcon, run: () => nav('/campus-map'), keys: 'hotspot outage' },
    admin && { group: 'Go to', label: 'QR stickers', icon: QrCode, run: () => nav('/admin/assets'), keys: 'assets equipment print' },
    admin && { group: 'Go to', label: 'Users & roles', icon: Users, run: () => nav('/admin/users'), keys: 'technicians accounts' },
    admin && { group: 'Go to', label: 'Configuration', icon: Settings, run: () => nav('/admin/settings'), keys: 'settings sla strategy' },
    admin && { group: 'Go to', label: 'Audit & SLA log', icon: History, run: () => nav('/admin/audit'), keys: 'history violations' },
    { group: 'Go to', label: 'Notifications', icon: Bell, run: () => nav('/notifications'), keys: 'alerts bell' },
    { group: 'Go to', label: 'Campus docs', icon: BookOpen, run: () => nav('/docs'), keys: 'help documentation' },
    { group: 'Go to', label: 'Account & security', icon: ShieldCheck, run: () => nav('/account'), keys: 'password 2fa profile' },
    { group: 'Actions', label: 'Create a report', icon: Plus, run: () => nav('/incidents/new'), keys: 'new complaint ticket issue' },
    { group: 'Actions', label: 'Switch light / dark mode', icon: Moon, run: e => onToggleTheme?.(e), keys: 'theme dark light' }
  ].filter(Boolean), [staff, admin, user.role, nav, onToggleTheme]);

  const results = useMemo(() => {
    const q = query.trim();
    const cmd = commands
      .map(c => ({ ...c, hits: fuzzy(c.label, q), alt: q ? fuzzy(c.keys, q) : [] }))
      .filter(c => !q || c.hits || c.alt)
      .map(c => ({ ...c, kind: 'command' }));
    const inc = incidents.map(i => ({
      kind: 'incident', group: 'Incidents', label: `${i.number} · ${i.title}`, sub: `${i.status.replaceAll('_', ' ').toLowerCase()} · ${i.location?.formatted || 'online'}`,
      icon: Hash, hits: fuzzy(`${i.number} · ${i.title}`, q), run: () => nav(`/incidents/${i.id}`)
    }));
    return [...inc, ...cmd];
  }, [commands, incidents, query, nav]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item, e) => { if (!item) return; onClose(); item.run(e); };
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active], e); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="cmdk-overlay" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}>
          <motion.div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ type: 'spring', stiffness: 520, damping: 36 }}>
            <div className="cmdk-input">
              <Search size={18} />
              <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Search incidents, pages and actions…" role="combobox" aria-expanded="true"
                aria-controls="cmdk-list" aria-activedescendant={`cmdk-${active}`} />
              <kbd>esc</kbd>
            </div>
            <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
              {!results.length && <p className="cmdk-empty">Nothing matches “{query}”. Try an incident number like INC-00012.</p>}
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? <div className="cmdk-group" key={`g-${r.group}`}>{r.group}</div> : null;
                lastGroup = r.group;
                const Icon = r.icon;
                return (
                  <React.Fragment key={`${r.kind}-${r.label}`}>
                    {header}
                    <div id={`cmdk-${i}`} role="option" aria-selected={i === active} data-active={i === active}
                      className="cmdk-item" onMouseMove={() => setActive(i)} onClick={e => choose(r, e)}>
                      {i === active && <motion.span layoutId="cmdk-active" className="cmdk-active" transition={{ type: 'spring', stiffness: 600, damping: 42 }} />}
                      <span className="cmdk-icon"><Icon size={16} /></span>
                      <span className="cmdk-text"><span><Highlight text={r.label} hits={r.hits} /></span>{r.sub && <small>{r.sub}</small>}</span>
                      {i === active && <CornerDownLeft size={14} className="cmdk-enter" />}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>K</kbd> toggle</span></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
