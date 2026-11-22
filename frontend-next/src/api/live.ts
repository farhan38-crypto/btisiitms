// Live updates: GET /api/live/stream is a Server-Sent Events stream. EventSource can't
// send headers, so the token goes in ?token=. The server sends "ready" once, then
// "incident" events (LiveEventObserver) the signed-in user is allowed to see.
//
// Every event refreshes the cached data it affects, so screens stay current without
// polling. Components can also listen with useLive().
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { API_BASE, tokens } from './client'
import { invalidate } from './query'
import type { LiveEvent } from './types'

type Listener = (e: LiveEvent) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null
let state: 'off' | 'connecting' | 'on' = 'off'
let recent: LiveEvent[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

let pending = new Set<string>()
let flushTimer: number | undefined
function schedule(...keys: string[]) {
  keys.forEach(k => pending.add(k))
  window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => { const k = [...pending]; pending = new Set(); invalidate(...k) }, 350)
}

export function startLive() {
  const token = tokens.get()
  if (source || !token) return
  state = 'connecting'; emit()
  source = new EventSource(`${API_BASE}/live/stream?token=${encodeURIComponent(token)}`)
  source.addEventListener('ready', () => { state = 'on'; emit(); schedule('incidents', 'overview', 'notifications') })
  source.addEventListener('incident', (m: MessageEvent) => {
    let ev: LiveEvent
    try { ev = JSON.parse(m.data) } catch { return }
    recent = [ev, ...recent].slice(0, 20); emit()
    schedule('incidents', `incident:${ev.incident_id}`, 'overview', 'trends', 'campus-map', 'notifications', 'my-reports')
    listeners.forEach(l => l(ev))
  })
  source.onerror = () => { state = source?.readyState === EventSource.CLOSED ? 'off' : 'connecting'; emit() }
}
export function stopLive() { source?.close(); source = null; state = 'off'; emit() }
export function restartLive() { stopLive(); startLive() }

export const useLiveState = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => state)
export const useRecentLive = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => recent)

export function useLive(fn: Listener) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    const l: Listener = e => ref.current(e)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
}
