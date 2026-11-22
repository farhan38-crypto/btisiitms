import { useSyncExternalStore } from 'react'

function mq(query: string) {
  const m = typeof window !== 'undefined' ? window.matchMedia(query) : null
  return {
    get: () => !!m?.matches,
    sub: (f: () => void) => { m?.addEventListener('change', f); return () => m?.removeEventListener('change', f) },
  }
}
const phone = mq('(max-width: 760px)')
const fine = mq('(pointer: fine)')
/** Phone layout: bottom tab bar, sheets instead of popovers. Matches the CSS breakpoint. */
export const useIsPhone = () => useSyncExternalStore(phone.sub, phone.get, () => false)
export const useFinePointer = () => useSyncExternalStore(fine.sub, fine.get, () => true)
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
