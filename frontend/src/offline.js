// Offline reporting: "You can't report that the Wi-Fi is down if the Wi-Fi is down."
//
// When a report can't reach the server, it is kept in this browser (localStorage) and sent
// automatically as soon as the connection comes back. Voice notes / photos picked for the
// report travel with it when they fit in storage.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { WifiOff, CloudUpload } from 'lucide-react';
import api, { errMsg } from './api';
import { island } from './components/nyxhora';
import { AnimatePresence, motion, DURATION, EASE_OUT } from './motion';

const KEY = 'bits-offline-reports';
const CHANGED = 'bits:offline-queue-changed';

export function readQueue() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function writeQueue(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CHANGED));
}

// True when an axios error means "no connection" rather than "the server said no".
export const isNetworkFailure = err => !navigator.onLine || (err && err.request && !err.response);

export function queueReport(payload, attachments = []) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, queued_at: new Date().toISOString(), payload, attachments };
  try {
    writeQueue([...readQueue(), item]);
    return { ok: true, withAttachments: attachments.length > 0 };
  } catch {
    // Storage full (large photos): keep the report itself, drop the files.
    writeQueue([...readQueue(), { ...item, attachments: [] }]);
    return { ok: true, withAttachments: false };
  }
}

export async function uploadAttachments(incidentId, attachments) {
  for (const a of attachments) {
    try { await api.post(`/incidents/${incidentId}/attachments`, a); } catch (e) {
      toast.error(`A file could not be attached: ${errMsg(e) || 'upload failed'}`);
    }
  }
}

let flushing = false;
export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  const items = readQueue();
  if (!items.length) return;
  flushing = true;
  try {
    for (const item of items) {
      try {
        // Anything that was worth saving offline is sent even if it looks like a duplicate.
        const r = await api.post('/incidents', { ...item.payload, acknowledge_duplicate: true });
        await uploadAttachments(r.data.id, item.attachments || []);
        writeQueue(readQueue().filter(x => x.id !== item.id));
        island.push({ title: `Saved report sent as ${r.data.number}`, subtitle: item.payload.title, icon: CloudUpload,
          tone: 'success', to: `/incidents/${r.data.id}`, actionLabel: `Open ${r.data.number}` });
      } catch (e) {
        if (isNetworkFailure(e)) break;                // still offline: try again later
        writeQueue(readQueue().filter(x => x.id !== item.id));
        toast.error(`A saved report could not be sent: ${errMsg(e) || 'rejected by the server'}`,
          { description: `"${item.payload.title}" — please file it again.`, duration: 10000 });
      }
    }
  } finally {
    flushing = false;
  }
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function useQueueCount() {
  const [count, setCount] = useState(() => readQueue().length);
  useEffect(() => {
    const update = () => setCount(readQueue().length);
    window.addEventListener(CHANGED, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(CHANGED, update); window.removeEventListener('storage', update); };
  }, []);
  return count;
}

// Banner at the top of the app + automatic sending when the connection returns.
export function OfflineBanner() {
  const online = useOnline();
  const pending = useQueueCount();
  const send = useCallback(() => flushQueue(), []);
  useEffect(() => { if (online) send(); }, [online, send]);
  const show = !online || pending > 0;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div className={`offline-banner${online ? ' pending' : ''}`} role="status"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}>
          {online ? <CloudUpload size={17} /> : <WifiOff size={17} />}
          <span>
            {online
              ? <>Sending {pending} saved report{pending === 1 ? '' : 's'}…</>
              : <><b>You're offline.</b> You can still file a report — it's saved on this device and sent automatically when you're back online.{pending > 0 && ` (${pending} waiting)`}</>}
          </span>
          {online && pending > 0 && <button type="button" className="secondary small" onClick={send}>Retry now</button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// App-shell caching so the site opens without a connection (production builds only;
// the dev server rebuilds constantly, so caching there would show stale code).
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
