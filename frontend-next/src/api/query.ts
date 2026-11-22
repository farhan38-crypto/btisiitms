// A small data cache for React, so pages share responses and refresh together.
//
//   const { data, error, loading, reload } = useQuery('incidents?open', () => incidents.list({...}))
//
// Keys are plain strings. invalidate('incident') refetches every mounted query whose
// key starts with "incident" (live updates use this). Data stays on screen while it
// refreshes, so lists never blink.
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react'

interface Entry<T = unknown> {
  data?: T; error?: unknown; loading: boolean; updatedAt: number
  promise?: Promise<void>; fetcher?: () => Promise<T>; subs: Set<() => void>; version: number
}
const cache = new Map<string, Entry>()
const EMPTY: Entry = { loading: false, updatedAt: 0, subs: new Set(), version: 0 }

function entry(key: string): Entry {
  let e = cache.get(key)
  if (!e) { e = { loading: false, updatedAt: 0, subs: new Set(), version: 0 }; cache.set(key, e) }
  return e
}
function notify(e: Entry) { e.version++; e.subs.forEach(f => f()) }

async function run<T>(key: string, fetcher: () => Promise<T>) {
  const e = entry(key) as Entry<T>
  e.fetcher = fetcher
  if (e.promise) return e.promise
  e.loading = true; notify(e)
  e.promise = fetcher().then(
    data => { e.data = data; e.error = undefined },
    err => { if ((err as Error)?.name !== 'AbortError') e.error = err },
  ).finally(() => { e.loading = false; e.updatedAt = Date.now(); e.promise = undefined; notify(e) })
  return e.promise
}

export interface QueryOptions { staleMs?: number; pollMs?: number }

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: QueryOptions = {}) {
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const stale = opts.staleMs ?? 15_000
  const subscribe = useCallback((f: () => void) => {
    if (!key) return () => {}
    const e = entry(key); e.subs.add(f)
    return () => { e.subs.delete(f) }
  }, [key])
  const getVersion = () => (key ? entry(key).version : 0)
  useSyncExternalStore(subscribe, getVersion, getVersion)
  const e = (key ? entry(key) : EMPTY) as Entry<T>

  useEffect(() => {
    if (!key) return
    const en = entry(key)
    en.fetcher = () => fetchRef.current()
    if (!en.promise && (en.updatedAt === 0 || Date.now() - en.updatedAt > stale)) void run(key, () => fetchRef.current())
  }, [key, stale])

  useEffect(() => {
    if (!key || !opts.pollMs) return
    const t = window.setInterval(() => { if (!document.hidden) void run(key, () => fetchRef.current()) }, opts.pollMs)
    return () => window.clearInterval(t)
  }, [key, opts.pollMs])

  const reload = useCallback(() => (key ? run(key, () => fetchRef.current()) : Promise.resolve()), [key])
  const set = useCallback((updater: T | ((prev: T | undefined) => T | undefined)) => {
    if (!key) return
    const en = entry(key) as Entry<T>
    en.data = typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(en.data) : updater
    notify(en)
  }, [key])
  return { data: e.data, error: e.error, loading: e.loading && e.data === undefined, refreshing: e.loading, reload, set }
}

/** Refetch every mounted query whose key starts with one of the prefixes (others are marked stale). */
export function invalidate(...prefixes: string[]) {
  for (const [key, e] of cache) {
    if (!prefixes.some(p => key === p || key.startsWith(p))) continue
    if (e.subs.size && e.fetcher) void run(key, e.fetcher)
    else e.updatedAt = 0
  }
}
/** Put a fresh value straight into the cache (after a mutation returned it). */
export function setCached<T>(key: string, data: T) { const e = entry(key); e.data = data; e.updatedAt = Date.now(); notify(e) }
export function clearCache() { cache.clear() }

/** Run a change, with loading and error state, then invalidate the given keys. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const state = useRef({ pending: false })
  const [, force] = useForce()
  const mutate = useCallback(async (...args: A) => {
    state.current.pending = true; force()
    try { return await fnRef.current(...args) } finally { state.current.pending = false; force() }
  }, [force])
  return { mutate, pending: state.current.pending }
}

function useForce() { return useReducer((x: number) => x + 1, 0) }
