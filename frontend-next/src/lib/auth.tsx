// Session and appearance. The access token is kept in localStorage (api/client.ts tokens). The look (theme id + display preferences) is saved with
// the account (appearance.glass_theme / glass_prefs) and follows the person to every device;
// before sign-in the last look used on this device is shown.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, tokens, clearCache, startLive, stopLive, type User, type Session, isMfa } from '../api'
import { applyTheme, resolveTheme, effectiveId, hasTheme, withReveal, AUTO, DEFAULT_THEME, DEFAULT_PREFS, adoptGradients, getGradient, getSavedGradients, useGradientVersion, type DisplayPrefs, type ResolvedTheme } from '../themes'

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false; user: User }
interface AuthCtx {
  user: User | null; ready: boolean
  signIn: (email: string, password: string) => Promise<LoginResult>
  verifyTwoFactor: (mfaToken: string, code: string) => Promise<{ user: User; backupCodesLeft?: number }>
  adoptSession: (token: string, user: User) => void
  adoptResult: (s: Session) => void
  setUser: (u: User) => void
  refresh: () => Promise<void>
  signOut: () => void
  /** The theme on screen (resolved: every colour filled, 'auto' already decided). */
  theme: ResolvedTheme
  /** What the person picked: a theme id or 'auto'. */
  themeId: string
  setTheme: (id: string, from?: { x: number; y: number }) => void
  prefs: DisplayPrefs
  setPrefs: (p: Partial<DisplayPrefs>) => void
  /** Show a theme without saving it (hovering in the picker); null goes back. */
  preview: (id: string | null) => void
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)
export const isStaff = (u: User | null | undefined) => !!u && (u.role === 'admin' || u.role === 'technician')

const THEME_KEY = 'bits_theme', PREFS_KEY = 'bits_theme_prefs', USER_KEY = 'itsm_user'
const readPrefs = (): DisplayPrefs => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return DEFAULT_PREFS } }
const savedId = () => { const v = localStorage.getItem(THEME_KEY) || localStorage.getItem('bits_next_theme'); return hasTheme(v) ? v! : DEFAULT_THEME }

function useSystemDark() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)'); const on = () => setDark(m.matches)
    m.addEventListener('change', on); return () => m.removeEventListener('change', on)
  }, [])
  return dark
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [themeId, setThemeId] = useState(savedId)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(readPrefs)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const systemDark = useSystemDark()
  const gradientVersion = useGradientVersion()
  const theme = useMemo(() => resolveTheme(previewId || effectiveId(themeId, prefs, systemDark), prefs), [previewId, themeId, prefs, systemDark, gradientVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { applyTheme(theme) }, [theme])
  // Remember the last light and the last dark theme chosen, for the light/dark switch.
  useEffect(() => { if (!previewId && themeId !== AUTO) try { localStorage.setItem(`bits_last_${theme.scheme}`, themeId) } catch { /* ignore */ } }, [theme.scheme, themeId, previewId])

  const setUser = useCallback((u: User) => { setUserState(u); localStorage.setItem(USER_KEY, JSON.stringify(u)) }, [])
  const adopt = useCallback((u: User) => {
    setUser(u)
    const a = (u.appearance || {}) as { glass_theme?: string; glass_prefs?: Partial<DisplayPrefs>; gradient?: unknown; saved_gradients?: unknown }
    adoptGradients(a)
    if (hasTheme(a.glass_theme)) { setThemeId(a.glass_theme!); localStorage.setItem(THEME_KEY, a.glass_theme!) }
    if (a.glass_prefs) { const p = { ...DEFAULT_PREFS, ...a.glass_prefs }; setPrefsState(p); localStorage.setItem(PREFS_KEY, JSON.stringify(p)) }
  }, [setUser])

  useEffect(() => {
    const out = () => { setUserState(null); localStorage.removeItem(USER_KEY) }
    window.addEventListener('bits:signed-out', out)
    if (!tokens.get()) setReady(true)
    else api.auth.me().then(adopt).catch(() => {}).finally(() => setReady(true))
    return () => window.removeEventListener('bits:signed-out', out)
  }, [adopt])

  const adoptSession = useCallback((token: string, u: User) => { tokens.set(token); adopt(u); stopLive(); startLive() }, [adopt])
  const adoptResult = useCallback((s: Session) => adoptSession(s.access_token, s.user), [adoptSession])
  const signIn = async (email: string, password: string): Promise<LoginResult> => {
    const r = await api.auth.login(email, password)
    if (isMfa(r)) return { mfaRequired: true, mfaToken: r.mfa_token }
    adoptResult(r)
    return { mfaRequired: false, user: r.user }
  }
  const verifyTwoFactor = async (mfaToken: string, code: string) => {
    const r = await api.auth.loginSecondStep(mfaToken, code)
    adoptResult(r)
    return { user: r.user, backupCodesLeft: r.backup_codes_left }
  }
  const refresh = () => api.auth.me().then(setUser).catch(() => {})
  const signOut = () => {
    api.auth.logout().catch(() => {})
    stopLive(); tokens.clear(); clearCache(); localStorage.removeItem(USER_KEY); setUserState(null)
  }

  // Saving: debounced, so dragging through themes or flipping toggles sends one request.
  const saveTimer = useRef<number | undefined>(undefined)
  const userRef = useRef(user); userRef.current = user
  const save = (id: string, p: DisplayPrefs) => {
    localStorage.setItem(THEME_KEY, id); localStorage.setItem(PREFS_KEY, JSON.stringify(p))
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const u = userRef.current
      if (!u) return
      const gradient = getGradient(), saved_gradients = getSavedGradients()
      const appearance = { ...(u.appearance || {}), theme: (u.appearance as { theme?: string } | null)?.theme || 'original', glass_theme: id, glass_prefs: p, gradient, saved_gradients }
      setUser({ ...u, appearance })
      api.account.saveAppearance({ theme: String(appearance.theme), glass_theme: id, glass_prefs: p as never, gradient, saved_gradients }).catch(() => {})
    }, 500)
  }
  const setTheme = (id: string, from?: { x: number; y: number }) => {
    const next = id === AUTO || hasTheme(id) ? id : DEFAULT_THEME
    setPreviewId(null)
    if (next === themeId) return
    withReveal(() => setThemeId(next), from)
    save(next, prefs)
  }
  // Editing or saving a gradient is saved with the account too.
  const firstGradient = useRef(true)
  useEffect(() => { if (firstGradient.current) { firstGradient.current = false; return } save(themeId, prefs) }, [gradientVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const setPrefs = (p: Partial<DisplayPrefs>) => { const next = { ...prefs, ...p }; setPrefsState(next); save(themeId, next) }

  return <Ctx.Provider value={{ user, ready, signIn, verifyTwoFactor, adoptSession, adoptResult, setUser, refresh, signOut,
    theme, themeId, setTheme, prefs, setPrefs, preview: setPreviewId }}>{children}</Ctx.Provider>
}

export const isAdmin = (u: User | null | undefined) => u?.role === 'admin'
