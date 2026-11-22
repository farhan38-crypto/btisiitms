import axios from 'axios';

// Where the backend lives.
// On the computer running the app, REACT_APP_BACKEND_URL (http://localhost:8000) is used directly.
// When the site is opened from another device (a phone on the same Wi-Fi, or a tunnel URL), "localhost"
// would mean that device, so requests go to the same address as the page instead; the dev server
// forwards /api to the backend (see src/setupProxy.js).
const configuredBackend = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
const backendIsLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBackend);
const openedFromAnotherDevice = !['localhost', '127.0.0.1'].includes(window.location.hostname);
const backendBase = configuredBackend && !(backendIsLocalhost && openedFromAnotherDevice) ? configuredBackend : '';
export const API = backendBase + '/api';

const api = axios.create({ baseURL: API });

api.interceptors.request.use(c => {
  const t = localStorage.getItem('itsm_token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

// Readable browser-console entry for every failed API call, with the request
// id that matches the entry in backend/logs/errors.log.
function logApiFailure(error) {
  const method = (error.config?.method || 'get').toUpperCase();
  const url = error.config?.url || '';
  if (!error.response) {
    console.error(
      `[BITS reports] ${method} ${url} — no response from the server at ${API}.\n` +
      'Likely cause: the backend is not running, REACT_APP_BACKEND_URL is wrong, or the network is down.',
      error.message
    );
    return;
  }
  const { status, statusText, data } = error.response;
  const requestId = data?.request_id || error.response.headers?.['x-request-id'];
  const write = status >= 500 ? console.error : console.warn;
  console.groupCollapsed(`[BITS reports] ${method} ${url} failed — ${status} ${statusText || ''}`.trim());
  write('Message   :', errMsg(error) || '(none)');
  if (requestId) console.log('Request id:', requestId, '→ search for "req ' + requestId + '" in backend/logs/errors.log');
  console.log('Response  :', data);
  console.groupEnd();
}

api.interceptors.response.use(
  r => r,
  error => {
    logApiFailure(error);
    // An expired or revoked token used to leave the app "logged in" with every
    // request failing. Clear the session and return to the sign-in page instead.
    const url = error.config?.url || '';
    const isSignInCall = /^\/auth\/(login|register|google|password-reset)/.test(url);
    if (error.response?.status === 401 && !isSignInCall && localStorage.getItem('itsm_token')) {
      localStorage.removeItem('itsm_token');
      localStorage.removeItem('itsm_user');
      window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

// FastAPI returns `detail` as a string for business errors but as a list of
// objects for validation errors (422). Rendering that list in a toast crashes
// React, so always turn it into readable text.
export function errMsg(error) {
  if (error?.request && !error.response) {
    return `Cannot reach the BITS reports server (${API}). Check that the backend is running and try again.`;
  }
  const detail = error?.response?.data?.detail;
  if (!detail) return '';
  if (typeof detail === 'string') {
    const rid = error.response.data.request_id;
    // Server errors get a reference code users can pass on; it is already in the text for 500s.
    return error.response.status >= 500 && rid && !detail.includes(rid) ? `${detail} (ref: ${rid})` : detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map(d => {
        const field = Array.isArray(d.loc) ? d.loc.filter(x => x !== 'body').join('.') : '';
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .filter(Boolean)
      .join('; ');
  }
  return String(detail);
}

export default api;
