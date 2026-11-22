// Compatibility layer: the app reads themes through here. The real system lives in src/themes
// (types, families, catalogue, registry, apply). `Theme` is a resolved theme: every value filled.
import { allThemes, resolveTheme, DEFAULT_PREFS, applyTheme, type ResolvedTheme, type DisplayPrefs } from '../themes'

export type Theme = ResolvedTheme
export { applyTheme }
export const THEMES = () => allThemes().map(t => resolveTheme(t.id, DEFAULT_PREFS))
export const themeByKey = (k?: string | null, prefs: DisplayPrefs = DEFAULT_PREFS) => resolveTheme(k || '', prefs)

// Meaning colours come from the theme (and the colour-blind-safe preference), so a P1 always
// reads as urgent in that theme. CSS can use var(--p1)…var(--p4).
export const PRIORITY_COLOR: Record<string, string> = { P1: 'var(--p1)', P2: 'var(--p2)', P3: 'var(--p3)', P4: 'var(--p4)' }
export const priorityHex = (p: string | null | undefined, t: Theme) => t.status[(p as 'P1') || 'P3'] || t.status.P3

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'New', CLASSIFIED: 'Classified', ASSIGNED: 'Assigned', ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress', PENDING_INFO: 'Waiting for info', RESOLVED: 'Resolved', VERIFIED: 'Verified',
  CLOSED: 'Closed', REOPENED: 'Reopened', ESCALATED: 'Escalated',
}
export const statusLabel = (s: string) => STATUS_LABEL[s] || s.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase())
