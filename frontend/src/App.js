import React, { useEffect, useState, useMemo, useRef } from 'react';
import { BrowserRouter, useNavigate, useLocation, useSearchParams, Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import {
  Bell, LayoutDashboard, Ticket, Users, Settings, BookOpen, LogOut, Plus, Search,
  ChevronRight, Shield, Clock, AlertTriangle, CheckCircle, UserRound, Sparkles,
  AlertCircle, Building2, Home, Phone, Hash, UserPlus, Wrench, RefreshCw, X, Check, KeyRound, History, Pencil, Menu,
  ShieldCheck, Smartphone, Map as MapIcon, QrCode, Radio, ImageIcon, UploadCloud, GripVertical, LayoutList, Columns3
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import api, { errMsg } from './api';
import { ErrorBoundary } from './errorReporting';
import { ACADEMIC_BLOCKS, HOSTELS, ALL_SKILLS, OFFLINE_CATEGORIES, OFFLINE_SERVICE_BY_CATEGORY, OFFLINE_SERVICES } from './components/campus';
import { Badge, Loading, Empty, Modal, fmt, roleLabel } from './components/common';
import IncidentFilters, { EMPTY_FILTERS } from './components/IncidentFilters';
import Dashboard from './pages/Dashboard';
import IncidentDetail from './pages/IncidentDetail';
import AdminConfig from './pages/AdminConfig';
import AuditLog from './pages/AuditLog';
import Account from './pages/Account';
import EditUserModal from './components/EditUserModal';
import NonItNotice, { EmergencyBanner } from './components/NonItNotice';
import { ISSUE_TYPES, issueTypeByKey } from './components/issueTypes';
import { googleConfigured, originProblem, startGoogleSignIn, takeGoogleRedirectResult } from './googleSignIn';
import CampusMap from './pages/CampusMap';
import Assets from './pages/Assets';
import { MotionProvider, Page, AnimatePresence, motion, DURATION, EASE_OUT, itemDelay } from './motion';
import { Reorder } from 'motion/react';
import { useLiveConnection, useLiveIncidentEvents, liveIslandItem } from './live';
import { DynamicIsland, FlipWords, FloatingDock, island } from './components/nyxhora';
import { OfflineBanner, queueReport, isNetworkFailure, uploadAttachments } from './offline';
import { DictateButton, VoiceRecorder, VoiceNotePlayer, speechSupported } from './components/voice';
import { LocationCapture } from './components/location';
import { PhotoButton } from './components/attachments';
import { switchThemeWithReveal, celebrate, useDropZone, fileKind, audioFileToAttachment, readTextFile, filesFromPaste } from './interactions';
import { compressImage } from './components/attachments';
import KanbanBoard from './components/KanbanBoard';
import CommandPalette, { useCommandPaletteShortcut } from './components/CommandPalette';
import NotificationStack from './components/NotificationStack';
import ThemeMenu from './components/ThemeMenu';
import { themeStyle, normaliseAppearance, legacyDeviceAppearance, DEFAULT_APPEARANCE } from './theme';
import { HaloDropzone, InteractiveGrid, TextShimmer, GlowingEffect } from './components/effects';

const BITS_DOMAIN = '@hyderabad.bits-pilani.ac.in';


const LEGACY_OFFLINE_CATEGORIES = ['Fan', 'Bed', 'Table', 'Chair', 'Ethernet Port', 'Wi-Fi'];
const LEGACY_OFFLINE_SERVICES = ['Hostel Facilities', 'Hostel Wi-Fi & Ethernet'];

function extractStudentId(email) {
  if (!email) return '';
  const prefix = email.split('@')[0].trim();
  const match = prefix.match(/\d{6,10}/);
  if (match) return match[0];
  return prefix.replace(/^[a-zA-Z]+/, '');
}

function useAuth() {
  const [u, setU] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('itsm_user') || 'null');
    } catch {
      return null;
    }
  });

  // Refresh the cached profile so role/activation changes made by an admin
  // take effect on reload instead of trusting stale localStorage data.
  useEffect(() => {
    if (!localStorage.getItem('itsm_token')) return;
    api.get('/auth/me')
      .then(r => {
        localStorage.setItem('itsm_user', JSON.stringify(r.data));
        setU(r.data);
        adoptDeviceTheme(r.data);
      })
      .catch(() => {});
  }, []);

  // Themes are saved with the account. The first time an account without a saved theme
  // signs in on a device that already had one picked (before this feature), that choice
  // moves into the account; the device-wide setting is then cleared so the next account
  // signing in on this device gets its own theme, not this one.
  const adoptDeviceTheme = user => {
    if (!user || user.appearance) return;
    const legacy = legacyDeviceAppearance();
    if (!legacy) return;
    api.put('/account/appearance', legacy).then(r => {
      ['bits-theme', 'bits-amoled', 'bits-last-dark'].forEach(k => localStorage.removeItem(k));
      setU(cur => {
        if (!cur || cur.id !== user.id) return cur;
        const next = { ...cur, appearance: r.data.appearance };
        localStorage.setItem('itsm_user', JSON.stringify(next));
        return next;
      });
    }).catch(() => {});
  };

  const saveSession = (user, token) => {
    localStorage.setItem('itsm_token', token);
    localStorage.setItem('itsm_user', JSON.stringify(user));
    setU(user);
    adoptDeviceTheme(user);
  };

  // Returns the user, or { mfaRequired, mfaToken } when the account uses an authenticator app.
  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    if (r.data.mfa_required) return { mfaRequired: true, mfaToken: r.data.mfa_token };
    saveSession(r.data.user, r.data.access_token);
    return r.data.user;
  };

  const verifyTwoFactor = async (mfaToken, code) => {
    const r = await api.post('/auth/login/2fa', { mfa_token: mfaToken, code });
    saveSession(r.data.user, r.data.access_token);
    return { user: r.data.user, backupCodesLeft: r.data.backup_codes_left };
  };

  const resetWithAuthenticator = async (email, code, password) => {
    const r = await api.post('/auth/password-reset/authenticator', { email, code, password });
    return r.data;
  };

  const setUser = user => {
    localStorage.setItem('itsm_user', JSON.stringify(user));
    setU(user);
  };

  const refresh = () => api.get('/auth/me').then(r => setUser(r.data)).catch(() => {});

  const register = async (name, email, password, phone) => {
    const r = await api.post('/auth/register', { name, email, password, phone });
    saveSession(r.data.user, r.data.access_token);
    return r.data.user;
  };

  const googleLogin = async (payload) => {
    const r = await api.post('/auth/google', payload);
    saveSession(r.data.user, r.data.access_token);
    return r.data.user;
  };

  const requestPasswordReset = async (email) => {
    const r = await api.post('/auth/password-reset/request', { email });
    return r.data;
  };

  const confirmPasswordReset = async (email, code, password) => {
    const r = await api.post('/auth/password-reset/confirm', { email, code, password });
    return r.data;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('itsm_token');
    localStorage.removeItem('itsm_user');
    setU(null);
  };

  return { u, login, verifyTwoFactor, resetWithAuthenticator, register, googleLogin, requestPasswordReset,
           confirmPasswordReset, logout, saveSession, setUser, refresh };
}

function App() {
  const auth = useAuth();
  return (
    <MotionProvider>
      <BrowserRouter>
        <Toaster richColors position="top-right" />
        <Routes>
          <Route path="/login" element={<Login auth={auth} />} />
          <Route path="*" element={auth.u ? <Shell auth={auth} /> : <Login auth={auth} />} />
        </Routes>
      </BrowserRouter>
    </MotionProvider>
  );
}

// A QR sticker or a shared link (e.g. /incidents/new?asset=AST-0003) opened while signed out:
// remember it and go there after signing in instead of the default page.
const AFTER_LOGIN_KEY = 'bits-after-login';
function homeAfterLogin(role) {
  const target = sessionStorage.getItem(AFTER_LOGIN_KEY);
  sessionStorage.removeItem(AFTER_LOGIN_KEY);
  return target || (role === 'admin' ? '/admin' : '/incidents');
}

