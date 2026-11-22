// Bell popover: unread notifications sit as a stacked pile of cards that fans out into a list.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ArrowRight } from 'lucide-react';
import api from '../api';
import { AnimatePresence, motion } from '../motion';
import { fmtShort } from './common';

const KIND_COLOR = {
  critical: 'var(--c-rose)', sla_breached: 'var(--c-rose)', sla_at_risk: 'var(--c-orange)', escalation: 'var(--c-orange)',
  resolved: 'var(--c-teal)', closed: 'var(--c-teal)', en_route: 'var(--c-sky)', arrived: 'var(--c-sky)',
  assignment: 'var(--c-violet)', technician_assigned: 'var(--c-violet)'
};

export default function NotificationStack({ unread, setUnread }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [fanned, setFanned] = useState(false);
  const box = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!open) { setFanned(false); return undefined; }
    api.get('/notifications').then(r => { setItems(r.data.items.slice(0, 6)); setUnread(r.data.unread); }).catch(() => {});
    const t = setTimeout(() => setFanned(true), 160);       // pile first, then fan out
    const onDown = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, setUnread]);

  const readAll = async () => {
    await api.post('/notifications/read-all').catch(() => {});
    setItems(list => list.map(n => ({ ...n, read: true })));
    setUnread(0);
  };
  const openOne = async n => {
    setOpen(false);
    if (!n.read) { api.post(`/notifications/${n.id}/read`).catch(() => {}); setUnread(u => Math.max(0, u - 1)); }
    if (n.incident_id) nav(`/incidents/${n.incident_id}`);
  };

  return (
    <div className="notif-wrap" ref={box}>
      <button type="button" className="icon-btn bell" onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-label={`Notifications, ${unread} unread`} title={`Notifications (${unread} unread)`}>
        <motion.span key={unread} style={{ display: 'grid' }} initial={unread ? { rotate: -18 } : false}
          animate={{ rotate: [-18, 14, -8, 4, 0] }} transition={{ duration: 0.6 }}>
          <Bell size={18} />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span className="bell-count" key="count" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 20 }}>{unread > 99 ? '99+' : unread}</motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="notif-pop" initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ type: 'spring', stiffness: 520, damping: 38 }}>
            <div className="notif-head">
              <b>Notifications</b>
              {unread > 0 && <button type="button" className="link-btn" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}
            </div>
            <div className="notif-stack" style={{ height: fanned ? undefined : 96 }}>
              {!items.length && <p className="muted small-text" style={{ padding: 14 }}>You're all caught up.</p>}
              {items.map((n, i) => (
                <motion.button key={n.id} type="button" className={`notif-card${n.read ? '' : ' unread'}`}
                  style={{ '--k': KIND_COLOR[n.kind] || 'var(--c-indigo)', zIndex: items.length - i }}
                  initial={false}
                  animate={fanned
                    ? { y: 0, scale: 1, opacity: 1, position: 'relative', marginTop: i ? 8 : 0 }
                    : { y: i * 8, scale: 1 - i * 0.04, opacity: i > 2 ? 0 : 1, position: i ? 'absolute' : 'relative', marginTop: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32, delay: fanned ? i * 0.03 : 0 }}
                  onClick={() => openOne(n)}>
                  <i className="notif-dot" />
                  <span><b>{n.title}</b><small>{n.message}</small><small className="muted">{fmtShort(n.created_at)}</small></span>
                </motion.button>
              ))}
            </div>
            <Link className="notif-all" to="/notifications" onClick={() => setOpen(false)}>See all notifications <ArrowRight size={14} /></Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
