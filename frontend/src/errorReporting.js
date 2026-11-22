import React from 'react';
import { API } from './api';

// Browser-side error logging.
// - Crashes and uncaught errors are sent to the backend (POST /api/client-errors)
//   and written to backend/logs/errors.log next to the server's own errors.
// - A crashed page shows a friendly screen with a reference code instead of a
//   blank white page.

const MAX_REPORTS_PER_PAGE_LOAD = 20;
let sentCount = 0;
const recent = new Map(); // message -> time, to avoid reporting the same error in a loop

export const makeReference = () => 'ui-' + Math.random().toString(36).slice(2, 8);

const clip = (text, n) => (text ? String(text).slice(0, n) : undefined);

export function reportClientError({ kind = 'uncaught', message, stack, componentStack, reference, requestId }) {
  try {
    const msg = clip(message || 'Unknown error', 2000);
    const now = Date.now();
    if (sentCount >= MAX_REPORTS_PER_PAGE_LOAD || now - (recent.get(msg) || 0) < 30000) return;
    recent.set(msg, now);
    sentCount += 1;
    const token = localStorage.getItem('itsm_token');
    fetch(`${API}/client-errors`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        kind,
        message: msg,
        stack: clip(stack, 8000),
        component_stack: clip(componentStack, 8000),
        url: clip(window.location.href, 500),
        reference,
        request_id: requestId
      })
    }).catch(() => {});
  } catch {
    // Error reporting must never cause another error.
  }
}

const IGNORED = [/ResizeObserver loop/i, /Script error\.?$/i];

export function installGlobalErrorHandlers() {
  window.addEventListener('error', event => {
    const message = event.error?.message || event.message;
    if (!message || IGNORED.some(r => r.test(message))) return;
    reportClientError({ kind: 'uncaught', message, stack: event.error?.stack });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason?.message || String(reason);
    if (IGNORED.some(r => r.test(message))) return;
    reportClientError({
      kind: 'unhandled-rejection',
      message,
      stack: reason?.stack,
      requestId: reason?.response?.data?.request_id
    });
  });
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reference: null };
  }

  static getDerivedStateFromError(error) {
    return { error, reference: makeReference() };
  }

  componentDidCatch(error, info) {
    console.error(
      `[BITS reports] This page crashed while rendering (reference ${this.state.reference}).\n` +
      'The full report was sent to backend/logs/errors.log.',
      error,
      info?.componentStack
    );
    reportClientError({
      kind: 'render',
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: info?.componentStack,
      reference: this.state.reference
    });
  }

  componentDidUpdate(prevProps) {
    // Navigating to another page clears the error screen.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reference: null });
    }
  }

  render() {
    const { error, reference } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel" role="alert" style={{ maxWidth: 640, margin: this.props.fullPage ? '10vh auto' : '0 auto', padding: 28 }}>
        <span className="eyebrow">SOMETHING WENT WRONG</span>
        <h3 style={{ margin: '6px 0 10px' }}>This page ran into a problem</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          Your data is safe. The error has been recorded for the campus IT team.
          If it keeps happening, share this reference with an administrator: <b>{reference}</b>
        </p>
        <details style={{ marginBottom: 18, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer' }}>Technical details</summary>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{error?.message || String(error)}</pre>
        </details>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="primary" type="button" onClick={() => this.setState({ error: null, reference: null })}>Try again</button>
          <button className="secondary" type="button" onClick={() => window.location.reload()}>Reload page</button>
          <button className="secondary" type="button" onClick={() => window.location.assign('/incidents')}>Go to my reports</button>
        </div>
      </div>
    );
  }
}