function Login({ auth }) {
  const nav = useNavigate();
  const loginLocation = useLocation();
  useEffect(() => {
    if (!['/', '/login'].includes(loginLocation.pathname)) {
      sessionStorage.setItem(AFTER_LOGIN_KEY, loginLocation.pathname + loginLocation.search);
    }
  }, [loginLocation.pathname, loginLocation.search]);
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('admin@example.com');
  const [pw, setPw] = useState('ChangeMe@123');
  const [phone, setPhone] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [busy, setBusy] = useState(false);

  const liveStudentId = useMemo(() => {
    return extractStudentId(email);
  }, [email]);

  const fillDemo = (e, p) => {
    setEmail(e);
    setPw(p);
    setMode('login');
  };

  const handleStandardAuth = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Name is required');
        if (!email.toLowerCase().endsWith(BITS_DOMAIN)) {
          throw new Error(`Only students with '${BITS_DOMAIN}' can register here.`);
        }
        const user = await auth.register(name.trim(), email.trim(), pw, phone.trim());
        toast.success(`Welcome to BITS reports, ${user.name}`);
        nav(homeAfterLogin(user.role));
      } else {
        const result = await auth.login(email.trim(), pw);
        if (result.mfaRequired) {
          setMfaToken(result.mfaToken);
          setMfaCode('');
          setUseBackupCode(false);
          setMode('mfa');
          return;
        }
        toast.success(`Welcome back, ${result.name}`);
        nav(homeAfterLogin(result.role));
      }
    } catch (err) {
      toast.error(errMsg(err) || err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const submitTwoFactor = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const { user, backupCodesLeft } = await auth.verifyTwoFactor(mfaToken, mfaCode.trim());
      toast.success(`Welcome back, ${user.name}`);
      if (useBackupCode) {
        toast.warning(`Backup code used — ${backupCodesLeft} left. Create new ones under Account & security.`, { duration: 8000 });
      }
      nav(homeAfterLogin(user.role));
    } catch (err) {
      const status = err.response?.status;
      toast.error(errMsg(err) || 'That code did not work');
      if (status === 401) { setMode('login'); setMfaToken(''); }      // took too long: start again
      setMfaCode('');
    } finally {
      setBusy(false);
    }
  };

  const submitAuthenticatorReset = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await auth.resetWithAuthenticator(email.trim(), resetCode.trim(), resetPassword);
      toast.success(result.message);
      setPw('');
      setResetCode('');
      setMode('login');
    } catch (err) {
      toast.error(errMsg(err) || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleCredential = async (credential, nonce) => {
    setBusy(true);
    try {
      const user = await auth.googleLogin({ credential, nonce });
      toast.success(`Signed in via Google as ${user.name}`);
      nav(homeAfterLogin(user.role));
    } catch (err) {
      toast.error(errMsg(err) || err.message || 'Google sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const requestResetCode = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await auth.requestPasswordReset(email.trim());
      toast.success(result.message);
      setMode('reset-confirm');
    } catch (err) {
      toast.error(errMsg(err) || 'Could not send a reset code.');
    } finally {
      setBusy(false);
    }
  };

  const openPasswordReset = () => {
    setEmail('');
    setPw('');
    setResetCode('');
    setResetPassword('');
    setMode('reset-request');
  };

  const confirmResetCode = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await auth.confirmPasswordReset(email.trim(), resetCode.trim(), resetPassword);
      toast.success(result.message);
      setPw('');
      setMode('login');
    } catch (err) {
      toast.error(errMsg(err) || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  // Coming back from Google's sign-in page: the ID token is in the URL fragment.
  const googleReplyHandled = useRef(false);
  useEffect(() => {
    if (googleReplyHandled.current) return;
    googleReplyHandled.current = true;
    const result = takeGoogleRedirectResult();
    if (!result) return;
    if (result.error) toast.error(result.error);
    else handleGoogleCredential(result.credential, result.nonce);
  }, []);

  const signInWithGoogle = () => {
    if (!googleConfigured()) return toast.error('Google sign-in is not configured yet.');
    const problem = originProblem();
    if (problem) return toast.error(problem, { duration: 10000 });
    setBusy(true);
    startGoogleSignIn();
  };

  // If the user presses Back on Google's page, mobile browsers restore this page
  // from cache with the button still disabled; re-enable it.
  useEffect(() => {
    const onShow = e => { if (e.persisted) setBusy(false); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  return (
    <div className="login-wrap">
      <InteractiveGrid />
      <div className="login-particles" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>
      <div className="login-ambient login-ambient-one" aria-hidden="true" />
      <div className="login-ambient login-ambient-two" aria-hidden="true" />
      <div className="login-ambient login-ambient-three" aria-hidden="true" />
      <div className="login-card">
        <div className="login-brand">
          <img src="/assets/bits-crest.png" alt="Birla Institute of Technology and Science, Pilani" />
          <span>BITS HYDERABAD HELP</span>
        </div>
        <h1 className="login-flip">
          Report a <FlipWords words={['dead Wi-Fi point', 'flickering projector', 'jammed printer', 'lab PC that won\'t boot', 'loose LAN port']} />
          <span className="login-flip-tail">We'll send someone.</span>
        </h1>
        <p className="muted" style={{ marginBottom: 15, fontSize: 13 }}>
          Report technical issues, track progress, and stay updated in one place.
        </p>

        {/* Google OAuth Button */}
        <button
          className="google-auth-btn"
          type="button"
          disabled={busy}
          onClick={signInWithGoogle}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          Continue with Google
        </button>

        <div className="or-divider">OR USE PORTAL CREDENTIALS</div>

        {['login', 'register'].includes(mode) && <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setEmail('admin@example.com'); setPw('ChangeMe@123'); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setEmail('f20250051@hyderabad.bits-pilani.ac.in'); setPw(''); }}
          >
            Student Sign Up
          </button>
        </div>}

        {mode === 'register' && (
          <div className="bits-notice">
            <Shield size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <b>BITS Hyderabad Students Only:</b> Registration requires your official <code>@hyderabad.bits-pilani.ac.in</code> email. Staff accounts are managed by IT admins.
            </div>
          </div>
        )}

        {['login', 'register'].includes(mode) && <form onSubmit={handleStandardAuth}>
          {mode === 'register' && (
            <label>
              Full Name
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aarav Sharma" />
            </label>
          )}

          <label>
            {mode === 'register' ? 'BITS Student Email' : 'Email Address'}
            <input
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={mode === 'register' ? 'f2025xxxx@hyderabad.bits-pilani.ac.in' : 'name@example.com'}
            />
          </label>

          {mode === 'register' && email.toLowerCase().includes('bits-pilani') && (
            <div style={{ fontSize: 12, color: '#4338ca', display: 'flex', gap: 6, alignItems: 'center', marginTop: -4 }}>
              <Hash size={14} /> Auto-detected Student ID: <b>{liveStudentId || 'Validating…'}</b>
            </div>
          )}

          {mode === 'register' && (
            <label>
              Phone Number
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </label>
          )}

          <label>
            Password
            <input
              required
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="••••••••"
              minLength={mode === 'register' ? 8 : undefined}
            />
          </label>

          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
            {busy ? 'AUTHENTICATING…' : mode === 'register' ? 'REGISTER AS STUDENT' : 'SIGN IN TO PORTAL'}
            <ChevronRight size={18} />
          </button>
          {mode === 'login' && (
            <button
              type="button"
              className="password-reset-link"
              onClick={openPasswordReset}
            >
              <span><KeyRound size={15} /> Forgot password?</span>
              <span className="password-reset-link-action">Reset with OTP <ChevronRight size={15} /></span>
            </button>
          )}
        </form>}

        {mode === 'reset-request' && <form onSubmit={requestResetCode}>
          <h2 style={{ fontSize: 20, margin: '8px 0 16px' }}>Reset your password</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Enter the email address registered to your account. We will send a six-digit OTP only if it is registered.</p>
          <label>Registered email address
            <input required autoFocus autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
            {busy ? 'SENDING OTP…' : 'SEND OTP TO REGISTERED EMAIL'} <ChevronRight size={18} />
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 12 }}
            onClick={() => { setResetCode(''); setResetPassword(''); setMode('reset-authenticator'); }}>
            <Smartphone size={14} /> Use my authenticator app instead
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 4 }} onClick={() => setMode('login')}>Back to sign in</button>
        </form>}

        {mode === 'reset-authenticator' && <form onSubmit={submitAuthenticatorReset}>
          <h2 style={{ fontSize: 20, margin: '8px 0 16px' }}>Reset with your authenticator app</h2>
          <p className="muted small-text">Works if you turned on two-step sign-in. No email is needed.</p>
          <label>Email address
            <input required autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
          <label>Code from the app (or a backup code)
            <input required autoComplete="one-time-code" maxLength={11} value={resetCode} onChange={e => setResetCode(e.target.value)} placeholder="123456" />
          </label>
          <label>New password
            <input required type="password" minLength={8} value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="At least 8 characters" />
          </label>
          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
            {busy ? 'UPDATING…' : 'UPDATE PASSWORD'} <ChevronRight size={18} />
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setMode('reset-request')}>Use an email code instead</button>
        </form>}

        {mode === 'mfa' && <form onSubmit={submitTwoFactor}>
          <h2 style={{ fontSize: 20, margin: '8px 0 10px', display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={20} /> Two-step sign-in</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            {useBackupCode
              ? 'Enter one of the backup codes you saved when you turned on the authenticator app. Each code works once.'
              : <>Open your authenticator app and enter the 6-digit code for <b>BITS reports</b>.</>}
          </p>
          {useBackupCode
            ? <label>Backup code
                <input required autoFocus maxLength={11} value={mfaCode} onChange={e => setMfaCode(e.target.value)} placeholder="abcde-fghjk" />
              </label>
            : <label>6-digit code
                <input className="code-input" required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                  value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
              </label>}
          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy || !mfaCode} type="submit">
            {busy ? 'CHECKING…' : 'VERIFY AND SIGN IN'} <ChevronRight size={18} />
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => { setUseBackupCode(b => !b); setMfaCode(''); }}>
            {useBackupCode ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 4 }} onClick={() => { setMode('login'); setMfaToken(''); }}>Back to sign in</button>
        </form>}

        {mode === 'reset-confirm' && <form onSubmit={confirmResetCode}>
          <h2 style={{ fontSize: 20, margin: '8px 0 16px' }}>Enter your reset code</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>We sent a six-digit OTP to <b>{email}</b>. It expires in 10 minutes.</p>
          <label>Six-digit code
            <input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
          </label>
          <label>New password
            <input required type="password" minLength={8} value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="At least 8 characters" />
          </label>
          <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={busy} type="submit">
            {busy ? 'UPDATING…' : 'UPDATE PASSWORD'} <ChevronRight size={18} />
          </button>
          <button type="button" className="text-btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setMode('reset-request')}>Use a different email</button>
        </form>}

        <div className="demo-box">
          <span style={{ fontWeight: 700, color: '#64748b' }}>Quick Autofill Accounts:</span>
          <div className="demo-account-chip" onClick={() => fillDemo('admin@example.com', 'ChangeMe@123')}>
            <span><b>Admin:</b> admin@example.com</span>
            <small style={{ color: '#ea580c' }}>ChangeMe@123</small>
          </div>
          <div className="demo-account-chip" onClick={() => fillDemo('f20250051@hyderabad.bits-pilani.ac.in', 'Student@1234')}>
            <span><b>BITS Student:</b> f20250051@hyderabad... (ID: 20250051)</span>
            <small style={{ color: '#4338ca' }}>Student@1234</small>
          </div>
          <div className="demo-account-chip" onClick={() => fillDemo('alice.chen@itsm.local', 'Tech@1234')}>
            <span><b>Technician:</b> alice.chen@itsm.local</span>
            <small style={{ color: '#059669' }}>Tech@1234</small>
          </div>
        </div>
      </div>

    </div>
  );
}

