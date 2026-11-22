// Sign-in page. Every way in: email + password, Google, student sign-up,
// password reset by email code or authenticator app, and two-step codes (or a backup code).
// Motion only animates transform and opacity (no blur filters), and the 3D object loads after
// the entrance so nothing competes for the first second.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, KeyRound, ShieldCheck, Smartphone, Hash } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, type User } from '../api'
import { useAuth } from '../lib/auth'
import { googleReady, originProblem, startGoogleSignIn, takeGoogleResult } from '../lib/google'

const GlassObject = lazy(() => import('../components/GlassObject'))
export const AFTER_LOGIN_KEY = 'bits-after-login'
const BITS_DOMAIN = '@hyderabad.bits-pilani.ac.in'
const DEMO = [
  { label: 'Admin', email: 'admin@example.com', password: 'ChangeMe@123' },
  { label: 'Technician', email: 'alice.chen@itsm.local', password: 'Tech@1234' },
  { label: 'Student', email: 'f20250051@hyderabad.bits-pilani.ac.in', password: 'Student@1234' },
]
type Mode = 'login' | 'register' | 'mfa' | 'reset-request' | 'reset-confirm' | 'reset-authenticator'
const studentId = (email: string) => { const p = email.split('@')[0] || ''; return p.match(/\d{6,10}/)?.[0] || p.replace(/^[a-zA-Z]+/, '') }
const ease = [0.22, 1, 0.36, 1] as const

