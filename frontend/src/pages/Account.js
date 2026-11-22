import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ShieldCheck, ShieldOff, KeyRound, Smartphone, Mail, MonitorSmartphone, History, Copy, Download, LogOut,
  AlertTriangle, UserRound, Save, RefreshCw
} from 'lucide-react';
import api, { errMsg } from '../api';
import { Badge, Loading, Modal, fmtShort, roleLabel } from '../components/common';

// "Chrome on macOS" from a user-agent string (good enough for a security log).
export function describeDevice(ua) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /python|httpx|curl/i.test(ua) ? 'Script' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const BAD_EVENTS = ['login_failed', '2fa_failed'];

export default function Account({ auth }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/account').then(r => setData(r.data))
    .catch(e => toast.error(errMsg(e) || 'Could not load your account')), []);
  useEffect(() => { load(); }, [load]);

  // After a password change or "sign out other devices" the server issues a new token for this device.
  const takeSession = r => { if (r?.data?.access_token) auth.saveSession(r.data.user, r.data.access_token); };

  if (!data) return <Loading />;
  const u = data.user;
  return (
    <>
      <div className="account-page-head">
        <div className="account-avatar large">{(u.name || '?').trim().charAt(0).toUpperCase()}</div>
        <div>
          <span className="eyebrow">ACCOUNT &amp; SECURITY</span>
          <h3>{u.name}</h3>
          <p className="muted small-text">{u.email} · {roleLabel(u.role)}{data.created_at ? ` · member since ${new Date(data.created_at).toLocaleDateString()}` : ''}</p>
        </div>
      </div>

      {data.two_factor.required && !data.two_factor.enabled && (
        <div className="callout warn" role="alert" style={{ marginTop: 0, marginBottom: 18 }}>
          <AlertTriangle size={18} />
          <div><b>Administrators must use an authenticator app.</b> The admin pages stay locked until you turn it on below.</div>
        </div>
      )}

      <div className="grid two">
        <ProfilePanel data={data} onSaved={user => { auth.setUser(user); load(); }} />
        <TwoFactorPanel data={data} onChange={() => { load(); auth.refresh(); }} />
      </div>
      <div className="grid two">
        <PasswordPanel data={data} onChanged={r => { takeSession(r); load(); }} />
        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <PreferencesPanel data={data} onChanged={load} />
          <SessionsPanel onSignedOutOthers={r => { takeSession(r); load(); }} onSignOut={auth.logout} />
        </div>
      </div>
      <ActivityPanel events={data.activity} onRefresh={load} />
    </>
  );
}