function Shell({ auth }) {
  const u = auth.u;
  const location = useLocation();
  // Colour theme: saved with the account (u.appearance), so it follows the person to any device.
  const [appearance, setAppearance] = useState(() => normaliseAppearance(u.appearance || legacyDeviceAppearance() || DEFAULT_APPEARANCE));
  const style = useMemo(() => themeStyle(appearance), [appearance]);
  const darkMode = style.scheme === 'dark';
  const savedAppearance = JSON.stringify(u.appearance || null);
  useEffect(() => {        // changed on another device, or arrived with a fresh profile
    if (u.appearance) setAppearance(normaliseAppearance(u.appearance));
  }, [savedAppearance]);
  const admin = u.role === 'admin';
  const tech = u.role === 'technician';
  const student = u.role === 'customer';
  const canViewDashboard = admin || tech;
  const [unread, setUnread] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(setPaletteOpen);
  const live = useLiveConnection(true);

  // Live events: things worth knowing right now drop into the Dynamic Island at the top of
  // the screen (tap it for details and a link), and the bell count goes up.
  useLiveIncidentEvents(ev => {
    const item = liveIslandItem(ev, u);
    if (!item) return;
    island.push(item);
    setUnread(n => n + 1);
  });

  // Unread notification count for the bell (refreshes every 30 s and on navigation).
  useEffect(() => {
    let alive = true;
    const poll = () => api.get('/notifications').then(r => alive && setUnread(r.data.unread)).catch(() => {});
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname]);


  // Phones: the sidebar becomes a slide-in menu, closed again after every navigation.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const navItems = [
    canViewDashboard && ['/admin', LayoutDashboard, 'Overview', 'var(--c-indigo)'],
    ['/incidents', Ticket, student ? 'My Reports' : tech ? 'Incident Queue' : 'All Incidents', 'var(--c-magenta)'],
    ['/incidents/new', Plus, 'Create Report', 'var(--c-orange)'],
    canViewDashboard && ['/campus-map', MapIcon, 'Campus map', 'var(--c-teal)'],
    admin && ['/admin/assets', QrCode, 'QR stickers', 'var(--c-sun)'],
    admin && ['/admin/users', Users, 'User & Role Admin', 'var(--c-sky)'],
    admin && ['/admin/settings', Settings, 'Configuration', 'var(--c-violet)'],
    admin && ['/admin/audit', History, 'Audit & SLA log', 'var(--c-rose)'],
    ['/docs', BookOpen, 'Campus Docs', 'var(--c-lime)'],
    ['/account', ShieldCheck, 'Account & security', 'var(--c-slate)']
  ].filter(Boolean);
  // Phones get a bottom dock with the four or five places people go most.
  const dockItems = [
    canViewDashboard ? { to: '/admin', icon: LayoutDashboard, label: 'Overview' } : null,
    { to: '/incidents', icon: Ticket, label: student ? 'My reports' : 'Queue' },
    { to: '/incidents/new', icon: Plus, label: 'Report' },
    canViewDashboard ? { to: '/campus-map', icon: MapIcon, label: 'Map' } : { to: '/docs', icon: BookOpen, label: 'Docs' },
    { to: '/account', icon: ShieldCheck, label: 'Account' }
  ].filter(Boolean);

  // MiniMusic-style theming: one ThemeStyle object → CSS variables on .app. The "dark-mode"
  // class only says whether text is light (dark looks, or a dark gradient). Original and
  // Indigo are the app's own looks, drawn by the stylesheet as before (no "mm-theme" layer).
  const themeClass = `app${style.classic ? '' : ' mm-theme'} theme-${appearance.theme}${darkMode ? ' dark-mode' : ''}`;

  // Picking a look spreads it out as a growing circle from the button; gradient edits apply
  // immediately while you drag. Either way the choice is saved to the account (debounced so a
  // slider drag sends one request, not hundreds).
  const lastKey = scheme => `bits-last-${scheme}:${u.id}`;
  const saveTimer = useRef(null);
  const changeTheme = (next, e, { live = false } = {}) => {
    next = normaliseAppearance(next);
    if (JSON.stringify(next) === JSON.stringify(appearance)) return;
    if (next.theme !== 'gradient') localStorage.setItem(lastKey(themeStyle(next).scheme), next.theme);
    const lookChanged = next.theme !== appearance.theme;
    if (lookChanged && !live) switchThemeWithReveal(e, () => setAppearance(next), themeStyle(next).scheme === 'dark');
    else setAppearance(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      auth.setUser({ ...auth.u, appearance: next });
      api.put('/account/appearance', next)
        .catch(() => toast.error('Could not save the theme to your account — it applies on this device for now.'));
    }, live ? 600 : 0);
  };
  // Command palette: flip between the light and dark look you used last.
  const toggleDarkMode = e => {
    const want = darkMode ? 'light' : 'dark';
    const fallback = darkMode ? 'original' : 'indigo';
    changeTheme({ ...appearance, theme: localStorage.getItem(lastKey(want)) || fallback }, e);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    document.body.style.background = style.vars['--warm-bg'] || '';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', style.themeColor);
  }, [darkMode, style]);
  useEffect(() => () => {                 // signing out: the sign-in page has its own look
    document.documentElement.dataset.theme = 'light';
    document.body.style.background = '';
  }, []);

  return (
    <div className={themeClass} style={style.vars}>
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className={navOpen ? 'open' : undefined} id="main-nav">
        <div className="side-brand">
          <div className="brand-lockup">
            <img className="bits-crest" src="/assets/bits-crest.png" alt="BITS Pilani Hyderabad crest" />
            <div>
              <div className="brand-title"><span><strong>BITS</strong> reports</span></div>
              <small>{roleLabel(u.role)} · HYDERABAD</small>
            </div>
          </div>
        </div>

        <nav>
          {navItems.map(([to, Icon, label, color]) => {
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} className={active ? 'active' : undefined} style={{ '--nav-color': color }}
                aria-current={active ? 'page' : undefined}>
                {active && <motion.span layoutId="nav-pill" className="nav-pill"
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <span className="nav-icon"><Icon size={17} /></span>
                <span className="nav-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="side-bottom">
          <Link to="/account" className="profile-card" title="Account & security">
            <div className="profile-avatar">
              {u.picture ? <img src={u.picture} alt={u.name} /> : u.name?.charAt(0) || 'U'}
            </div>
            <div className="profile-info">
              <span>{u.name}</span>
              <small>{u.email}</small>
              {u.student_id && <div className="bits-id-pill">ID: {u.student_id}</div>}
            </div>
          </Link>
          <button className="ghost" onClick={auth.logout}>
            <LogOut size={16} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main>
        <header>
          <button type="button" className="icon-btn menu-btn" onClick={() => setNavOpen(o => !o)}
            aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="main-nav">
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="header-titles">
            <span className="eyebrow">
              {roleLabel(u.role)} · BITS PILANI HYDERABAD
            </span>
            <h2>
              {admin ? 'Campus reports overview' : tech ? 'Your work queue' : 'Campus IT support'}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" className="cmdk-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search (Ctrl or Command + K)">
              <Search size={15} /> <span>Search</span> <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <span className={`live-pill${live ? ' on' : ''}`} title={live ? 'Live: pages update by themselves' : 'Reconnecting to live updates…'}>
              <Radio size={13} /> {live ? 'Live' : 'Offline'}
            </span>
            <ThemeMenu appearance={appearance} onChange={changeTheme} />
            <NotificationStack unread={unread} setUnread={setUnread} />
          </div>
        </header>

        <OfflineBanner />
        <DynamicIsland />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} user={u} onToggleTheme={toggleDarkMode} />

        {u.two_factor_required && !u.two_factor_enabled && location.pathname !== '/account' && (
          <div className="callout warn" role="alert" style={{ marginTop: 0, marginBottom: 18 }}>
            <AlertTriangle size={18} />
            <div>
              <b>Administrators must use an authenticator app.</b> The admin pages stay locked until you turn it on.{' '}
              <Link to="/account">Set it up now →</Link>
            </div>
          </div>
        )}

        {/* A crash inside one page keeps the sidebar usable; navigating away clears it. */}
        <ErrorBoundary resetKey={location.pathname}>
        {/* Page transition: the old page fades out quickly, the new one fades/rises in (200 ms). */}
        <AnimatePresence mode="wait" initial={false}>
        <Page key={location.pathname}>
        <Routes location={location}>
          <Route path="/admin" element={canViewDashboard ? <Dashboard user={u} /> : <Navigate to="/incidents" replace />} />
          <Route path="/admin/users" element={<AdminOnly user={u}><UsersPage me={u} /></AdminOnly>} />
          <Route path="/admin/settings" element={<AdminOnly user={u}><AdminConfig /></AdminOnly>} />
          <Route path="/admin/audit" element={<AdminOnly user={u}><AuditLog /></AdminOnly>} />
          <Route path="/admin/assets" element={<AdminOnly user={u}><Assets /></AdminOnly>} />
          <Route path="/campus-map" element={canViewDashboard ? <CampusMap user={u} /> : <Navigate to="/incidents" replace />} />
          <Route path="/incidents" element={<Incidents user={u} />} />
          <Route path="/incidents/new" element={<NewIncident user={u} />} />
          <Route path="/incidents/:id" element={<IncidentDetail user={u} />} />
          <Route path="/notifications" element={<Notifications onChange={setUnread} />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/account" element={<Account auth={auth} />} />
          <Route path="*" element={<Incidents user={u} />} />
        </Routes>
        </Page>
        </AnimatePresence>
        </ErrorBoundary>
      </main>
      <FloatingDock items={dockItems} />
    </div>
  );
}

function AdminOnly({ user, children }) {
  return user.role === 'admin' ? children : <Navigate to="/incidents" replace />;
}

function Incidents({ user }) {
  const [data, setData] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = filters.q;
  const [scope, setScope] = useState('all');
  const [loading, setLoading] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const liveTimer = useRef(null);
  const isStudent = user.role === 'customer';
  const isTech = user.role === 'technician';
  const [view, setView] = useState(() => (!isStudent && localStorage.getItem('bits-incident-view') === 'board' ? 'board' : 'list'));
  const chooseView = v => { setView(v); localStorage.setItem('bits-incident-view', v); };

  // Any live change to an incident this user can see: reload the list quietly (a burst = one reload).
  useLiveIncidentEvents(() => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setLiveTick(t => t + 1), 500);
  });
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false));
      if (params.q) params.q = params.q.trim();
      if (isTech) params.scope = scope;
      api.get('/incidents', { params })
        .then(x => { if (!cancelled) setData(x.data); })
        .catch(e => { if (!cancelled && !isNetworkFailure(e)) toast.error(errMsg(e) || 'Could not load incidents'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters, q, scope, isTech, liveTick]);

  return (
    <>
      {/* Student Welcome & Quick Category Cards */}
      {isStudent && (
        <motion.div className="student-banner-grid" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}>
          <Link to="/incidents/new?type=wifi" className="student-card lavender">
            <div>
              <span className="eyebrow" style={{ color: '#4338ca' }}>HOSTEL SUPPORT</span>
              <h4>Hostel Wi-Fi & LAN</h4>
              <p>Experiencing connectivity issues in your Bhavan room? Submit a fast ticket.</p>
            </div>
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              Report Wi-Fi <ChevronRight size={16} />
            </div>
          </Link>

          <Link to="/incidents/new?type=lab-pc" className="student-card sky">
            <div>
              <span className="eyebrow" style={{ color: '#0369a1' }}>ACADEMICS</span>
              <h4>Lab Workstation & Software</h4>
              <p>Issues in Block A/B/C/D or NAB computer labs, compilers, or projectors.</p>
            </div>
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              Report Lab Issue <ChevronRight size={16} />
            </div>
          </Link>

          <Link to="/incidents/new?type=login" className="student-card mint">
            <div>
              <span className="eyebrow" style={{ color: '#15803d' }}>AUTHENTICATION</span>
              <h4>SSO & Portal Login</h4>
              <p>Locked out of BITS email, ERP, or LMS? Request immediate credential reset.</p>
            </div>
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              Reset Access <ChevronRight size={16} />
            </div>
          </Link>
        </motion.div>
      )}

      <div className="toolbar">
        <IncidentFilters value={filters} onChange={setFilters} role={user.role} />

        {isTech && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={scope === 'all' ? 'primary small' : 'secondary small'}
              onClick={() => setScope('all')}
            >
              All / Queue
            </button>
            <button
              className={scope === 'assigned' ? 'primary small' : 'secondary small'}
              onClick={() => setScope('assigned')}
            >
              My Assigned
            </button>
            <button
              className={scope === 'unassigned' ? 'primary small' : 'secondary small'}
              onClick={() => setScope('unassigned')}
            >
              Unassigned
            </button>
          </div>
        )}

        {!isStudent && (
          <div className="view-switch" role="tablist" aria-label="View">
            {[['list', LayoutList, 'List'], ['board', Columns3, 'Board']].map(([v, Icon, label]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : undefined} onClick={() => chooseView(v)}>
                {view === v && <motion.span layoutId="view-pill" className="switch-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        )}

        <Link className="primary" to="/incidents/new">
          <Plus size={18} />
          {isStudent ? 'File New Complaint' : 'New Incident'}
        </Link>
      </div>

      {view === 'board' && !isStudent ? (
        <>
          <p className="muted small-text board-hint" style={{ margin: '-4px 0 10px' }}>
            <span className="hint-drag">Drag a card to another column to move it on. Dropping on “Resolved” opens the resolve form.</span>
            <span className="hint-touch">Swipe sideways to see every column. Use “Move to…” on a card to move it on.</span>
          </p>
          {loading && !data.length ? <Loading /> : <KanbanBoard incidents={data} user={user} onChanged={() => setLiveTick(t => t + 1)} />}
        </>
      ) : (
      <div className="panel table-wrap">
        <table className="incident-table">
          <thead>
            <tr>
              <th>Incident</th>
              <th>Location</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Service</th>
              <th>{isStudent ? 'Assigned Tech' : 'Technician'}</th>
              <th>SLA Status</th>
              <th>Created / Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.map((i, n) => (
              <motion.tr key={i.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
                <td data-label="Incident">
                  <Link to={'/incidents/' + i.id}>
                    <b>{i.number}</b>
                    <small>{i.title}</small>
                  </Link>
                </td>
                <td data-label="Location">
                  <span className="location-pill">
                    {i.location?.type === 'hostel' ? <Home size={13} color="#ea580c" /> : <Building2 size={13} color="#6366f1" />}
                    {i.location?.formatted || 'Campus Main'}
                  </span>
                </td>
                <td data-label="Priority"><Badge v={i.priority} /></td>
                <td data-label="Status"><Badge v={i.status} /></td>
                <td data-label="Service">{i.service_name}</td>
                <td data-label="Technician">{i.assigned_name || <span className="muted" style={{ fontStyle: 'italic' }}>Pending Dispatch</span>}</td>
                <td data-label="SLA"><Badge v={i.sla?.status || 'ON_TRACK'} />{i.escalation?.level > 0 && <small className="escalated-tag">Escalated L{i.escalation.level}</small>}</td>
                <td data-label="Updated">{fmt(i.updated_at || i.created_at)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {loading ? <Loading inline /> : !data.length ? <Empty /> : null}
      </div>
      )}
    </>
  );
}

function NewIncident({ user }) {
  const nav = useNavigate();
  const [services, setServices] = useState([]);
  const [cats, setCats] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [dupWarning, setDupWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [aiTriage, setAiTriage] = useState(null);
  // Non-IT detection (medical, mental health, fire, security…): popup + live banner.
  const [nonIt, setNonIt] = useState(null);            // { scope, onContinue }
  const [liveScope, setLiveScope] = useState(null);
  const scopeCache = useRef({});
  // Autofill of issue type (category) and service: one-click common issues + live keyword detection.
  const [searchParams] = useSearchParams();
  const [issueType, setIssueType] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [autoFilled, setAutoFilled] = useState({ category: false, service: false });
  const touched = useRef({ category: false, service: false });
  const lastTemplateTitle = useRef('');
  const presetApplied = useRef(false);
  const descriptionRef = useRef(null);
  // Field-service extras: exact location, photos / voice note, QR sticker, dictation.
  const [geoFix, setGeoFix] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [asset, setAsset] = useState(null);
  const [aiAfterDictation, setAiAfterDictation] = useState(true);
  const assetApplied = useRef(false);
  const latest = useRef(null);

  const [f, setF] = useState({
    title: '',
    description: '',
    category: '',
    service_id: '',
    impact: 2,
    urgency: 2,
    business_criticality: 1,
    affected_users: 1,
    location_type: 'hostel', // 'hostel' | 'academics' | 'online'
    academic_block: ACADEMIC_BLOCKS[0],
    hostel_name: HOSTELS[0],
    room_number: '',
    phone: user?.phone || '',
    student_id: user?.student_id || extractStudentId(user?.email || ''),
    acknowledge_duplicate: false,
    confirm_in_scope: false,
    online_place: '',            // optional building for online issues: 'hostel:<name>' | 'block:<name>'
    visit_availability: ''       // hostel repairs: when a technician can come
  });

  useEffect(() => {
    Promise.all([api.get('/catalog/services'), api.get('/catalog/categories')])
      .then(([s, c]) => {
        setServices(s.data);
        setCats(c.data);
        setF(prev => ({
          ...prev,
          service_id: s.data.find(service => service.name === OFFLINE_SERVICE_BY_CATEGORY['Carpenter Needed'])?.id || '',
          category: c.data.find(category => category.name === 'Carpenter Needed')?.name || ''
        }));
      })
      .catch(e => setCatalogError(errMsg(e) || 'Could not load service catalog.'));
  }, []);

  latest.current = f;

  // Drag-and-drop / paste: photos and audio become attachments, text files go into the description.
  const addFiles = async files => {
    for (const file of files) {
      const kind = fileKind(file);
      try {
        if (kind === 'photo') {
          const photo = await compressImage(file);
          setPendingFiles(list => [...list, { kind: 'photo', stage: 'before', ...photo, key: `${Date.now()}-${file.name}` }]);
          toast.success(`Photo added: ${file.name || 'pasted image'}`);
        } else if (kind === 'voice') {
          const note = await audioFileToAttachment(file);
          setPendingFiles(list => [...list, { ...note, key: `${Date.now()}-${file.name}` }]);
          toast.success(`Recording added: ${file.name}`);
        } else if (kind === 'text') {
          const text = (await readTextFile(file)).trim();
          setF(prev => ({ ...prev, description: prev.description ? `${prev.description.trim()}\n\n${text}` : text }));
          toast.success(`Text from ${file.name} added to the description`);
        } else {
          toast.error(`${file.name}: drop a photo, an audio recording or a .txt file`);
        }
      } catch (err) {
        toast.error(err.message || `Could not read ${file.name}`);
      }
    }
  };
  const drop = useDropZone(addFiles);
  const onPasteFiles = e => {
    const files = filesFromPaste(e);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const isOfflineIssue = f.location_type !== 'online';
  const categoriesFor = locationType => {
    if (locationType === 'hostel') return cats.filter(c => OFFLINE_CATEGORIES.includes(c.name));
    if (locationType === 'academics') return cats.filter(c => !LEGACY_OFFLINE_CATEGORIES.includes(c.name));
    return cats.filter(c => ![...OFFLINE_CATEGORIES, ...LEGACY_OFFLINE_CATEGORIES].includes(c.name));
  };
  const availableCategories = categoriesFor(f.location_type);
  const availableServices = services.filter(s => ![...OFFLINE_SERVICES, ...LEGACY_OFFLINE_SERVICES].includes(s.name));
  const usesOfflineSupport = OFFLINE_CATEGORIES.includes(f.category);
  const showServicePicker = f.location_type !== 'hostel' && !usesOfflineSupport;

  const selectAssistance = mode => {
    const isOffline = mode === 'offline';
    const nextLocationType = isOffline ? (f.location_type === 'academics' ? 'academics' : 'hostel') : 'online';
    const categoryChoices = categoriesFor(nextLocationType);
    const serviceChoices = isOffline
      ? services.filter(s => OFFLINE_SERVICES.includes(s.name))
      : services.filter(s => ![...OFFLINE_SERVICES, ...LEGACY_OFFLINE_SERVICES].includes(s.name));
    const nextCategory = categoryChoices.some(c => c.name === f.category) ? f.category : (categoryChoices[0]?.name || '');
    const matchedServiceName = isOffline ? OFFLINE_SERVICE_BY_CATEGORY[nextCategory] : null;
    const nextService = matchedServiceName
      ? serviceChoices.find(s => s.name === matchedServiceName)
      : serviceChoices.find(s => s.id === f.service_id) || serviceChoices[0];
    setF(prev => ({
      ...prev,
      location_type: nextLocationType,
      room_number: '',
      category: nextCategory,
      service_id: nextService?.id || ''
    }));
  };

  const selectOfflineLocation = locationType => setF(prev => {
    const nextCategory = locationType === 'hostel' && !OFFLINE_CATEGORIES.includes(prev.category)
      ? 'Carpenter Needed'
      : prev.category;
    const service = services.find(item => item.name === OFFLINE_SERVICE_BY_CATEGORY[nextCategory]);
    return {
      ...prev,
      location_type: locationType,
      room_number: '',
      category: nextCategory,
      service_id: service?.id || prev.service_id
    };
  });
  const selectOfflineCategory = category => {
    const service = OFFLINE_SERVICE_BY_CATEGORY[category]
      ? services.find(item => item.name === OFFLINE_SERVICE_BY_CATEGORY[category])
      : availableServices.find(item => item.id === f.service_id) || availableServices[0];
    setF(prev => ({ ...prev, category, service_id: service?.id || '' }));
  };

  const textKey = `${f.title.trim()}\n${f.description.trim()}`;
  const onlineServices = services.filter(s => ![...OFFLINE_SERVICES, ...LEGACY_OFFLINE_SERVICES].includes(s.name));

  const chooseCategory = name => (isOfflineIssue ? selectOfflineCategory(name) : setF(prev => ({ ...prev, category: name })));

  // One click on a common issue fills issue type, location mode, category, service and a title.
  const applyIssueType = t => {
    const allowed = categoriesFor(t.mode);
    const category = allowed.some(c => c.name === t.category) ? t.category : (allowed[0]?.name || '');
    const serviceName = OFFLINE_SERVICE_BY_CATEGORY[category] || t.service;
    const service = serviceName ? services.find(s => s.name === serviceName) : null;
    const previousTemplateTitle = lastTemplateTitle.current;   // read now, before it is updated below
    setF(prev => ({
      ...prev,
      location_type: t.mode,
      category,
      service_id: service?.id || (onlineServices.find(s => s.id === prev.service_id) || onlineServices[0])?.id || '',
      title: !prev.title.trim() || prev.title === previousTemplateTitle ? t.title : prev.title,
      impact: t.impact ?? prev.impact,
      urgency: t.urgency ?? prev.urgency,
      room_number: prev.location_type === t.mode ? prev.room_number : ''
    }));
    lastTemplateTitle.current = t.title;
    touched.current = { category: true, service: Boolean(t.service) };
    setAutoFilled({ category: false, service: false });
    setIssueType(t);
    setTimeout(() => descriptionRef.current?.focus(), 0);
  };

  // Links like /incidents/new?type=wifi (used by the cards on "My Reports") preselect an issue type.
  useEffect(() => {
    if (presetApplied.current || !services.length || !cats.length) return;
    const preset = issueTypeByKey(searchParams.get('type') || '');
    presetApplied.current = true;
    if (preset) applyIssueType(preset);
  });

  // Opened from a QR sticker (/incidents/new?asset=AST-0003): fill in what and where.
  useEffect(() => {
    const code = searchParams.get('asset');
    if (assetApplied.current || !code || !services.length || !cats.length) return;
    assetApplied.current = true;
    api.get(`/assets/${encodeURIComponent(code)}`).then(r => {
      const a = r.data;
      const loc = a.location || {};
      const mode = loc.type === 'hostel' ? 'hostel' : 'academics';
      const allowed = categoriesFor(mode);
      const category = allowed.some(c => c.name === a.category) ? a.category
        : (mode === 'hostel' ? 'Technician Needed' : (allowed.find(c => c.name === 'Hardware') || allowed[0])?.name || '');
      const repair = OFFLINE_SERVICE_BY_CATEGORY[category];
      const service = repair ? services.find(s => s.name === repair) : null;
      setAsset(a);
      setF(prev => ({
        ...prev,
        location_type: mode,
        hostel_name: loc.hostel_name || prev.hostel_name,
        academic_block: loc.academic_block || prev.academic_block,
        room_number: loc.room_number || prev.room_number,
        category,
        service_id: service?.id || prev.service_id,
        title: prev.title.trim() ? prev.title : `Problem with ${a.name}`
      }));
      touched.current = { category: Boolean(a.category), service: Boolean(service) };
      setTimeout(() => descriptionRef.current?.focus(), 0);
    }).catch(e => toast.error(errMsg(e) || 'This QR code is not registered.'));
  });

  // Live autofill while typing: keyword rules on the server (instant, works without AI).
  useEffect(() => {
    if (textKey.trim().length < 4 || !cats.length) { setSuggestions(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.post('/intelligence/suggest', {
        title: f.title, description: f.description,
        categories: availableCategories.map(c => c.name),
        services: showServicePicker ? availableServices.map(s => s.name) : []
      }).then(r => {
        if (cancelled) return;
        setSuggestions(r.data);
        const cat = r.data.categories[0]?.name;
        if (cat && !touched.current.category && cat !== f.category) {
          chooseCategory(cat);
          setAutoFilled(a => ({ ...a, category: true }));
        }
        const svc = services.find(s => s.name === r.data.services[0]?.name);
        if (svc && !touched.current.service && showServicePicker && svc.id !== f.service_id) {
          setF(prev => ({ ...prev, service_id: svc.id }));
          setAutoFilled(a => ({ ...a, service: true }));
        }
      }).catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [textKey, f.location_type, cats.length, services.length]);

  // Instant, rules-only check while typing (no AI, so it also works offline).
  useEffect(() => {
    setF(prev => (prev.confirm_in_scope ? { ...prev, confirm_in_scope: false } : prev));
    if (textKey.trim().length < 12) { setLiveScope(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.post('/intelligence/scope', { title: f.title, description: f.description, use_ai: false })
        .then(r => { if (!cancelled) setLiveScope(!r.data.in_scope && r.data.emergency ? r.data : null); })
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [textKey]);

  const showNonIt = (scope, onContinue) => setNonIt({ scope, onContinue });

  // Fill every field from the generated details: issue type, location, category, service,
  // impact, urgency, criticality and affected people. The student can still change anything.
  const applyGenerated = d => {
    const loc = d.location || {};
    const isRepair = OFFLINE_CATEGORIES.includes(d.category);
    setF(prev => {
      let mode;
      if (isRepair) mode = loc.type === 'academics' || loc.type === 'hostel' ? loc.type : (prev.location_type === 'academics' ? 'academics' : 'hostel');
      else mode = loc.type === 'academics' && prev.location_type === 'academics' ? 'academics' : 'online';
      const allowed = categoriesFor(mode);
      const category = allowed.some(c => c.name === d.category) ? d.category
        : (allowed.some(c => c.name === prev.category) ? prev.category : (allowed[0]?.name || ''));
      const repair = OFFLINE_SERVICE_BY_CATEGORY[category];
      const service = repair ? services.find(s => s.name === repair)
        : (onlineServices.find(s => s.name === d.service) || onlineServices.find(s => s.id === prev.service_id) || onlineServices[0]);
      const onlinePlace = loc.hostel_name ? `hostel:${loc.hostel_name}` : loc.academic_block ? `block:${loc.academic_block}` : prev.online_place;
      return {
        ...prev,
        title: d.title || prev.title,
        description: d.description || prev.description,
        location_type: mode,
        category,
        service_id: service?.id || prev.service_id,
        hostel_name: loc.hostel_name || prev.hostel_name,
        academic_block: loc.academic_block || prev.academic_block,
        online_place: onlinePlace,
        room_number: loc.room_number || prev.room_number,
        impact: d.impact || prev.impact,
        urgency: d.urgency || prev.urgency,
        business_criticality: d.business_criticality || prev.business_criticality,
        affected_users: d.affected_users || d.affected_users_estimate || prev.affected_users
      };
    });
    touched.current = { category: true, service: true };     // keep the generated choices; typing won't override them
    setAutoFilled({ category: true, service: Boolean(d.service) && !OFFLINE_CATEGORIES.includes(d.category) });
  };

  const generateDetails = async () => {
    const description = (latest.current?.description || f.description).trim();
    if (!description) {
      toast.error('Describe your issue before generating details');
      return;
    }
    if (description.length < 10) {
      toast.error('Say or type a little more (at least 10 characters) so the details can be filled in');
      return;
    }
    setGeminiLoading(true);
    try {
      const r = await api.post('/intelligence/generate-incident', { description });
      if (r.data.scope) scopeCache.current[textKey] = r.data.scope;
      if (r.data.scope && !r.data.scope.in_scope) {
        // Don't turn an emergency into an IT ticket: keep the student's words and show who to contact.
        setAiTriage(null);
        showNonIt(r.data.scope, () => { setNonIt(null); setF(prev => ({ ...prev, confirm_in_scope: true })); });
        return;
      }
      setAiTriage(r.data);
      applyGenerated(r.data);
      toast.success(
        'Details filled in from your description. Please review and edit before submitting.'
      );
    } catch (e) {
      toast.error(errMsg(e) || 'AI generation unavailable. Your description has been kept.');
    } finally {
      setGeminiLoading(false);
    }
  };

  // The service picker is hidden for offline support, and its options only list
  // online services. Resolve the service that will really be submitted so a
  // stale hidden value (e.g. "Carpenter Support") is never sent for an online category.
  const effectiveServiceId = () => {
    if (usesOfflineSupport) {
      return services.find(s => s.name === OFFLINE_SERVICE_BY_CATEGORY[f.category])?.id || f.service_id;
    }
    return availableServices.some(s => s.id === f.service_id) ? f.service_id : (availableServices[0]?.id || '');
  };

  const submit = e => {
    e.preventDefault();
    return sendReport(f.confirm_in_scope);
  };

  const lastPayload = useRef(null);
  const sendReport = async confirmed => {
    setBusy(true);
    setDupWarning('');
    lastPayload.current = null;
    try {
      if (!confirmed && navigator.onLine) {
        // Ask (AI if available, rules otherwise) whether this belongs to the IT help desk at all.
        let scope = scopeCache.current[textKey];
        if (!scope) {
          try {
            scope = (await api.post('/intelligence/scope', { title: f.title, description: f.description, use_ai: true })).data;
            scopeCache.current[textKey] = scope;
          } catch { scope = null; }   // the server re-checks on submit anyway
        }
        if (scope && !scope.in_scope) {
          showNonIt(scope, () => { setNonIt(null); sendReport(true); });
          return;
        }
      }
      const payload = { ...f, confirm_in_scope: !!confirmed, service_id: effectiveServiceId() };
      if (payload.location_type === 'online') {
        // Online issues can still say where they happen (Wi-Fi/LAN in a room, a lab PC…), but it's optional.
        const [kind, place] = (payload.online_place || '').split(/:(.+)/);
        payload.hostel_name = kind === 'hostel' ? place : null;
        payload.academic_block = kind === 'block' ? place : null;
        payload.room_number = payload.room_number?.trim() || null;
        payload.visit_availability = null;
      }
      delete payload.online_place;
      if (geoFix && payload.location_type !== 'online') Object.assign(payload, geoFix);
      if (asset) payload.asset_code = asset.code;
      lastPayload.current = payload;
      const r = await api.post('/incidents', payload);
      toast.success(`Complaint ${r.data.number} created successfully`);
      celebrate();
      if (pendingFiles.length) {
        await uploadAttachments(r.data.id, pendingFiles.map(({ previewUrl, key, name, ...body }) => body));
      }
      nav('/incidents/' + r.data.id);
    } catch (err) {
      const detail = errMsg(err) || 'Could not file complaint';
      if (isNetworkFailure(err) && lastPayload.current) {
        // No connection: keep the report on this device and send it when the network is back.
        const saved = queueReport(lastPayload.current, pendingFiles.map(({ previewUrl, key, name, ...body }) => body));
        toast.success('No connection — your report is saved on this device', {
          description: `It will be sent automatically when you're back online${pendingFiles.length && !saved.withAttachments ? ' (files were too large to keep offline)' : ''}.`,
          duration: 8000
        });
        nav('/incidents');
        return;
      }
      if (err.response?.data?.error === 'OutOfScopeError' && err.response.data.scope) {
        showNonIt(err.response.data.scope, () => { setNonIt(null); sendReport(true); });
      } else if (err.response?.status === 409 && detail.toLowerCase().includes('duplicate')) {
        setDupWarning(detail + '. If this is a separate occurrence, check the confirmation box below to proceed.');
        setF(x => ({ ...x, acknowledge_duplicate: false }));
      } else {
        toast.error(detail);
      }
    } finally {
      setBusy(false);
    }
  };

  if (catalogError) return <div className="panel empty">{catalogError}</div>;

  return (
    <div className="panel form-panel drop-target" {...drop.bind}>
      <GlowingEffect spread={30} proximity={40} />
      <AnimatePresence>
        {drop.isOver && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast }}>
            <div><UploadCloud size={40} /><div>Drop photos, audio recordings or a text file</div></div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="panel-head">
        <div>
          <span className="eyebrow">AI-ASSISTED REPORTING</span>
          <h3>Create a Report</h3>
          <p className="muted">Describe your issue, and let AI help organize the details.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="secondary"
            type="button"
            disabled={geminiLoading}
            onClick={generateDetails}
          >
            <Sparkles size={16} />
            {geminiLoading ? <TextShimmer>Generating details…</TextShimmer> : 'Generate Details with AI'}
          </button>
        </div>
      </div>


      {nonIt && <NonItNotice scope={nonIt.scope} onClose={() => setNonIt(null)} onContinue={nonIt.onContinue} />}
      {liveScope && !nonIt && <EmergencyBanner scope={liveScope} onOpen={() => showNonIt(liveScope, () => { setNonIt(null); setLiveScope(null); setF(prev => ({ ...prev, confirm_in_scope: true })); })} />}

      {/* AI Triage Card */}
      {aiTriage && (
        <div className="ai-triage-box">
          <div className="ai-triage-head">
            <div className="ai-triage-badge">
              <Sparkles size={14} />
              AI suggestion — review before submission
            </div>
            <div className="ai-score-pill">
              Suggested priority: {aiTriage.priority}
            </div>
          </div>
          <div className="ai-details-grid">
            <div className="ai-card">
              <small>Suggested Category</small>
              <p><b>{aiTriage.category}</b> (Impact: {aiTriage.impact}/3 · Urgency: {aiTriage.urgency}/3)</p>
            </div>
            <div className="ai-card">
              <small>Missing information</small>
              <p>{aiTriage.missing_information?.join(', ') || 'None identified'}</p>
            </div>
            <div className="ai-card">
              <small>Clarifying questions</small>
              <p>{aiTriage.clarifying_questions?.join(' ') || 'None identified'}</p>
            </div>
          </div>
        </div>
      )}

      {dupWarning && (
        <div className="duplicate-warning" style={{ background: '#fff4d6', border: '1px solid #ffd166', borderRadius: 12, padding: 14, marginBottom: 18, color: '#854d0e', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertCircle size={22} style={{ flexShrink: 0 }} />
          <div>
            <b>Duplicate Detected:</b> {dupWarning}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="form-grid">
        <div className="wide issue-types">
          <span className="field-label">Common issues: pick one to fill in the form</span>
          {[['online', 'IT & accounts'], ['academics', 'Classrooms & labs'], ['hostel', 'Hostel room repairs']].map(([mode, label]) => (
            <div className="issue-group" key={mode}>
              <small>{label}</small>
              <div className="chip-row">
                {ISSUE_TYPES.filter(t => t.mode === mode).map(t => (
                  <button key={t.key} type="button" className={`chip${issueType?.key === t.key ? ' active' : ''}`}
                    aria-pressed={issueType?.key === t.key} onClick={() => applyIssueType(t)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label className="wide">
          Incident Title
          <input
            required
            minLength={4}
            maxLength={160}
            value={f.title}
            onChange={e => setF({ ...f, title: e.target.value })}
            placeholder="e.g. Wi-Fi router offline on Krishna Bhavan 2nd floor wing B"
          />
        </label>

        {asset && (
          <motion.div className="wide asset-banner" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}>
            <QrCode size={20} />
            <div>
              <b>Reporting: {asset.name}</b>
              <small>{asset.location?.formatted} · sticker {asset.code}</small>
              {asset.open_reports > 0 && (
                <small className="asset-warn">{asset.open_reports} open report{asset.open_reports === 1 ? '' : 's'} already exist for this — a technician may already be on it.</small>
              )}
            </div>
          </motion.div>
        )}

        <div className="wide description-field">
          <div className="label-row description-head">
            <label htmlFor="incident-description">Description & Symptoms</label>
            <DictateButton
              label="Speak instead"
              onText={text => setF(prev => ({ ...prev, description: prev.description ? `${prev.description.replace(/\s+$/, '')} ${text}` : text }))}
              onDone={() => { if (aiAfterDictation) setTimeout(generateDetails, 150); }}
            />
          </div>
          <textarea
            id="incident-description"
            required
            minLength={10}
            rows="5"
            value={f.description}
            onChange={e => setF({ ...f, description: e.target.value })}
            ref={descriptionRef}
            onPaste={onPasteFiles}
            placeholder={issueType?.hint || 'Describe your IT problem in your own words... (you can also drop a photo or paste a screenshot here)'}
          />
          {speechSupported && (
            <label className="check-inline small-text">
              <input type="checkbox" checked={aiAfterDictation} onChange={e => setAiAfterDictation(e.target.checked)} />
              After I finish speaking, fill in the rest of the form with AI
            </label>
          )}
        </div>

        {/* Assistance and location */}
        <div className="wide location-selector">
          <div className="location-selector-title">
            <Building2 size={18} color="#ea580c" />
            <b>Issue type</b>
          </div>

          <div className="issue-mode-options">
            <label className="location-type-option">
              <input
                type="radio"
                name="assistance_mode"
                checked={isOfflineIssue}
                onChange={() => selectAssistance('offline')}
              />
              <span>Offline issue</span>
            </label>
            <label className="location-type-option">
              <input
                type="radio"
                name="assistance_mode"
                checked={!isOfflineIssue}
                onChange={() => selectAssistance('online')}
              />
              <span>Online / student issue</span>
            </label>
          </div>

          {isOfflineIssue && <>
            <div className="offline-location-options">
              <span>Location</span>
              <label className="location-type-option">
                <input type="radio" name="offline_location" checked={f.location_type === 'hostel'} onChange={() => selectOfflineLocation('hostel')} />
                <span>Hostel (Bhavan)</span>
              </label>
              <label className="location-type-option">
                <input type="radio" name="offline_location" checked={f.location_type === 'academics'} onChange={() => selectOfflineLocation('academics')} />
                <span>Academic Block / Facilities</span>
              </label>
            </div>
            <div className="location-fields">
              {f.location_type === 'hostel' ? (
              <label>
                Hostel Name
                <select
                  value={f.hostel_name}
                  onChange={e => setF({ ...f, hostel_name: e.target.value })}
                >
                  {HOSTELS.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Academic Block
                <select
                  value={f.academic_block}
                  onChange={e => setF({ ...f, academic_block: e.target.value })}
                >
                  {ACADEMIC_BLOCKS.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Room / Lab Number
              <input
                required
                value={f.room_number}
                onChange={e => setF({ ...f, room_number: e.target.value })}
                placeholder={f.location_type === 'hostel' ? 'e.g. 204 or 115' : 'e.g. Lab 203 or LTC-101'}
              />
            </label>
            {f.location_type === 'hostel' && (
              <label className="wide-field">
                <span className="label-row">When can someone visit your room? <span className="optional">(optional)</span></span>
                <input
                  maxLength={200}
                  value={f.visit_availability}
                  onChange={e => setF({ ...f, visit_availability: e.target.value })}
                  placeholder="e.g. Weekdays after 5 pm, or any time on Saturday"
                />
              </label>
            )}
            </div>
            <LocationCapture value={geoFix} onChange={setGeoFix}
              buildingLabel={f.location_type === 'hostel' ? f.hostel_name : f.academic_block} />
          </>}
          {!isOfflineIssue && (
            <div className="location-fields online-location">
              <label>
                <span className="label-row">Where is this happening? <span className="optional">(optional)</span></span>
                <select value={f.online_place} onChange={e => setF({ ...f, online_place: e.target.value })}>
                  <option value="">Not location-specific / off campus</option>
                  <optgroup label="Hostels">{HOSTELS.map(h => <option key={h} value={`hostel:${h}`}>{h}</option>)}</optgroup>
                  <optgroup label="Academic blocks & facilities">{ACADEMIC_BLOCKS.map(b => <option key={b} value={`block:${b}`}>{b}</option>)}</optgroup>
                </select>
              </label>
              <label>
                <span className="label-row">Room / Lab <span className="optional">(optional)</span></span>
                <input value={f.room_number} onChange={e => setF({ ...f, room_number: e.target.value })} placeholder="e.g. 204 or Lab 203" />
              </label>
            </div>
          )}
        </div>

        {/* Evidence: a photo of the problem and/or a voice note ("this is the noise it makes") */}
        {(
          <div className="wide evidence-field">
            <span className="field-label">Photo or voice note <span className="optional">(optional — often saves the technician a trip)</span></span>
            <div className="chip-row">
              <PhotoButton stage="before" label="Add a photo" className="secondary small"
                onPicked={file => setPendingFiles(list => [...list, { ...file, key: Date.now() }])} />
              <VoiceRecorder compact onReady={note => setPendingFiles(list => [...list, { ...note, key: Date.now() }])} />
            </div>
            <HaloDropzone compact accept="image/*,audio/*,.txt" onFiles={addFiles}
              label="Drop photos or recordings here, or click to choose"
              hint="Photos are resized automatically · audio up to 3 min · you can also paste a screenshot into the description" />
            {pendingFiles.length > 1 && <small className="muted">Drag to reorder — they're attached in this order.</small>}
            <Reorder.Group axis="y" values={pendingFiles} onReorder={setPendingFiles} className="reorder-list">
              <AnimatePresence initial={false}>
                {pendingFiles.map(file => (
                  <Reorder.Item key={file.key} value={file} className="pending-file" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: DURATION.base, ease: EASE_OUT }}
                    whileDrag={{ scale: 1.03, boxShadow: '0 18px 30px -16px rgba(26,27,58,.5)' }}>
                    <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
                    {file.kind === 'photo'
                      ? <><img src={file.previewUrl} alt="Attached" draggable={false} /><span><ImageIcon size={14} /> Photo</span></>
                      : <VoiceNotePlayer note={{ id: null, previewUrl: file.previewUrl, duration_s: file.duration_s, transcript: file.transcript, uploaded_by_name: file.name }} />}
                    <button type="button" className="icon-btn small" aria-label="Remove"
                      onClick={() => setPendingFiles(list => list.filter(x => x.key !== file.key))}><X size={15} /></button>
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </div>
        )}

        {/* Student Contact Info (staff reporting on someone's behalf don't have a BITS ID) */}
        {user?.role === 'customer' && (
          <label>
            Student ID
            <input
              readOnly
              value={f.student_id || 'Auto-derived'}
              className="readonly-field"
            />
          </label>
        )}

        <label>
          Phone Number for Contact
          <input
            type="tel"
            required
            value={f.phone}
            onChange={e => setF({ ...f, phone: e.target.value })}
            placeholder="+91 98765 43210"
          />
        </label>

        {showServicePicker && <label>
          <span className="label-row">Affected Campus Service {autoFilled.service && <span className="auto-tag">Auto-detected</span>}</span>
          <select
            required
            value={effectiveServiceId()}
            onChange={e => { touched.current.service = true; setAutoFilled(a => ({ ...a, service: false })); setF({ ...f, service_id: e.target.value }); }}
          >
            {availableServices.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>}

        <label>
          <span className="label-row">{isOfflineIssue ? 'Support needed' : 'Category'} {autoFilled.category && <span className="auto-tag">Auto-detected</span>}</span>
          <select
            value={f.category}
            onChange={e => { touched.current.category = true; setAutoFilled(a => ({ ...a, category: false })); chooseCategory(e.target.value); }}
          >
            {availableCategories.map(c => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          {suggestions?.categories?.some(c => c.name !== f.category) && (
            <span className="also-possible">
              Also possible:{' '}
              {suggestions.categories.filter(c => c.name !== f.category).slice(0, 2).map(c => (
                <button key={c.name} type="button" className="link-btn" onClick={() => { touched.current.category = true; setAutoFilled(a => ({ ...a, category: false })); chooseCategory(c.name); }}>
                  {c.name}
                </button>
              ))}
            </span>
          )}
        </label>

        <label>
          Impact
          <select value={f.impact} onChange={e => setF({ ...f, impact: +e.target.value })}>
            <option value="1">1 — Low (Single room / personal)</option>
            <option value="2">2 — Medium (Wing / lab / department)</option>
            <option value="3">3 — High (Entire Bhavan / campus outage)</option>
          </select>
        </label>

        <label>
          Urgency
          <select value={f.urgency} onChange={e => setF({ ...f, urgency: +e.target.value })}>
            <option value="1">1 — Low</option>
            <option value="2">2 — Medium</option>
            <option value="3">3 — Critical / Exam Impact</option>
          </select>
        </label>

        <label>
          Business Criticality
          <select value={f.business_criticality} onChange={e => setF({ ...f, business_criticality: +e.target.value })}>
            <option value="1">1 — Low (inconvenience)</option>
            <option value="2">2 — Important (blocks coursework / work)</option>
            <option value="3">3 — Critical (exams, payments, safety)</option>
          </select>
        </label>

        <label>
          Estimated Affected Persons
          <input
            type="number"
            min="1"
            value={f.affected_users}
            onChange={e => setF({ ...f, affected_users: Math.max(1, +e.target.value || 1) })}
          />
        </label>

        {dupWarning && (
          <label className="wide" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={f.acknowledge_duplicate}
              onChange={e => setF({ ...f, acknowledge_duplicate: e.target.checked })}
            />
            <span>Confirm and submit despite potential duplicate match</span>
          </label>
        )}

        <div className="form-actions wide">
          <button className="primary" disabled={busy || !availableServices.length || !availableCategories.length} type="submit">
            {busy ? 'Submitting…' : 'Submit Report'}
            <ChevronRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function UsersPage({ me }) {
  const [users, setUsers] = useState([]);
  const [filterRole, setFilterRole] = useState('all');
  const [accountQuery, setAccountQuery] = useState('');
  const [adminModal, setAdminModal] = useState(false);
  const [techModal, setTechModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);

  // New Admin Form
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: ''
  });

  // New Tech Form
  const [techForm, setTechForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    skills: [],
    max_concurrent: 5
  });

  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/admin/users')
      .then(x => setUsers(x.data))
      .catch(() => toast.error('Could not load user accounts'));
  };

  useEffect(load, []);

  const resetTwoFactor = async user => {
    try {
      await api.post(`/admin/users/${user.id}/reset-2fa`);
      toast.success(`${user.name} can now sign in with just their password and set up the app again`);
      setResetting(null);
      load();
    } catch (e) {
      toast.error(errMsg(e) || 'Could not reset the authenticator');
    }
  };

  const toggleActive = async (uid, current) => {
    try {
      await api.patch(`/admin/users/${uid}/active`, { is_active: !current });
      toast.success('User status updated');
      load();
    } catch (e) {
      toast.error(errMsg(e) || 'Could not update user');
    }
  };

  const handleCreateAdmin = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/users', {
        ...adminForm,
        role: 'admin'
      });
      toast.success(`Admin account for ${adminForm.email} created!`);
      setAdminModal(false);
      setAdminForm({ name: '', email: '', password: '', phone: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err) || 'Failed to create admin');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTech = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/users', {
        ...techForm,
        role: 'technician'
      });
      toast.success(`Technician account for ${techForm.email} created!`);
      setTechModal(false);
      setTechForm({ name: '', email: '', password: '', phone: '', skills: [], max_concurrent: 5 });
      load();
    } catch (err) {
      toast.error(errMsg(err) || 'Failed to create technician');
    } finally {
      setBusy(false);
    }
  };

  const toggleSkill = skill => {
    setTechForm(prev => {
      const skills = prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill];
      return { ...prev, skills };
    });
  };

  const filteredUsers = users.filter(x => {
    const matchesRole = filterRole === 'all' || x.role === filterRole;
    const search = accountQuery.trim().toLowerCase();
    const matchesSearch = !search || [x.name, x.email, x.student_id, x.phone]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(search));
    return matchesRole && matchesSearch;
  });

  const roleCount = role => users.filter(user => user.role === role).length;
  const activeCount = users.filter(user => user.is_active).length;

  return (
    <>
      <section className="account-overview">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h2>Account directory</h2>
          <p className="muted">Review access, contact details, technical capacity, and account status in one place.</p>
        </div>
        <div className="account-summary">
          <div><span>Total</span><b>{users.length}</b></div>
          <div><span>Active</span><b>{activeCount}</b></div>
          <div><span>Team</span><b>{roleCount('admin') + roleCount('technician')}</b></div>
        </div>
      </section>

      <div className="account-controls">
        <div className="account-filters">
          <button
            className={filterRole === 'all' ? 'primary small' : 'secondary small'}
            onClick={() => setFilterRole('all')}
          >
            All Accounts ({users.length})
          </button>
          <button
            className={filterRole === 'customer' ? 'primary small' : 'secondary small'}
            onClick={() => setFilterRole('customer')}
          >
            Students ({roleCount('customer')})
          </button>
          <button
            className={filterRole === 'technician' ? 'primary small' : 'secondary small'}
            onClick={() => setFilterRole('technician')}
          >
            Technicians ({roleCount('technician')})
          </button>
          <button
            className={filterRole === 'admin' ? 'primary small' : 'secondary small'}
            onClick={() => setFilterRole('admin')}
          >
            Admins ({roleCount('admin')})
          </button>
        </div>

        <div className="account-actions">
          <label className="account-search">
            <Search size={16} />
            <input value={accountQuery} onChange={e => setAccountQuery(e.target.value)} placeholder="Search name, email, ID..." aria-label="Search accounts" />
          </label>
          <button className="primary small" onClick={() => setAdminModal(true)}>
            <UserPlus size={14} /> + Add Admin
          </button>
          <button className="secondary small" onClick={() => setTechModal(true)}>
            <Wrench size={14} /> + Add Technician
          </button>
        </div>
      </div>

      <div className="account-result-label">Showing {filteredUsers.length} of {users.length} accounts</div>
      <div className="account-card-grid">
        {filteredUsers.map(x => (
          <article className="account-card" key={x.id}>
            <div className="account-card-head">
              <div className="account-avatar">{(x.name || '?').trim().charAt(0).toUpperCase()}</div>
              <div className="account-identity">
                <h3>{x.name}</h3>
                <span>{x.email}</span>
              </div>
              <Badge v={roleLabel(x.role)} />
            </div>
            <div className="account-details">
              <div><span>Account status</span><b className={x.is_active ? 'account-active' : 'account-disabled'}>{x.is_active ? 'Active' : 'Disabled'}</b></div>
              <div><span>{x.role === 'customer' ? 'BITS ID' : 'Phone'}</span><b>{x.role === 'customer' ? (x.student_id || 'Not provided') : (x.phone || 'Not provided')}</b></div>
              <div><span>{x.role === 'technician' ? 'Capacity' : 'Access scope'}</span><b>{x.role === 'technician' ? `${x.max_concurrent || 5} concurrent` : x.role === 'admin' ? 'Full administration' : 'Student portal'}</b></div>
            </div>
            {x.role === 'technician' && <div className="account-skills"><span>Skills</span><p>{(x.skills || []).join(' · ') || 'General IT'}</p></div>}
            {x.role === 'customer' && x.phone && <div className="account-skills"><span>Phone</span><p>{x.phone}</p></div>}
            <div className="account-skills"><span>Two-step sign-in</span><p>{x.totp_enabled ? 'Authenticator app on' : 'Off'}</p></div>
            <div className="chip-row account-toggle">
              <button className="secondary small" onClick={() => setEditing(x)}><Pencil size={13} /> Edit</button>
              {x.totp_enabled && x.id !== me?.id && (
                <button className="secondary small" onClick={() => setResetting(x)}><Smartphone size={13} /> Reset authenticator</button>
              )}
              <button className="secondary small" onClick={() => toggleActive(x.id, x.is_active)}>
                {x.is_active ? 'Disable account' : 'Enable account'}
              </button>
            </div>
          </article>
        ))}
        {!filteredUsers.length && <div className="panel empty">No accounts match the selected filters.</div>}
      </div>

      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      {resetting && (
        <Modal title="Reset authenticator app?" onClose={() => setResetting(null)}>
          <p className="small-text">
            Use this when <b>{resetting.name}</b> has lost their phone <i>and</i> their backup codes. Two-step sign-in is
            turned off, so they can sign in with their password and then set up the app again. Make sure the request
            really comes from them.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setResetting(null)}>Cancel</button>
            <button className="primary" onClick={() => resetTwoFactor(resetting)}>Reset authenticator</button>
          </div>
        </Modal>
      )}

      {/* Add Admin Modal */}
      {adminModal && (
        <div className="modal-overlay" onClick={() => setAdminModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={20} color="#ea580c" />
                <h3>Create New Administrator Account</h3>
              </div>
              <button className="modal-close" onClick={() => setAdminModal(false)}><X size={20} /></button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Administrators have full access to campus dispatch, SLA policy management, and user administration. Admin accounts can have any email domain.
            </p>
            <form onSubmit={handleCreateAdmin} style={{ display: 'grid', gap: 14 }}>
              <label>
                Full Name
                <input
                  required
                  value={adminForm.name}
                  onChange={e => setAdminForm({ ...adminForm, name: e.target.value })}
                  placeholder="e.g. Dr. Rajesh Kumar"
                />
              </label>
              <label>
                Admin Email (Any Domain Allowed)
                <input
                  required
                  type="email"
                  value={adminForm.email}
                  onChange={e => setAdminForm({ ...adminForm, email: e.target.value })}
                  placeholder="e.g. rajesh.admin@bits-pilani.ac.in or admin@gmail.com"
                />
              </label>
              <label>
                Temporary Password
                <input
                  required
                  type="password"
                  minLength={8}
                  value={adminForm.password}
                  onChange={e => setAdminForm({ ...adminForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </label>
              <label>
                Phone Number (Optional)
                <input
                  type="tel"
                  value={adminForm.phone}
                  onChange={e => setAdminForm({ ...adminForm, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </label>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="secondary" type="button" onClick={() => setAdminModal(false)}>Cancel</button>
                <button className="primary" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create Administrator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Technician Modal */}
      {techModal && (
        <div className="modal-overlay" onClick={() => setTechModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wrench size={20} color="#00f0ff" />
                <h3>Add Campus Technician Account</h3>
              </div>
              <button className="modal-close" onClick={() => setTechModal(false)}><X size={20} /></button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Technicians can be assigned tickets, acknowledge and resolve campus incidents. Concurrency controls ensure fair load distribution.
            </p>
            <form onSubmit={handleCreateTech} style={{ display: 'grid', gap: 14 }}>
              <label>
                Technician Name
                <input
                  required
                  value={techForm.name}
                  onChange={e => setTechForm({ ...techForm, name: e.target.value })}
                  placeholder="e.g. Suresh IT"
                />
              </label>
              <label>
                Technician Email (Any Domain Allowed)
                <input
                  required
                  type="email"
                  value={techForm.email}
                  onChange={e => setTechForm({ ...techForm, email: e.target.value })}
                  placeholder="e.g. suresh.tech@campus.in"
                />
              </label>
              <label>
                Temporary Password
                <input
                  required
                  type="password"
                  minLength={8}
                  value={techForm.password}
                  onChange={e => setTechForm({ ...techForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </label>
              <label>
                Phone Number
                <input
                  type="tel"
                  value={techForm.phone}
                  onChange={e => setTechForm({ ...techForm, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </label>

              <div>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  Support Skills / Domains
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ALL_SKILLS.map(s => {
                    const sel = techForm.skills.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSkill(s)}
                        className={sel ? 'primary small' : 'secondary small'}
                        style={{ borderRadius: 6 }}
                      >
                        {sel ? <Check size={12} /> : null} {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label>
                Max Concurrent Ticket Capacity
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={techForm.max_concurrent}
                  onChange={e => setTechForm({ ...techForm, max_concurrent: +e.target.value })}
                />
              </label>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="secondary" type="button" onClick={() => setTechModal(false)}>Cancel</button>
                <button className="primary" type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Register Technician'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Notifications({ onChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/notifications')
      .then(x => { setData(x.data); setError(''); onChange?.(x.data.unread); })
      .catch(e => setError(errMsg(e) || 'Could not load notifications.'));
  };

  useEffect(load, []);

  const read = async id => {
    try {
      await api.post('/notifications/' + id + '/read');
      load();
    } catch {
      toast.error('Could not mark read');
    }
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      load();
    } catch {
      toast.error('Could not mark all read');
    }
  };

  if (error) return <div className="panel empty">{error}</div>;
  if (!data) return <Loading />;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3>System & Dispatch Notifications</h3>
          <p className="muted">{data.unread} unread notifications</p>
        </div>
        {data.unread > 0 && <button className="secondary small" onClick={readAll}>Mark all read</button>}
      </div>
      {data.items && data.items.length ? data.items.map(n => (
        <div className={`row${n.read ? '' : ' unread'}`} key={n.id}>
          <span>
            <b>{n.title}</b>
            <small>{n.message} · {fmt(n.created_at)}</small>
          </span>
          <span className="chip-row">
            {n.incident_id && <Link className="secondary small" to={`/incidents/${n.incident_id}`} onClick={() => !n.read && read(n.id)}>Open {n.incident_number}</Link>}
            {!n.read && <button className="secondary small" onClick={() => read(n.id)}>Mark read</button>}
          </span>
        </div>
      )) : <Empty />}
    </div>
  );
}

const DOC_SECTIONS = [
  ['Lifecycle', 'Report → Classify → Prioritise → Assign → Acknowledge → Investigate → (Request info) → Resolve → Verify → Close. ' +
    'Illegal moves (for example NEW → CLOSED) are blocked, and each role can only make the moves it is allowed to.'],
  ['Students', 'Report an issue, track its status, add information when a technician asks for it, see how it was resolved, ' +
    'confirm the fix or reopen it, and leave a rating and comment when closing.'],
  ['Technicians', 'Claim incidents from the queue, acknowledge them, add investigation notes, request more information, ' +
    'resolve with a summary and root cause, and see suggested fixes from similar past incidents.'],
  ['Priority', 'Calculated automatically from impact, urgency, business criticality, the affected service’s criticality ' +
    'and the number of people affected. Administrators choose the algorithm (weighted score or impact × urgency matrix).'],
  ['Assignment', 'Six interchangeable strategies: smart recommendation, skill-based, load-balanced, round robin, ' +
    'experience-based and priority-based. Administrators pick the active one under Configuration.'],
  ['SLA & escalation', 'Every incident gets response and resolution deadlines from its SLA policy. A background monitor ' +
    'warns before deadlines, records each violation, and escalates unacknowledged P1/P2 incidents: Team Lead → System ' +
    'Administrator → IT Manager.'],
  ['Intelligent features', 'AI-assisted report writing and categorisation, duplicate detection, correlation of incidents on ' +
    'the same service (possible major incident), smart technician recommendation, SLA risk detection and suggested resolutions.'],
  ['Notifications & audit', 'People are notified in the app and by (simulated) email when something relevant happens; ' +
    'resolutions, SLA breaches and escalations can also be sent by real email. Every action is recorded in the incident history and the audit log.']
];

function Docs() {
  return (
    <div className="panel">
      <span className="eyebrow">CAMPUS IT OPERATIONS</span>
      <h3>BITS reports guide</h3>
      <p className="muted" style={{ marginBottom: 16 }}>How incidents move through BITS reports, for students, technicians and administrators.</p>
      {DOC_SECTIONS.map(([title, body], n) => (
        <div key={title} style={{ marginTop: 18 }}>
          <h4>{n + 1}. {title}</h4>
          <p className="doc-text">{body}</p>
        </div>
      ))}
    </div>
  );
}

export default App;
