// The app shell: backdrop and light, navigation (top bar on desktop, tab bar on phones),
// command palette, toasts for live events, and the routes. Every screen is native to this
// app and talks to the backend through src/api.
//
// Old addresses keep working (/report, /campus-map, /admin, /incidents/new?asset=…), so QR
// stickers and links in emails still open the right screen.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { Toaster, toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { AuthProvider, useAuth, isStaff, isAdmin } from './lib/auth'
import { startLive, stopLive, useLive, type LiveEvent, type User } from './api'
import { eventLabel } from './lib/format'
import { useIsPhone } from './lib/media'
import { Backdrop, Light } from './components/Backdrop'
import { AppearanceHost } from './components/ThemePicker'
import { ConfirmProvider } from './ui/Overlay'
import { TopBar } from './shell/TopBar'
import { SideNav, AppBar } from './shell/SideNav'
import { useLayout, useNav, usesCards } from './lib/layout'
import { startTilt } from './lib/tilt'

startTilt()
import { BottomNav } from './shell/BottomNav'
import { CommandPalette, useCommandShortcut } from './shell/CommandPalette'
import { ErrorBoundary, OfflineBanner } from './shell/Errors'
import Login from './pages/Login'
import Overview from './pages/Overview'
import StudentHome from './features/home/StudentHome'
import IncidentsPage from './features/incidents/IncidentsPage'

const IncidentPage = lazy(() => import('./features/incident/IncidentPage'))
const ReportPage = lazy(() => import('./features/report/ReportPage'))
const ReportFlow = lazy(() => import('./features/report/ReportFlow'))
const OverviewFocused = lazy(() => import('./pages/OverviewFocused'))
const OverviewMaterial = lazy(() => import('./pages/OverviewMaterial'))
const MapPage = lazy(() => import('./pages/MapPage'))
const InboxPage = lazy(() => import('./features/inbox/Inbox'))
const AccountPage = lazy(() => import('./features/account/AccountPage'))
const DocsPage = lazy(() => import('./features/docs/DocsPage'))
const UsersPage = lazy(() => import('./features/admin/UsersPage'))
const ConfigPage = lazy(() => import('./features/admin/ConfigPage'))
const AuditPage = lazy(() => import('./features/admin/AuditPage'))
const AssetsPage = lazy(() => import('./features/admin/AssetsPage'))

function ReportRedirect() { const [p] = useSearchParams(); return <Navigate to={`/incidents/new${p.toString() ? `?${p}` : ''}`} replace /> }
const Lazy = ({ children }: { children: ReactNode }) => <Suspense fallback={<main className="page"><div className="page-wait" /></main>}>{children}</Suspense>

/** Which live events deserve a toast for this person (the rest just refresh the screens). */
function toastFor(ev: LiveEvent, user: User): string | null {
  if (ev.actor_id === user.id) return null
  if (user.role === 'customer') return `${eventLabel(ev.type)} · ${ev.number}`
  const loud = ['SLA_BREACHED', 'ESCALATED', 'CORRELATION_DETECTED', 'REOPENED']
  if (loud.includes(ev.type)) return `${eventLabel(ev.type)} · ${ev.number}`
  if (ev.type === 'INCIDENT_CREATED' && (ev.priority === 'P1' || ev.priority === 'P2')) return `New ${ev.priority} · ${ev.number}`
  if (ev.type === 'ASSIGNED' && ev.description.includes(user.name)) return `Assigned to you · ${ev.number}`
  if (ev.type === 'NOTE_ADDED' && user.role === 'technician') return `New note · ${ev.number}`
  return null
}

function Shell() {
  const { user, ready, theme, prefs } = useAuth()
  const layout = useLayout()
  const nav = useNav()
  const location = useLocation()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const [palette, setPalette] = useState(false)
  const openPalette = useCallback(() => setPalette(true), [])
  useCommandShortcut(openPalette)
  // A new page starts at the top (back/forward keep where you were).
  const navType = useNavigationType()
  useEffect(() => { if (navType !== 'POP') window.scrollTo({ top: 0 }) }, [location.pathname, navType])
  useEffect(() => { if (user) startLive(); else stopLive() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useLive(ev => {
    if (!user) return
    const text = toastFor(ev, user)
    if (!text) return
    toast(text, { description: ev.description,
      action: location.pathname.endsWith(ev.incident_id) ? undefined : { label: 'Open', onClick: () => navigate(`/incidents/${ev.incident_id}`) } })
  })

  if (!ready) return <Backdrop theme={theme} />
  const staff = isStaff(user), admin = isAdmin(user)
  const adminOnly = (el: ReactNode) => admin ? <Lazy>{el}</Lazy> : <Navigate to="/" replace />

  return (
    <MotionConfig reducedMotion={prefs.reduce_motion ? 'always' : 'user'}>
      {/* Material is flat: no moving backdrop or light once signed in. */}
      {!(user && layout === 'material') && <><Backdrop theme={theme} intensity={user ? 0.7 : 1} /><Light /></>}
      <Toaster position={phone ? 'top-center' : 'bottom-right'} theme={theme.scheme} closeButton />
      <AppearanceHost />
      {!user ? <Routes><Route path="*" element={<Login />} /></Routes> : (
        <ConfirmProvider>
          {phone ? <BottomNav onSearch={openPalette} /> : nav === 'side' ? <><SideNav /><AppBar onSearch={openPalette} /></> : <TopBar onSearch={openPalette} />}
          <div className="shell-banners">
            <OfflineBanner />
            {user.two_factor_required && !user.two_factor_enabled && location.pathname !== '/account' && (
              <div className="banner glass" role="alert"><AlertTriangle size={16} />
                <span><b>Administrators must use an authenticator app.</b> Admin pages stay locked until you turn it on. <Link to="/account#security">Set it up</Link></span></div>
            )}
          </div>
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
          <ErrorBoundary resetKey={location.pathname}>
            <Routes>
              <Route path="/" element={!staff ? <StudentHome /> : usesCards(layout) ? <Lazy><OverviewMaterial /></Lazy> : layout === 'focused' ? <Lazy><OverviewFocused /></Lazy> : <Overview />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/admin" element={<Navigate to="/" replace />} />
              <Route path="/incidents" element={<IncidentsPage />} />
              <Route path="/incidents/new" element={<Lazy>{layout === 'classic' ? <ReportPage /> : <ReportFlow />}</Lazy>} />
              <Route path="/report" element={<ReportRedirect />} />
              <Route path="/incidents/:id" element={<Lazy><IncidentPage /></Lazy>} />
              <Route path="/map" element={staff ? <Lazy><MapPage /></Lazy> : <Navigate to="/" replace />} />
              <Route path="/campus-map" element={<Navigate to="/map" replace />} />
              <Route path="/notifications" element={<Lazy><InboxPage /></Lazy>} />
              <Route path="/account" element={<Lazy><AccountPage /></Lazy>} />
              <Route path="/docs" element={<Lazy><DocsPage /></Lazy>} />
              <Route path="/admin/users" element={adminOnly(<UsersPage />)} />
              <Route path="/admin/settings" element={adminOnly(<ConfigPage />)} />
              <Route path="/admin/audit" element={adminOnly(<AuditPage />)} />
              <Route path="/admin/assets" element={adminOnly(<AssetsPage />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </ConfirmProvider>
      )}
    </MotionConfig>
  )
}

export default function App() {
  return <BrowserRouter><AuthProvider><Shell /></AuthProvider></BrowserRouter>
}
