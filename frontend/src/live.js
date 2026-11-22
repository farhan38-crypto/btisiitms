// Live updates: one Server-Sent Events connection per signed-in tab.
// Every incident event the server pushes is re-broadcast as a window event, so any page
// can react with `useLiveIncidentEvents(handler)` without opening its own connection.
import { useEffect, useRef, useState } from 'react';
import { Navigation, MapPinCheck, UserCheck, CheckCircle2, RotateCcw, MessageSquareMore, StickyNote, Paperclip, Inbox, Waves, TimerOff, TrendingUp, Bell } from 'lucide-react';
import { API } from './api';

export const LIVE_EVENT = 'bits:live-incident';

export function useLiveConnection(enabled) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;
    const token = localStorage.getItem('itsm_token');
    if (!token) return undefined;
    const source = new EventSource(`${API}/live/stream?token=${encodeURIComponent(token)}`);
    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('incident', e => {
      try {
        window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail: JSON.parse(e.data) }));
      } catch { /* ignore a malformed message */ }
    });
    source.onerror = () => setConnected(false);       // EventSource reconnects by itself
    return () => { source.close(); setConnected(false); };
  }, [enabled]);
  return connected;
}

// Calls handler(event) for each live incident event. The handler can change between renders.
export function useLiveIncidentEvents(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = e => ref.current?.(e.detail);
    window.addEventListener(LIVE_EVENT, listener);
    return () => window.removeEventListener(LIVE_EVENT, listener);
  }, []);
}

// Friendly toast text for events worth interrupting someone for (null = stay quiet).
export function liveToastText(ev, me) {
  if (!ev || ev.actor_id === me.id) return null;
  const n = ev.number;
  switch (ev.type) {
    case 'TECHNICIAN_EN_ROUTE': return `${ev.actor_name} is on the way for ${n}`;
    case 'TECHNICIAN_ARRIVED': return `${ev.actor_name} has arrived for ${n}`;
    case 'ASSIGNED': return me.role === 'customer' ? `A technician was assigned to ${n}` : `${n} was assigned`;
    case 'RESOLVED': return `${n} was marked resolved`;
    case 'REOPENED': return `${n} was reopened`;
    case 'INFO_REQUESTED': return `More information is needed on ${n}`;
    case 'NOTE_ADDED': return `New note on ${n}`;
    case 'ATTACHMENT_ADDED': return `${ev.description} on ${n}`;
    case 'INCIDENT_CREATED': return me.role === 'customer' ? null : `New report ${n}: ${ev.title}`;
    case 'CORRELATION_DETECTED': return `Possible outage: ${ev.description}`;
    case 'SLA_BREACHED': return `${n} missed its SLA deadline`;
    case 'ESCALATED': return `${n} was escalated`;
    default: return null;
  }
}

// How a live event looks in the Dynamic Island: icon + tone (colour of the glow and dot).
const ISLAND_STYLE = {
  TECHNICIAN_EN_ROUTE: [Navigation, 'info'],
  TECHNICIAN_ARRIVED: [MapPinCheck, 'info'],
  ASSIGNED: [UserCheck, 'default'],
  RESOLVED: [CheckCircle2, 'success'],
  REOPENED: [RotateCcw, 'warning'],
  INFO_REQUESTED: [MessageSquareMore, 'warning'],
  NOTE_ADDED: [StickyNote, 'default'],
  ATTACHMENT_ADDED: [Paperclip, 'default'],
  INCIDENT_CREATED: [Inbox, 'default'],
  CORRELATION_DETECTED: [Waves, 'danger'],
  SLA_BREACHED: [TimerOff, 'danger'],
  ESCALATED: [TrendingUp, 'warning']
};

export function liveIslandItem(ev, me) {
  let title = liveToastText(ev, me);
  if (!title) return null;
  if (ev.title) title = title.replace(`: ${ev.title}`, '');     // the incident title goes underneath
  const [icon, tone] = ISLAND_STYLE[ev.type] || [Bell, 'default'];
  return {
    title, subtitle: ev.title, icon, tone,
    to: ev.incident_id ? `/incidents/${ev.incident_id}` : undefined,
    actionLabel: ev.incident_id ? `Open ${ev.number || 'incident'}` : undefined,
    duration: tone === 'danger' ? 12000 : 7000
  };
}
