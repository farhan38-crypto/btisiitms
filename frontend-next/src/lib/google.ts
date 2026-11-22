// Google sign-in with a full-page redirect (OpenID Connect implicit flow, response_type=id_token).
// No popups or third-party cookies, so it works in every mobile browser and through ngrok.
// The backend (POST /auth/google) verifies the ID token and the nonce we generated here.
//
// Google Cloud console → OAuth client → Authorized redirect URIs must contain <origin>/login
// for every address the app is opened from (localhost, the ngrok domain…).

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
const KEY = 'bits-google-oidc'
export const redirectUri = () => `${window.location.origin}/login`
export const googleReady = () => !!CLIENT_ID
/** Google refuses plain-http addresses other than localhost. */
export const originProblem = () =>
  window.location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'Google sign-in needs https (open the ngrok address) or localhost.' : null

const random = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join('') }

export function startGoogleSignIn(hint?: string) {
  const state = random(), nonce = random()
  sessionStorage.setItem(KEY, JSON.stringify({ state, nonce }))
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'id_token', scope: 'openid email profile',
    state, nonce, prompt: 'select_account', hd: 'hyderabad.bits-pilani.ac.in',
  })
  if (hint) p.set('login_hint', hint)
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`)
}

/** After the redirect: Google's reply is in the URL fragment. Returns null when there is none. */
export function takeGoogleResult(): { credential: string; nonce: string } | { error: string } | null {
  if (!window.location.hash.includes('id_token') && !window.location.hash.includes('error')) return null
  const reply = new URLSearchParams(window.location.hash.slice(1))
  history.replaceState(null, '', window.location.pathname + window.location.search)
  let saved: { state?: string; nonce?: string } = {}
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || '{}') } catch { /* ignore */ }
  sessionStorage.removeItem(KEY)
  const err = reply.get('error')
  if (err) return { error: err === 'access_denied' ? 'Google sign-in was cancelled.'
    : err === 'redirect_uri_mismatch' ? `This address is not registered with Google. Add ${redirectUri()} to the OAuth client's Authorized redirect URIs.`
    : `Google sign-in failed (${err}).` }
  if (!saved.state || reply.get('state') !== saved.state || !saved.nonce) return { error: 'Google sign-in could not be confirmed. Please try again.' }
  const credential = reply.get('id_token')
  return credential ? { credential, nonce: saved.nonce } : { error: 'Google did not send an ID token.' }
}
