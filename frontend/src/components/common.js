import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { motion, overlayFade, popIn } from '../motion';

export const fmt = x => (x ? new Date(x).toLocaleString() : '');
export const fmtShort = x => (x ? new Date(x).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const roleLabel = r =>
  ({ admin: 'ADMINISTRATOR', technician: 'TECHNICIAN', customer: 'STUDENT', system: 'SYSTEM' }[r] || (r || '').toUpperCase());

export const statusLabel = s => (s || '').replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

export function minutesLabel(min) {
  if (min == null) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 60 * 24) return `${+(min / 60).toFixed(1)} h`;
  const days = +(min / 1440).toFixed(1);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function timeLeft(due) {
  if (!due) return '';
  const ms = new Date(due) - Date.now();
  const abs = Math.abs(ms) / 60000;
  return ms >= 0 ? `${minutesLabel(abs)} left` : `${minutesLabel(abs)} overdue`;
}

export function Badge({ v }) {
  const norm = String(v || '').toLowerCase().replaceAll('_', '-');
  return <span className={`badge ${norm}`}>{v}</span>;
}

export function Loading({ inline }) {
  const bars = <div className="skeleton" style={inline ? { padding: 18 } : undefined}><i /><i /><i /><i /></div>;
  return <div className={inline ? undefined : 'panel'} role="status" aria-label="Loading">{bars}</div>;
}

export function Empty({ text = 'No records found.' }) {
  return <div className="empty">{text}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div className="modal-overlay" onClick={onClose} variants={overlayFade} initial="initial" animate="animate">
      <motion.div className="modal-content" role="dialog" aria-modal="true" aria-label={title}
        style={wide ? { maxWidth: 720, width: '100%' } : undefined} onClick={e => e.stopPropagation()}
        variants={popIn} initial="initial" animate="animate">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const STATUSES = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INFO', 'RESOLVED', 'VERIFIED', 'CLOSED'];
export const SLA_STATUSES = ['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET'];