// ───────────── profile ─────────────
function ProfilePanel({ data, onSaved }) {
  const u = data.user;
  const [f, setF] = useState({ name: u.name || '', phone: u.phone || '' });
  const [busy, setBusy] = useState(false);
  const dirty = f.name.trim() !== (u.name || '') || f.phone.trim() !== (u.phone || '');
  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.patch('/account/profile', { name: f.name.trim(), phone: f.phone.trim() });
      toast.success('Profile saved');
      onSaved(r.data.user);
    } catch (err) {
      toast.error(errMsg(err) || 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-title-row"><UserRound size={18} /><h3>Profile</h3></div>
      <div className="kv"><span>Email</span><b>{u.email}</b></div>
      <div className="kv"><span>Role</span><b><Badge v={roleLabel(u.role)} /></b></div>
      {u.student_id && <div className="kv"><span>BITS ID</span><b>{u.student_id}</b></div>}
      {u.role === 'technician' && <div className="kv"><span>Skills</span><b>{(u.skills || []).join(' · ') || 'General IT'}</b></div>}
      <div className="modal-form" style={{ marginTop: 14 }}>
        <label>Full name
          <input required maxLength={100} value={f.name} disabled={data.google_linked} onChange={e => setF({ ...f, name: e.target.value })} />
          {data.google_linked && <small className="muted">Your name comes from your Google account.</small>}
        </label>
        <label>Phone number
          <input type="tel" maxLength={30} value={f.phone} placeholder="+91 98765 43210" onChange={e => setF({ ...f, phone: e.target.value })} />
          <small className="muted">Technicians use it to reach you about an on-site visit.</small>
        </label>
      </div>
      <div className="btn-row">
        <button className="primary small" type="submit" disabled={busy || !dirty}><Save size={14} /> {busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </form>
  );
}

// ───────────── password ─────────────
function PasswordPanel({ data, onChanged }) {
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const strongEnough = f.next.length >= 8 && /[A-Za-z]/.test(f.next) && /\d/.test(f.next);
  const submit = async e => {
    e.preventDefault();
    if (f.next !== f.confirm) return toast.error('The new passwords do not match');
    if (!strongEnough) return toast.error('Use at least 8 characters with both letters and numbers');
    setBusy(true);
    try {
      const r = await api.post('/account/password', { current_password: data.password_set ? f.current : undefined, new_password: f.next });
      toast.success('Password changed. Other devices were signed out.');
      setF({ current: '', next: '', confirm: '' });
      onChanged(r);
    } catch (err) {
      toast.error(errMsg(err) || 'Could not change your password');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-title-row"><KeyRound size={18} /><h3>{data.password_set ? 'Change password' : 'Set a password'}</h3></div>
      <p className="muted small-text">
        {data.password_set
          ? 'Changing your password signs you out on every other device.'
          : 'You sign in with Google. Set a password if you also want to sign in with your email address.'}
      </p>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <span className="field-label">Sign-in methods</span>
        {data.password_set && <span className="status-pill on">Password</span>}
        {data.google_linked && <span className="status-pill on">Google</span>}
        {data.two_factor.enabled && <span className="status-pill on">+ Authenticator code</span>}
      </div>
      <div className="modal-form">
        {data.password_set && (
          <label>Current password
            <input type="password" required autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} />
          </label>
        )}
        <label>New password
          <input type="password" required minLength={8} autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} />
          <small className={f.next && !strongEnough ? 'danger-text' : 'muted'}>At least 8 characters, with letters and numbers.</small>
        </label>
        <label>Confirm new password
          <input type="password" required autoComplete="new-password" value={f.confirm} onChange={e => setF({ ...f, confirm: e.target.value })} />
          {f.confirm && f.confirm !== f.next && <small className="danger-text">Does not match.</small>}
        </label>
      </div>
      <div className="btn-row">
        <button className="primary small" type="submit" disabled={busy}>{busy ? 'Saving…' : data.password_set ? 'Change password' : 'Set password'}</button>
      </div>
    </form>
  );
}

// ───────────── authenticator app ─────────────
function TwoFactorPanel({ data, onChange }) {
  const tf = data.two_factor;
  const [modal, setModal] = useState(null);        // 'setup' | 'disable' | 'codes'
  const lowCodes = tf.enabled && tf.backup_codes_left <= 2;
  return (
    <div className="panel">
      <div className="panel-title-row"><Smartphone size={18} /><h3>Two-step sign-in</h3></div>
      <p className="muted small-text">
        After your password, also enter a 6-digit code from an authenticator app such as Google Authenticator,
        Microsoft Authenticator or Authy. Someone who learns your password still cannot sign in.
      </p>
      <div className="kv"><span>Authenticator app</span>
        <b>{tf.enabled
          ? <span className="status-pill on"><ShieldCheck size={13} /> On</span>
          : <span className="status-pill off"><ShieldOff size={13} /> Off</span>}</b>
      </div>
      {tf.enabled && <div className="kv"><span>Turned on</span><b>{fmtShort(tf.enabled_at)}</b></div>}
      {tf.enabled && <div className="kv"><span>Backup codes left</span><b className={lowCodes ? 'danger-text' : undefined}>{tf.backup_codes_left} of 8</b></div>}
      {lowCodes && (
        <div className="callout warn"><AlertTriangle size={16} /><div>You are running out of backup codes. Create new ones so you can still sign in if you lose your phone.</div></div>
      )}
      <div className="btn-row">
        {!tf.enabled && <button className="primary small" onClick={() => setModal('setup')}><ShieldCheck size={14} /> Set up authenticator app</button>}
        {tf.enabled && <button className="secondary small" onClick={() => setModal('codes')}><RefreshCw size={14} /> New backup codes</button>}
        {tf.enabled && !tf.required && <button className="secondary small" onClick={() => setModal('disable')}><ShieldOff size={14} /> Turn off</button>}
      </div>
      {tf.enabled && tf.required && <p className="muted small-text" style={{ marginTop: 10 }}>Required for administrators, so it cannot be turned off.</p>}

      {modal === 'setup' && <SetupModal onClose={() => setModal(null)} onDone={onChange} />}
      {modal === 'disable' && (
        <CodeModal title="Turn off the authenticator app" action="Turn off" allowBackup
          intro="Enter a code from your authenticator app (or a backup code) to confirm. Only your password will then be needed to sign in."
          submit={code => api.post('/account/2fa/disable', { code })}
          onClose={() => setModal(null)} onDone={() => { toast.success('Authenticator app turned off'); setModal(null); onChange(); }} />
      )}
      {modal === 'codes' && <NewCodesModal onClose={() => setModal(null)} onDone={onChange} />}
    </div>
  );
}

