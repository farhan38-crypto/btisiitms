// Board view for staff: drag an incident card to the next column to move it along its lifecycle.
// The server's State pattern still decides what is allowed; an illegal move bounces back with the reason.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Home, Building2, Wifi, UserRound } from 'lucide-react';
import api, { errMsg } from '../api';
import { timeLeft } from './common';
import { motion, LayoutGroup, DURATION, EASE_OUT } from '../motion';
import { celebrate } from '../interactions';
import { GlowingEffect } from './effects';

const COLUMNS = [
  { key: 'NEW', title: 'New', hint: 'Waiting for a technician', statuses: ['NEW', 'CLASSIFIED'], color: 'var(--c-violet)' },
  { key: 'ASSIGNED', title: 'Assigned', hint: 'Drop here to claim', statuses: ['ASSIGNED'], color: 'var(--c-sky)' },
  { key: 'ACKNOWLEDGED', title: 'Acknowledged', hint: 'Seen, not started', statuses: ['ACKNOWLEDGED'], color: 'var(--c-teal)' },
  { key: 'IN_PROGRESS', title: 'In progress', hint: 'Being worked on', statuses: ['IN_PROGRESS'], color: 'var(--c-magenta)' },
  { key: 'PENDING_INFO', title: 'Waiting for student', hint: 'More info requested', statuses: ['PENDING_INFO'], color: 'var(--c-sun)' },
  { key: 'RESOLVED', title: 'Resolved', hint: 'Drop to resolve', statuses: ['RESOLVED', 'VERIFIED'], color: 'var(--c-lime)' }
];
const columnOf = status => COLUMNS.find(c => c.statuses.includes(status))?.key;

export default function KanbanBoard({ incidents, user, onChanged }) {
  const nav = useNavigate();
  const [moved, setMoved] = useState({});          // optimistic status per incident id
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const isAdmin = user.role === 'admin';
  useEffect(() => { setMoved({}); }, [incidents]);       // fresh data from the server replaces optimistic moves

  const cards = useMemo(() => incidents
    .filter(i => i.status !== 'CLOSED')
    .map(i => ({ ...i, status: moved[i.id] || i.status })), [incidents, moved]);

  const move = async (card, colKey) => {
    const from = columnOf(card.status);
    if (!card || from === colKey) return;
    if (colKey === 'NEW') { toast.error('An incident cannot go back to "New".'); return; }
    if (colKey === 'RESOLVED') { nav(`/incidents/${card.id}?resolve=1`); return; }
    const optimistic = colKey === 'ASSIGNED' ? 'ASSIGNED' : colKey;
    setMoved(m => ({ ...m, [card.id]: optimistic }));
    try {
      if (colKey === 'ASSIGNED') {
        if (card.assigned_to) throw new Error(`${card.number} already has a technician.`);
        if (isAdmin) await api.post(`/incidents/${card.id}/auto-assign`);
        else await api.post(`/incidents/${card.id}/assign`, { technician_id: user.id });
        toast.success(isAdmin ? `${card.number} dispatched` : `You claimed ${card.number}`);
      } else {
        await api.post(`/incidents/${card.id}/transition`, { target_status: colKey });
        toast.success(`${card.number} → ${COLUMNS.find(c => c.key === colKey).title}`);
        if (colKey === 'IN_PROGRESS' && from === 'PENDING_INFO') celebrate();
      }
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e) || e.message || 'That move is not allowed');
      setMoved(m => { const n = { ...m }; delete n[card.id]; return n; });   // bounce back
    }
  };

  const onDrop = (e, colKey) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/incident-id');
    const card = cards.find(c => c.id === id);
    setDragging(null);
    if (card) move(card, colKey);
  };

  return (
    <LayoutGroup>
      <div className="kanban" role="list" aria-label="Incident board">
        {COLUMNS.map(col => {
          const items = cards.filter(c => col.statuses.includes(c.status));
          const blocked = dragging && col.key === 'NEW';
          return (
            <section key={col.key} className={`kanban-col${over === col.key ? ' over' : ''}${blocked ? ' blocked' : ''}`}
              style={{ '--col': col.color }} aria-label={col.title}
              onDragOver={e => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== col.key) setOver(col.key); } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(o => (o === col.key ? null : o)); }}
              onDrop={e => onDrop(e, col.key)}>
              <div className="kanban-head">
                <span>{col.title}<small>{col.hint}</small></span>
                <motion.span key={items.length} className="count" initial={{ scale: 1.4 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}>{items.length}</motion.span>
              </div>
              {items.map(i => (
                <motion.div key={i.id} layoutId={`card-${i.id}`} layout transition={{ duration: DURATION.slow, ease: EASE_OUT }}
                  className={`kanban-card${dragging === i.id ? ' dragging' : ''}`} data-p={i.priority} role="listitem"
                  draggable onDragStart={e => { e.dataTransfer.setData('text/incident-id', i.id); e.dataTransfer.effectAllowed = 'move'; setDragging(i.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}>
                  <GlowingEffect spread={30} proximity={24} borderWidth={2} movementDuration={1.2} />
                  <b>{i.number} · {i.priority}</b>
                  <Link to={`/incidents/${i.id}`} draggable={false}><p>{i.title}</p></Link>
                  <small>
                    {i.location?.type === 'hostel' ? <Home size={12} /> : i.location?.type === 'academics' ? <Building2 size={12} /> : <Wifi size={12} />}{' '}
                    {i.location?.formatted || 'Online'}
                  </small>
                  {/* Phones can't drag: a small "Move to" menu does the same job. */}
                  <select className="kanban-move" value="" aria-label={`Move ${i.number} to`}
                    onChange={e => { const target = e.target.value; e.target.value = ''; if (target) move(i, target); }}>
                    <option value="">Move to…</option>
                    {COLUMNS.filter(c => c.key !== 'NEW' && !c.statuses.includes(i.status)).map(c => <option key={c.key} value={c.key}>{c.title}</option>)}
                  </select>
                  <small><UserRound size={12} /> {i.assigned_name || 'Unassigned'}{i.sla?.resolution_due_at && !i.sla?.resolved_at ? ` · ${timeLeft(i.sla.resolution_due_at)}` : ''}</small>
                </motion.div>
              ))}
              {!items.length && <div className="kanban-empty">{dragging ? 'Drop here' : 'Nothing here'}</div>}
            </section>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
