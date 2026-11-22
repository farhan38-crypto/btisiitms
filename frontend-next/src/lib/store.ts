// Tiny shared state without a library: what's being pointed at (so the map, the 3D graph
// and the lists highlight the same incident) and the colour of the glowing page edges.
import { useSyncExternalStore } from 'react'

function createStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => { if (v !== value) { value = v; subs.forEach(f => f()) } },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
  }
}

export const hoverStore = createStore<string | null>(null)
export const useHovered = () => useSyncExternalStore(hoverStore.subscribe, hoverStore.get)

// Ambient colour of the page edges. null = the theme's own colour.
export const ambientStore = createStore<string | null>(null)
export const useAmbient = () => useSyncExternalStore(ambientStore.subscribe, ambientStore.get)
let resetTimer: number | undefined
export function pointAt(id: string | null, colour: string | null) {
  window.clearTimeout(resetTimer)
  hoverStore.set(id)
  if (colour) ambientStore.set(colour)
  else resetTimer = window.setTimeout(() => ambientStore.set(null), 350)
}