function SetupModal({ onClose, onDone }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);

  // Exactly one setup request per modal: a second one would create a new secret
  // and the QR code on screen would no longer match (StrictMode runs effects twice).
  const started = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.post('/account/2fa/setup').then(r => setSetup(r.data))
      .catch(e => { toast.error(errMsg(e) || 'Could not start the setup'); close.current(); });
  }, []);

  const confirm = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/account/2fa/enable', { code });
      setCodes(r.data.backup_codes);
      onDone();
    } catch (err) {
      toast.error(errMsg(err) || 'That code did not work');
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <Modal title="Save your backup codes" onClose={onClose}>
        <BackupCodes codes={codes} />
        <div className="modal-actions"><button className="primary" onClick={onClose}>I have saved them</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Set up your authenticator app" onClose={onClose}>
      {!setup ? <Loading /> : (
        <form className="modal-form" onSubmit={confirm}>
          <ol className="setup-steps">
            <li>Install <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>Authy</b> on your phone.</li>
            <li>In the app, tap <b>+</b> and scan this QR code.</li>
          </ol>
          <img className="qr-box" alt="QR code to add BITS reports to your authenticator app"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`} />
          <details className="manual-key">
            <summary>Can’t scan? Enter this key instead</summary>
            <div className="secret-text">{setup.secret}</div>
            <small className="muted">Account: {setup.account} · Type: time-based</small>
          </details>
          <ol className="setup-steps" start={3}>
            <li>Type the 6-digit code the app now shows for <b>{setup.issuer}</b>.</li>
          </ol>
          <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
            maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" aria-label="6-digit code" />
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Turn on'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function NewCodesModal({ onClose, onDone }) {
  const [codes, setCodes] = useState(null);
  if (codes) {
    return (
      <Modal title="Your new backup codes" onClose={onClose}>
        <p className="muted small-text">Your old backup codes no longer work.</p>
        <BackupCodes codes={codes} />
        <div className="modal-actions"><button className="primary" onClick={onClose}>I have saved them</button></div>
      </Modal>
    );
  }
  return (
    <CodeModal title="Create new backup codes" action="Create codes"
      intro="Enter the current code from your authenticator app. Your old backup codes will stop working."
      submit={code => api.post('/account/2fa/backup-codes', { code })}
      onClose={onClose} onDone={r => { setCodes(r.data.backup_codes); onDone(); }} />
  );
}

function CodeModal({ title, intro, action, allowBackup, submit, onClose, onDone }) {
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(await submit(code.trim()));
    } catch (err) {
      toast.error(errMsg(err) || 'That code did not work');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="modal-form" onSubmit={send}>
        <p className="muted small-text">{intro}</p>
        {backup
          ? <input required autoFocus maxLength={11} value={code} onChange={e => setCode(e.target.value)} placeholder="abcde-fghjk" aria-label="Backup code" className="code-input small" />
          : <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" aria-label="6-digit code" />}
        {allowBackup && (
          <button type="button" className="text-btn" onClick={() => { setBackup(b => !b); setCode(''); }}>
            {backup ? 'Use the authenticator app instead' : 'Use a backup code instead'}
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !code}>{busy ? 'Checking…' : action}</button>
        </div>
      </form>
    </Modal>
  );
}

function BackupCodes({ codes }) {
  const text = `BITS reports backup codes (each works once)\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast.success('Codes copied'); }
    catch { toast.error('Copy is blocked here — select the codes and copy them by hand'); }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'bits-reports-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <p className="small-text">
        If you lose your phone, each of these codes lets you sign in <b>once</b>. Keep them somewhere safe —
        this is the only time they are shown.
      </p>
      <div className="backup-codes">{codes.map(c => <span key={c}>{c}</span>)}</div>
      <div className="btn-row">
        <button type="button" className="secondary small" onClick={copy}><Copy size={14} /> Copy</button>
        <button type="button" className="secondary small" onClick={download}><Download size={14} /> Download .txt</button>
      </div>
    </>
  );
}

