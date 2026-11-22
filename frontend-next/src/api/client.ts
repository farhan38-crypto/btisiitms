// HTTP client for the FastAPI backend.
//
// Every route lives under /api. In development Vite proxies /api to the backend
// (vite.config.ts); VITE_BACKEND_URL points somewhere else when needed.
// Auth: the access token from /auth/login is sent as "Authorization: Bearer …".
// Errors: the backend always answers { detail, error?, request_id?, ...extra };
// FastAPI validation errors put a list of { loc, msg } in detail.

export const API_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '') + '/api'
export const TOKEN_KEY = 'itsm_token'

export const tokens = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } },
}

export interface FieldProblem { field: string; message: string }

export class ApiError extends Error {
  status: number
  /** Exception class name from the backend, e.g. DuplicateIncidentError, OutOfScopeError */
  code?: string
  requestId?: string
  /** Extra JSON fields the backend sent with the error (e.g. scope for OutOfScopeError) */
  extra: Record<string, unknown>
  /** Per-field problems from a 422 validation error */
  fields: FieldProblem[]
  constructor(status: number, message: string, body: Record<string, unknown> = {}, fields: FieldProblem[] = []) {
    super(message)
    this.status = status
    this.code = typeof body.error === 'string' ? body.error : undefined
    this.requestId = typeof body.request_id === 'string' ? body.request_id : undefined
    const { detail: _d, error: _e, request_id: _r, ...rest } = body
    this.extra = rest
    this.fields = fields
  }
  get isNetwork() { return this.status === 0 }
}

const FIELD_NAMES: Record<string, string> = {
  title: 'Title', description: 'Description', password: 'Password', new_password: 'New password', email: 'Email',
  code: 'Code', name: 'Name', phone: 'Phone', room_number: 'Room', resolution_summary: 'Resolution summary',
}

function readError(status: number, body: Record<string, unknown> | null): ApiError {
  const b = body || {}
  const detail = b.detail
  if (Array.isArray(detail)) {
    const fields = detail.map((d: { loc?: unknown[]; msg?: string }) => {
      const loc = (d.loc || []).filter(x => x !== 'body').map(String)
      const key = loc[loc.length - 1] || 'request'
      return { field: key, message: (d.msg || 'Invalid value').replace(/^Value error, /, '') }
    })
    const msg = fields.map(f => `${FIELD_NAMES[f.field] || f.field}: ${f.message}`).join(' · ')
    return new ApiError(status, msg || 'Some fields are not valid', b, fields)
  }
  const text = typeof detail === 'string' ? detail
    : status === 0 ? 'Cannot reach the server. Check your connection and that the backend is running.'
    : status >= 500 ? 'The server had a problem. Try again in a moment.'
    : `Request failed (${status})`
  return new ApiError(status, text, b)
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export interface RequestOptions { method?: Method; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal; raw?: boolean }

export function buildQuery(query?: Record<string, unknown>) {
  if (!query) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = tokens.get()
  const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET')
  let res: Response
  try {
    res = await fetch(API_BASE + path + buildQuery(opts.query), {
      method,
      signal: opts.signal,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw readError(0, null)
  }
  if (opts.raw && res.ok) return res as unknown as T
  const text = res.status === 204 ? '' : await res.text()
  let data: unknown = null
  if (text) { try { data = JSON.parse(text) } catch { data = { detail: text.slice(0, 300) } } }
  if (!res.ok) {
    const err = readError(res.status, data as Record<string, unknown>)
    // A rejected token means this browser is signed out (expired, or "sign out everywhere").
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      tokens.clear()
      window.dispatchEvent(new CustomEvent('bits:signed-out', { detail: err.message }))
    }
    throw err
  }
  return data as T
}

/** Binary endpoints (attachment content, QR codes) need the token too, so fetch them as blobs. */
export async function fetchBlobUrl(path: string, query?: Record<string, unknown>): Promise<string> {
  const res = await request<Response>(path, { query, raw: true })
  return URL.createObjectURL(await res.blob())
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong'
