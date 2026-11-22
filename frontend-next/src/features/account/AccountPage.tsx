// Account and security: profile, password, the authenticator app (two-step sign-in) with
// backup codes, email preferences, other devices, and recent sign-in activity.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bell, Copy, Download, KeyRound, Laptop, LogOut, Palette, ShieldCheck, Smartphone, User as UserIcon } from 'lucide-react'
import { api, ApiError, useQuery, setCached, type AccountOverview, type TwoFactorSetup } from '../../api'
import { useAuth } from '../../lib/auth'
import { dateTime, ROLE_LABEL, timeAgo } from '../../lib/format'
import { Avatar, Button, Field, Input, Section, Skeleton, Switch } from '../../ui/Controls'
import { Dialog, useConfirm } from '../../ui/Overlay'
import { openAppearance } from '../../components/ThemePicker'

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: UserIcon }, { id: 'security', label: 'Sign-in and security', icon: ShieldCheck },
  { id: 'notifications', label: 'Email', icon: Bell }, { id: 'devices', label: 'Devices and activity', icon: Laptop }, { id: 'look', label: 'Appearance', icon: Palette },
]
const device = (ua?: string | null) => !ua ? 'Unknown device' : `${/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'}, ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'}`

export default function AccountPage() {
  const { setUser, adoptResult } = useAuth()
  const { data: a, reload } = useQuery<AccountOverview>('account', () => api.account.overview())
  const [active, setActive] = useState('profile')
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-30% 0px -60% 0px' })
    SECTIONS.forEach(s => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [a])
  if (!a) return <main className="page page-narrow"><Skeleton h={300} r={24} /></main>
  const u = a.user
  const refresh = (fresh?: Partial<AccountOverview>) => { if (fresh) setCached('account', { ...a, ...fresh }); void reload() }

  return (
    <main className="page page-settings">
      <header className="page-head"><div><h1>Account and security</h1><p>{u.email} · {ROLE_LABEL[u.role]}{a.created_at ? ` · since ${dateTime(a.created_at).split(',')[0]}` : ''}</p></div></header>
      <div className="settings">
        <nav className="settings-nav" aria-label="Sections">
          {SECTIONS.map(s => <a key={s.id} href={`#${s.id}`} data-on={active === s.id || undefined} onClick={e => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }) }}><s.icon size={16} />{s.label}</a>)}
        </nav>
        <div className="settings-body">
          <Section id="profile" title="Profile" className="surface pad"><Profile a={a} onSaved={u2 => { setUser(u2); refresh({ user: u2 }) }} /></Section>
          <Section id="security" title="Sign-in and security" className="surface pad">
            <Password a={a} onDone={s => { adoptResult(s); refresh() }} />
            <TwoFactor a={a} onChange={() => refresh()} />
          </Section>
          <Section id="notifications" title="Email" className="surface pad">
            <Switch checked={a.preferences.email_notifications} label="Email me about my incidents" hint="Assignments, fixes and SLA alerts. Security alerts are always sent."
              onChange={v => api.account.updatePreferences({ email_notifications: v }).then(r => { refresh({ preferences: r.preferences }); toast.success(v ? 'Emails on' : 'Emails off') }).catch(e => toast.error(e.message))} />
          </Section>
          <Section id="devices" title="Devices and activity" className="surface pad"
            action={<SignOutOthers onDone={s => { adoptResult(s); refresh() }} />}>
            <ul className="activity-log">
              {a.activity.map(e => (
                <li key={e.id} data-bad={/failed/.test(e.event) || undefined}>
                  <span className="act-icon">{/2fa|backup/.test(e.event) ? <Smartphone size={15} /> : /password/.test(e.event) ? <KeyRound size={15} /> : /signed_out/.test(e.event) ? <LogOut size={15} /> : <Laptop size={15} />}</span>
                  <span><b>{e.label}</b><small>{[e.method_label && `with ${e.method_label}`, device(e.user_agent), e.ip].filter(Boolean).join(' · ')}</small></span>
                  <time title={dateTime(e.at)}>{timeAgo(e.at)}</time>
                </li>
              ))}
              {!a.activity.length && <li className="muted">No activity yet.</li>}
            </ul>
          </Section>
          <Section id="look" title="Appearance" hint="Your theme follows you to every device you sign in on." className="surface pad">
            <Button icon={<Palette size={16} />} onClick={openAppearance}>Open appearance settings</Button>
          </Section>
        </div>
      </div>
    </main>
  )
}

