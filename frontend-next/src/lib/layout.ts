// The app's layout: how screens are arranged, separate from the colour theme.
//   classic  - the original roomy overview with a big map and charts
//   focused  - a dense overview that fits one screen, one-page reporting
//   material - flat cards, summary numbers and clean charts
//   glass    - the Material arrangement on liquid glass with Classic's motion
// Navigation is a separate choice for every layout: a top bar or a side bar.
// Both are stored per browser; <html data-layout data-nav> lets the stylesheets follow them.
import { useSyncExternalStore } from 'react'

export type Layout = 'classic' | 'focused' | 'material' | 'glass'
export type Nav = 'top' | 'side'
export const LAYOUTS: { id: Layout; label: string; description: string }[] = [
  { id: 'classic', label: 'Classic', description: 'Roomy overview with a big map, charts and glass.' },
  { id: 'focused', label: 'Focused', description: 'A dense overview that fits one screen, one-page reporting.' },
  { id: 'material', label: 'Material', description: 'Flat cards, summary numbers and clean charts.' },
  { id: 'glass', label: 'Glass', description: 'Material’s cards and charts on liquid glass, with motion.' },
]
/** Layouts that share the Material overview and the one-page report. */
export const usesCards = (l: Layout) => l === 'material' || l === 'glass'
const KEY = 'bits_layout', NAV_KEY = 'bits_nav'
const EVENT = 'bits-layout'

function read(): Layout {
  try { const v = localStorage.getItem(KEY); return v === 'focused' || v === 'material' || v === 'glass' ? v : 'classic' } catch { return 'classic' }
}
function readNav(): Nav { try { return localStorage.getItem(NAV_KEY) === 'side' ? 'side' : 'top' } catch { return 'top' } }
function apply() { const r = document.documentElement; r.dataset.layout = read(); r.dataset.nav = readNav() }
apply()

const emit = () => { apply(); window.dispatchEvent(new Event(EVENT)) }
export function setLayout(l: Layout) { try { localStorage.setItem(KEY, l) } catch { /* ignore */ } emit() }
export function setNav(n: Nav) { try { localStorage.setItem(NAV_KEY, n) } catch { /* ignore */ } emit() }
const subscribe = (cb: () => void) => {
  const on = (e: Event) => { if (e.type === EVENT || [KEY, NAV_KEY].includes((e as StorageEvent).key || '')) { apply(); cb() } }
  window.addEventListener(EVENT, on); window.addEventListener('storage', on)
  return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
}
export const useLayout = (): Layout => useSyncExternalStore(subscribe, read, () => 'classic')
export const useNav = (): Nav => useSyncExternalStore(subscribe, readNav, () => 'top')
