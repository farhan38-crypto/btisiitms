// Crashes and connectivity. Render errors show a calm screen with a reference the person can
// quote; every unexpected error is sent to the backend (POST /client-errors → errors.log).
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, WifiOff } from 'lucide-react'
import { api } from '../api'

const ref = () => Math.random().toString(36).slice(2, 8).toUpperCase()

export function installErrorReporting() {
  window.addEventListener('error', e => {
    if (!e.error) return
    api.clientErrors.report({ kind: 'uncaught', message: String(e.message).slice(0, 2000), stack: e.error?.stack?.slice(0, 8000), url: location.href })
  })
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason as Error | undefined
    if (r?.name === 'AbortError' || (r as { status?: number })?.status) return   // API errors are shown where they happen
    api.clientErrors.report({ kind: 'unhandled-rejection', message: String(r?.message || r).slice(0, 2000), stack: r?.stack?.slice(0, 8000), url: location.href })
  })
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; ref: string }> {
  state = { error: null as Error | null, ref: '' }
  static getDerivedStateFromError(error: Error) { return { error, ref: ref() } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    api.clientErrors.report({ kind: 'render', message: error.message, stack: error.stack?.slice(0, 8000),
      component_stack: info.componentStack?.slice(0, 8000), url: location.href, reference: this.state.ref })
  }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page page-narrow">
        <div className="surface pad crash">
          <h1>This screen ran into a problem</h1>
          <p>It has been reported automatically. If it keeps happening, tell IT support the reference <b className="tabular">{this.state.ref}</b>.</p>
          <div className="row-actions"><button className="btn btn-primary" onClick={() => this.setState({ error: null })}><RotateCcw size={16} />Try again</button>
            <a className="btn" href="/">Go home</a></div>
        </div>
      </main>
    )
  }
}

export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return <div className="banner glass" role="status"><WifiOff size={16} /><span><b>You're offline.</b> Changes can't be saved until the connection is back.</span></div>
}