function Profile({ a, onSaved }: { a: AccountOverview; onSaved: (u: AccountOverview['user']) => void }) {
  const [name, setName] = useState(a.user.name); const [phone, setPhone] = useState(a.user.phone || ''); const [busy, setBusy] = useState(false)
  const dirty = name.trim() !== a.user.name || phone.trim() !== (a.user.phone || '')
  const save = async () => {
    setBusy(true)
    try { const r = await api.account.updateProfile({ name: a.google_linked ? undefined : name.trim(), phone: phone.trim() }); onSaved(r.user); toast.success('Profile saved') }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <div className="profile">
      <Avatar name={a.user.name} src={a.user.picture} size={64} />
      <div className="form">
        <div className="grid-2">
          <Field label="Name" hint={a.google_linked ? 'Comes from your Google account.' : undefined}><Input value={name} disabled={a.google_linked} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Phone" optional hint="Technicians can call you about a visit."><Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Email"><Input value={a.user.email} disabled /></Field>
          {a.user.student_id && <Field label="Student ID"><Input value={a.user.student_id} disabled /></Field>}
        </div>
        <div><Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>Save profile</Button></div>
      </div>
    </div>
  )
}

function Password({ a, onDone }: { a: AccountOverview; onDone: (s: Awaited<ReturnType<typeof api.account.changePassword>>) => void }) {
  const [open, setOpen] = useState(false); const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const strong = next.length >= 8 && /[A-Za-z]/.test(next) && /\d/.test(next)
  const save = async () => {
    setBusy(true); setErr(null)
    try { onDone(await api.account.changePassword({ current_password: a.password_set ? cur : undefined, new_password: next })); toast.success('Password changed. Other devices were signed out.'); setOpen(false); setCur(''); setNext('') }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not change the password') } finally { setBusy(false) }
  }
  return (
    <div className="set-row">
      <span className="set-icon"><KeyRound size={18} /></span>
      <div><b>Password</b><small>{a.password_set ? 'Use at least 8 characters with letters and numbers.' : 'You sign in with Google. Set a password to sign in without it too.'}</small></div>
      <Button onClick={() => setOpen(true)}>{a.password_set ? 'Change' : 'Set a password'}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={a.password_set ? 'Change password' : 'Set a password'} size="sm"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><Button variant="primary" busy={busy} disabled={!strong || (a.password_set && !cur)} onClick={save}>Save</Button></>}>
        <div className="form">
          {a.password_set && <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></Field>}
          <Field label="New password" hint={next && !strong ? 'At least 8 characters, with letters and numbers.' : 'Other devices will be signed out.'} error={err}>
            <Input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

function TwoFactor({ a, onChange }: { a: AccountOverview; onChange: () => void }) {
  const tf = a.two_factor
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [ask, setAsk] = useState<'disable' | 'codes' | null>(null)
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const start = async () => { setErr(null); setCode(''); try { setSetup(await api.account.startTwoFactor()) } catch (e) { toast.error((e as Error).message) } }
  const confirm = async () => {
    setBusy(true); setErr(null)
    try {
      if (setup) { const r = await api.account.enableTwoFactor(code.trim()); setSetup(null); setCodes(r.backup_codes); toast.success('Two-step sign-in is on') }
      else if (ask === 'disable') { await api.account.disableTwoFactor(code.trim()); setAsk(null); toast.success('Two-step sign-in is off') }
      else if (ask === 'codes') { const r = await api.account.newBackupCodes(code.trim()); setAsk(null); setCodes(r.backup_codes) }
      setCode(''); onChange()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'That code didn’t work') } finally { setBusy(false) }
  }
  const save = () => {
    const blob = new Blob([`BITS reports backup codes (${a.user.email})\nEach code works once.\n\n${codes!.join('\n')}\n`], { type: 'text/plain' })
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'bits-reports-backup-codes.txt'; link.click()
  }
  return (
    <>
      <div className="set-row">
        <span className="set-icon" data-ok={tf.enabled || undefined}><Smartphone size={18} /></span>
        <div><b>Authenticator app {tf.enabled ? <em className="badge ok">On</em> : tf.required ? <em className="badge warn">Required</em> : null}</b>
          <small>{tf.enabled ? `After your password you enter a code from your phone. ${tf.backup_codes_left} backup code${tf.backup_codes_left === 1 ? '' : 's'} left.` : 'A 6-digit code from an app like Google Authenticator after your password.'}</small></div>
        {tf.enabled ? <span className="row-actions"><Button onClick={() => { setAsk('codes'); setCode(''); setErr(null) }}>New backup codes</Button>{!tf.required && <Button variant="quiet" onClick={() => { setAsk('disable'); setCode(''); setErr(null) }}>Turn off</Button>}</span>
          : <Button variant="primary" onClick={start}>Set up</Button>}
      </div>
      <Dialog open={!!setup} onClose={() => setSetup(null)} title="Set up the authenticator app" size="md"
        footer={<><button className="btn" onClick={() => setSetup(null)}>Cancel</button><Button variant="primary" busy={busy} disabled={code.trim().length < 6} onClick={confirm}>Turn on</Button></>}>
        {setup && <div className="tf-setup">
          <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr_svg }} aria-label="QR code for the authenticator app" />
          <ol>
            <li>Open Google Authenticator, Microsoft Authenticator or 1Password and add an account.</li>
            <li>Scan this code. Can’t scan? Enter the key: <code className="tabular">{setup.secret}</code></li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <Field error={err}><Input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" /></Field>
        </div>}
      </Dialog>
      <Dialog open={!!ask} onClose={() => setAsk(null)} title={ask === 'disable' ? 'Turn off two-step sign-in' : 'Make new backup codes'} size="sm"
        description={ask === 'codes' ? 'Your old backup codes stop working.' : 'Only your password will be needed to sign in.'}
        footer={<><button className="btn" onClick={() => setAsk(null)}>Cancel</button><Button variant={ask === 'disable' ? 'danger' : 'primary'} busy={busy} disabled={code.trim().length < 6} onClick={confirm}>{ask === 'disable' ? 'Turn off' : 'Make new codes'}</Button></>}>
        <Field label={ask === 'codes' ? 'Code from your authenticator app' : 'Code from your app, or a backup code'} error={err}>
          <Input className="code-input" autoFocus value={code} onChange={e => setCode(e.target.value.trim())} /></Field>
      </Dialog>
      <Dialog open={!!codes} onClose={() => setCodes(null)} title="Save your backup codes" size="sm" description="If you lose your phone, each code signs you in once. Keep them somewhere safe."
        footer={<><Button icon={<Copy size={15} />} onClick={() => navigator.clipboard?.writeText(codes!.join('\n')).then(() => toast.success('Copied'))}>Copy</Button>
          <Button icon={<Download size={15} />} onClick={save}>Download</Button><Button variant="primary" onClick={() => setCodes(null)}>I’ve saved them</Button></>}>
        <ul className="codes tabular">{codes?.map(c => <li key={c}>{c}</li>)}</ul>
      </Dialog>
    </>
  )
}

function SignOutOthers({ onDone }: { onDone: (s: Awaited<ReturnType<typeof api.account.signOutOthers>>) => void }) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!await confirm({ title: 'Sign out everywhere else?', body: 'Every other browser and phone signed in to your account will have to sign in again. This one stays signed in.', confirm: 'Sign out others', danger: true })) return
    setBusy(true)
    try { onDone(await api.account.signOutOthers()); toast.success('Other devices were signed out') } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <Button busy={busy} icon={<LogOut size={15} />} onClick={go}>Sign out other devices</Button>
}