// ───────────── preferences ─────────────
function PreferencesPanel({ data, onChanged }) {
  const [busy, setBusy] = useState(false);
  const toggle = async e => {
    const value = e.target.checked;
    setBusy(true);
    try {
      await api.patch('/account/preferences', { email_notifications: value });
      toast.success(value ? 'Email notifications on' : 'Email notifications off');
      onChanged();
    } catch (err) {
      toast.error(errMsg(err) || 'Could not save the preference');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <div className="panel-title-row"><Mail size={18} /><h3>Notifications</h3></div>
      <label className="check-label" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={data.preferences.email_notifications} disabled={busy} onChange={toggle} />
        Email me about my incidents (resolved, SLA missed, escalations)
      </label>
      <p className="muted small-text" style={{ marginTop: 8 }}>
        The bell in the top bar always shows every update. Security alerts — a password change or the authenticator
        being turned on or off — are always emailed.
      </p>
    </div>
  );
}

// ───────────── sessions ─────────────
function SessionsPanel({ onSignedOutOthers, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const signOutOthers = async () => {
    setBusy(true);
    try {
      const r = await api.post('/account/sessions/sign-out-others');
      toast.success('Signed out of all other devices');
      onSignedOutOthers(r);
    } catch (err) {
      toast.error(errMsg(err) || 'Could not sign out other devices');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <div className="panel-title-row"><MonitorSmartphone size={18} /><h3>Devices</h3></div>
      <div className="kv"><span>This device</span><b>{describeDevice(navigator.userAgent)}</b></div>
      <p className="muted small-text" style={{ marginTop: 8 }}>
        Left yourself signed in on a lab computer or a friend’s phone? Sign out everywhere else; this device stays signed in.
      </p>
      <div className="btn-row">
        <button className="secondary small" disabled={busy} onClick={signOutOthers}><LogOut size={14} /> Sign out of all other devices</button>
        <button className="secondary small" onClick={onSignOut}>Sign out here</button>
      </div>
    </div>
  );
}

// ───────────── activity ─────────────
function ActivityPanel({ events, onRefresh }) {
  return (
    <div className="panel">
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="panel-title-row" style={{ marginBottom: 0 }}><History size={18} /><h3>Recent security activity</h3></div>
        <button className="icon-btn small" onClick={onRefresh} title="Refresh" aria-label="Refresh activity"><RefreshCw size={15} /></button>
      </div>
      <p className="muted small-text">Sign-ins and account changes from the last 90 days. Something you don’t recognise? Change your password and turn on the authenticator app.</p>
      {!events.length ? <p className="muted small-text">No activity yet.</p> : (
        <ul className="activity-list">
          {events.map(e => (
            <li key={e.id} className={BAD_EVENTS.includes(e.event) ? 'bad' : undefined}>
              <div>
                <b>{e.label}</b>
                {e.method_label && <span className="muted"> · with {e.method_label}</span>}
                {e.actor && <span className="muted"> · by {e.actor}</span>}
                <small>{describeDevice(e.user_agent)}{e.ip ? ` · ${e.ip}` : ''}</small>
              </div>
              <time dateTime={e.at}>{fmtShort(e.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