export default function Login() {
  const { signIn, verifyTwoFactor, adoptSession, theme } = useAuth()
  const nav = useNavigate(); const loc = useLocation()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [name, setName] = useState(''); const [phone, setPhone] = useState('')
  const [code, setCode] = useState(''); const [newPassword, setNewPassword] = useState('')
  const [mfaToken, setMfaToken] = useState(''); const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [show3d, setShow3d] = useState(false)
  const [ready3d, setReady3d] = useState(false)
  const onReady3d = useCallback(() => setReady3d(true), [])

  // Remember where the person was going, and come back there after signing in.
  useEffect(() => { if (!['/', '/login'].includes(loc.pathname)) sessionStorage.setItem(AFTER_LOGIN_KEY, loc.pathname + loc.search) }, [loc.pathname, loc.search])
  const done = (u: User) => {
    toast.success(`Welcome, ${u.name.split(' ')[0]}`)
    const to = sessionStorage.getItem(AFTER_LOGIN_KEY); sessionStorage.removeItem(AFTER_LOGIN_KEY)
    nav(to || '/', { replace: true })
  }
  // The 3D object starts once the page has settled.
  useEffect(() => {
    if (!theme.effects.object3d) return
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: object) => number }).requestIdleCallback
    // after the title and card have finished animating in (~1 s)
    const t = window.setTimeout(() => idle ? idle(() => setShow3d(true), { timeout: 800 }) : setShow3d(true), 1100)
    return () => clearTimeout(t)
  }, [theme.effects.object3d])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }
  const submitLogin = (e?: FormEvent, creds?: { email: string; password: string }) => { e?.preventDefault(); return run(async () => {
    const r = await signIn((creds?.email ?? email).trim(), creds?.password ?? password)
    if (r.mfaRequired) { setMfaToken(r.mfaToken); setCode(''); setBackup(false); setMode('mfa'); return }
    done(r.user)
  }) }
  const submitRegister = (e: FormEvent) => { e.preventDefault(); return run(async () => {
    if (!email.toLowerCase().endsWith(BITS_DOMAIN)) throw new Error(`Use your BITS email (${BITS_DOMAIN}) to sign up.`)
    const r = await api.auth.register({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined })
    adoptSession(r.access_token, r.user); done(r.user)
  }) }
  const submitMfa = (e: FormEvent) => { e.preventDefault(); return run(async () => {
    try {
      const r = await verifyTwoFactor(mfaToken, code.trim())
      if (backup) toast.warning(`Backup code used: ${r.backupCodesLeft} left. Make new ones under Account.`, { duration: 8000 })
      done(r.user)
    } catch (err) { setCode(''); if ((err as { status?: number }).status === 401) { setMode('login'); setMfaToken('') } throw err }
  }) }
  const requestReset = (e: FormEvent) => { e.preventDefault(); return run(async () => {
    const r = await api.auth.requestReset(email.trim())
    toast.success(r.message); setMode('reset-confirm')
  }) }
  const confirmReset = (e: FormEvent) => { e.preventDefault(); return run(async () => {
    const r = await api.auth.confirmReset(email.trim(), code.trim(), newPassword)
    toast.success(r.message); setPassword(''); setCode(''); setMode('login')
  }) }
  const authenticatorReset = (e: FormEvent) => { e.preventDefault(); return run(async () => {
    const r = await api.auth.resetWithAuthenticator(email.trim(), code.trim(), newPassword)
    toast.success(r.message); setPassword(''); setCode(''); setMode('login')
  }) }

  // Back from Google's account chooser: the ID token is in the address bar.
  const googleHandled = useRef(false)
  useEffect(() => {
    if (googleHandled.current) return
    googleHandled.current = true
    const res = takeGoogleResult()
    if (!res) return
    if ('error' in res) { toast.error(res.error); return }
    run(async () => { const r = await api.auth.google(res.credential, res.nonce); adoptSession(r.access_token, r.user); done(r.user) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const on = (e: PageTransitionEvent) => { if (e.persisted) setBusy(false) }; addEventListener('pageshow', on); return () => removeEventListener('pageshow', on) }, [])
  const google = () => {
    if (!googleReady()) { toast.error('Google sign-in is not set up yet (VITE_GOOGLE_CLIENT_ID).'); return }
    const p = originProblem(); if (p) { toast.error(p, { duration: 10000 }); return }
    setBusy(true); startGoogleSignIn()
  }

  const words = 'Campus IT, live.'.split(' ')
  return (
    <main className="login">
      {theme.effects.object3d && <div className="login-object" data-on={ready3d || undefined} aria-hidden>
        {show3d && <Suspense fallback={null}><GlassObject theme={theme} onReady={onReady3d} /></Suspense>}
      </div>}
      <section className="login-copy">
        <motion.img src="/bits-crest.png" alt="BITS Pilani crest" width={56} height={56} className="login-crest"
          initial={{ scale: 0.7, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 20 }} />
        <h1 className="login-title" aria-label="Campus IT, live.">
          {words.map((w, i) => (
            <motion.span key={i} initial={{ y: '0.5em', opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.12 + i * 0.08, duration: 0.6, ease }}>{w}&nbsp;</motion.span>
          ))}
        </h1>
        <motion.p className="login-sub" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: .5, ease }}>
          Report a dead Wi-Fi point or a broken projector. Technicians see every report on a live map of BITS Hyderabad and walk straight to it.
        </motion.p>
      </section>

      <motion.div className="login-card glass" layout transition={{ layout: { duration: .35, ease } }}
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} style={{ originY: 0 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: .22, ease }}>
            {(mode === 'login' || mode === 'register') && <>
              <div className="login-tabs seg glass" role="tablist">
                {(['login', 'register'] as const).map(m => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} data-on={mode === m || undefined} onClick={() => setMode(m)}>
                    {mode === m && <motion.span layoutId="login-tab" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <span>{m === 'login' ? 'Sign in' : 'Student sign-up'}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn google-btn" disabled={busy} onClick={google}><GoogleMark />Continue with Google</button>
              <div className="or"><span>or with email</span></div>
            </>}

            {mode === 'login' && <form onSubmit={submitLogin}>
              <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
              <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>
              <button className="btn btn-primary login-go" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
              <button type="button" className="link-row" onClick={() => { setCode(''); setNewPassword(''); setMode('reset-request') }}><KeyRound size={14} />Forgot password?</button>
            </form>}

            {mode === 'register' && <form onSubmit={submitRegister}>
              <p className="login-note">For BITS Hyderabad students. Staff accounts are made by IT admins.</p>
              <Field label="Full name"><input className="input" value={name} onChange={e => setName(e.target.value)} required placeholder="Aarav Sharma" /></Field>
              <Field label="BITS email"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder={`f2025xxxx${BITS_DOMAIN}`} /></Field>
              {email.toLowerCase().includes('bits-pilani') && <p className="login-hint"><Hash size={13} />Student ID: <b>{studentId(email) || '…'}</b></p>}
              <Field label="Phone (optional)"><input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" /></Field>
              <Field label="Password"><input className="input" type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required placeholder="At least 8 characters" /></Field>
              <button className="btn btn-primary login-go" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<ArrowRight size={16} /></button>
            </form>}

            {mode === 'mfa' && <form onSubmit={submitMfa}>
              <h2 className="login-h"><ShieldCheck size={20} />Two-step sign-in</h2>
              <p className="login-note">{backup ? 'Enter one of the backup codes you saved. Each works once.' : <>Enter the 6-digit code from your authenticator app for <b>BITS reports</b>.</>}</p>
              {backup
                ? <Field label="Backup code"><input className="input" autoFocus maxLength={11} value={code} onChange={e => setCode(e.target.value)} required placeholder="abcde-fghjk" /></Field>
                : <Field label="6-digit code"><input className="input code-input" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required placeholder="123456" /></Field>}
              <button className="btn btn-primary login-go" disabled={busy || !code}>{busy ? 'Checking…' : 'Verify and sign in'}<ArrowRight size={16} /></button>
              <button type="button" className="link-row" onClick={() => { setBackup(b => !b); setCode('') }}>{backup ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}</button>
              <button type="button" className="link-row" onClick={() => setMode('login')}>Back to sign in</button>
            </form>}

            {mode === 'reset-request' && <form onSubmit={requestReset}>
              <h2 className="login-h">Reset your password</h2>
              <p className="login-note">Enter the email on your account. If it’s registered, a six-digit code is sent to it.</p>
              <Field label="Email"><input className="input" type="email" autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
              <button className="btn btn-primary login-go" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}<ArrowRight size={16} /></button>
              <button type="button" className="link-row" onClick={() => { setCode(''); setMode('reset-authenticator') }}><Smartphone size={14} />Use my authenticator app instead</button>
              <button type="button" className="link-row" onClick={() => setMode('login')}>Back to sign in</button>
            </form>}

            {mode === 'reset-confirm' && <form onSubmit={confirmReset}>
              <h2 className="login-h">Enter your reset code</h2>
              <p className="login-note">We sent a six-digit code to <b>{email}</b>. It expires in 10 minutes.</p>
              <Field label="Six-digit code"><input className="input code-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required placeholder="123456" /></Field>
              <Field label="New password"><input className="input" type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="At least 8 characters" /></Field>
              <button className="btn btn-primary login-go" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}<ArrowRight size={16} /></button>
              <button type="button" className="link-row" onClick={() => setMode('reset-request')}>Use a different email</button>
            </form>}

            {mode === 'reset-authenticator' && <form onSubmit={authenticatorReset}>
              <h2 className="login-h">Reset with your authenticator app</h2>
              <p className="login-note">Works if you turned on two-step sign-in. No email needed.</p>
              <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field>
              <Field label="Code from the app (or a backup code)"><input className="input" autoComplete="one-time-code" maxLength={11} value={code} onChange={e => setCode(e.target.value)} required placeholder="123456" /></Field>
              <Field label="New password"><input className="input" type="password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="At least 8 characters" /></Field>
              <button className="btn btn-primary login-go" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}<ArrowRight size={16} /></button>
              <button type="button" className="link-row" onClick={() => setMode('reset-request')}>Use an email code instead</button>
            </form>}
          </motion.div>
        </AnimatePresence>

        {(mode === 'login' || mode === 'register') && (
          <div className="demo">
            <span className="label">Try a demo account</span>
            <div>{DEMO.map(d => <button type="button" key={d.label} className="btn" disabled={busy} onClick={() => { setMode('login'); setEmail(d.email); setPassword(d.password); submitLogin(undefined, d) }}>{d.label}</button>)}</div>
          </div>
        )}
      </motion.div>
    </main>
  )
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="field"><span className="label">{label}</span>{children}</label>
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
)
