// The map follows the theme: a light (white) map in light themes, a dark map in dark ones.
// People can still flip it with the sun/moon button; that choice is remembered per scheme
// on this device, so a light theme can keep a dark map and vice versa.
import { useSyncExternalStore } from 'react'
const key = (scheme: string) => `bits_map_tone_${scheme}`
const subs = new Set<() => void>()
const scheme = () => document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark'
const read = () => { const s = scheme(); try { const v = localStorage.getItem(key(s)); return v ? v === 'dark' : s === 'dark' } catch { return s === 'dark' } }
let dark = read()
const refresh = () => { const d = read(); if (d !== dark) { dark = d; subs.forEach(f => f()) } }
if (typeof MutationObserver !== 'undefined') new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] })
export const useMapDark = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => dark)
export function setMapDark(v: boolean) { dark = v; try { localStorage.setItem(key(scheme()), v ? 'dark' : 'light') } catch { /* ignore */ } subs.forEach(f => f()) }
