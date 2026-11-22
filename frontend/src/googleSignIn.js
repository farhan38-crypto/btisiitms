// Google sign-in using a full-page redirect (OpenID Connect implicit flow).
//
// Why a redirect instead of Google One Tap (google.accounts.id.prompt()):
// - On phones One Tap is often suppressed without any error: iOS Safari has no FedCM,
//   third-party cookies are blocked, and after a user dismisses it once Google hides it
//   for a cool-down period. The button then appeared to "do nothing".
// - One Tap with auto_select picks an account by itself, so people signed in to several
//   Google accounts never saw a choice (and got signed in with a personal account).
// A redirect needs no popups or third-party cookies, works on every mobile browser, and
// `prompt=select_account` makes Google always show the account chooser.
//
// Google Cloud Console setup (OAuth client of type "Web application"):
//   Authorized redirect URIs   -> <every address you open the app from> + /login
//                                 e.g. http://localhost:3000/login and https://<your-tunnel>/login
// Google only accepts https:// addresses, or http://localhost. A phone opening
// http://192.168.x.x:3000 can never use Google sign-in; open the https tunnel URL instead.

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;
const STORAGE_KEY = 'itsm_google_oauth';

export const googleConfigured = () => Boolean(CLIENT_ID);

export const redirectUri = () => `${window.location.origin}/login`;

// Google refuses plain-http addresses other than localhost (e.g. a LAN IP), so explain
// that up front instead of sending the user to Google's error page.
export function originProblem() {
  const { protocol, hostname, origin } = window.location;
  const isLocal = ['localhost', '127.0.0.1'].includes(hostname);
  if (protocol !== 'https:' && !isLocal) {
    return `Google sign-in needs a secure (https://) address, and ${origin} is not one. ` +
      'Open the app through its https tunnel link instead (or sign in with email and password).';
  }
  return '';
}

function randomString() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function startGoogleSignIn() {
  const state = randomString();
  const nonce = randomString();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ state, nonce }));
  } catch {
    // Private browsing with storage disabled: continue; the server still verifies the token.
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    prompt: 'select_account', // always show the account chooser
    state,
    nonce
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

// Reads Google's reply from the address bar after the redirect back to /login.
// Returns null when this page load is not a Google reply.
export function takeGoogleRedirectResult() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const reply = new URLSearchParams(hash);
  if (!reply.has('id_token') && !reply.has('error')) return null;

  // Remove the token from the address bar and history right away.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}

  const error = reply.get('error');
  if (error) {
    const messages = {
      access_denied: 'Google sign-in was cancelled.',
      redirect_uri_mismatch: `This address is not registered with Google. Add ${redirectUri()} to the OAuth client's Authorized redirect URIs.`
    };
    return { error: messages[error] || `Google sign-in failed (${error}).` };
  }
  if (saved.state && reply.get('state') !== saved.state) {
    return { error: 'Google sign-in could not be confirmed. Please try again.' };
  }
  return { credential: reply.get('id_token'), nonce: saved.nonce };
}
