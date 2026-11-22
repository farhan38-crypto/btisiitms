// Light / dark switch: goes to the light theme used last (Paper if none yet) and back to the
// dark theme used before, so each side keeps its own choice. Turns off "Match this device".
import { AnimatePresence, motion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useAuth } from '../lib/auth'
import { hasTheme, resolveTheme } from '../themes'

export function useSchemeToggle() {
  const { theme, prefs, setTheme } = useAuth()
  const dark = theme.scheme === 'dark'
  const toggle = (e?: MouseEvent) => {
    const want = dark ? 'light' : 'dark'
    let last: string | null = null
    try { last = localStorage.getItem(`bits_last_${want}`) } catch { /* ignore */ }
    const fallback = want === 'light' ? prefs.auto_light || 'paper' : prefs.auto_dark || 'aurora'
    const pick = [last, fallback, want === 'light' ? 'paper' : 'aurora'].find(id => hasTheme(id) && resolveTheme(id!).scheme === want)!
    setTheme(pick, e ? { x: e.clientX, y: e.clientY } : undefined)
  }
  return { dark, toggle }
}

export function SchemeToggle({ className }: { className?: string }) {
  const { dark, toggle } = useSchemeToggle()
  const label = dark ? 'Switch to a light theme' : 'Switch to a dark theme'
  return (
    <button type="button" className={`icon-btn scheme-toggle ${className || ''}`} onClick={toggle} aria-label={label} title={label}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? 'moon' : 'sun'} initial={{ rotate: -90, scale: .5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: .5, opacity: 0 }} transition={{ duration: .25, ease: [0.22, 1, 0.36, 1] }} style={{ display: 'grid' }}>
          {dark ? <Moon size={18} /> : <Sun size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
