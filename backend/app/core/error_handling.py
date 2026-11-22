"""Request logging + error handlers.

* Every request gets a short request id (returned as the X-Request-ID header
  and as `request_id` in error responses) so a user's error toast can be
  matched to the exact entry in backend/logs/errors.log.
* One access line per request: method, path, status, duration, user.
* Every error response is logged with what happened, who triggered it, where
  in the code it happened and what to do about it.
* Unhandled exceptions become a clean JSON 500 (with CORS headers, so the
  browser shows the real message instead of a vague "Network Error").
"""
import logging
import os
import re
import time
import uuid
from http import HTTPStatus

import jwt
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging_config import request_ctx, is_sensitive, short, where_in_code, log_exception
from app.domain.exceptions import ITSMError

access_log = logging.getLogger('http')
error_log = logging.getLogger('errors')

SLOW_REQUEST_MS = int(os.getenv('SLOW_REQUEST_MS', '1500'))

STATUS_HINTS = {
    400: 'The request was understood but rejected — see the message.',
    401: 'The user is not signed in, or their token expired (tokens last 12 hours) or was signed with a '
         'different JWT_SECRET. Signing in again fixes it.',
    403: "The signed-in user's role is not allowed to do this, or the account is deactivated.",
    404: 'Nothing matches this URL or ID. Check the ID in the request, or that the route exists.',
    405: 'This URL exists but not for this HTTP method (e.g. GET instead of POST).',
    409: 'The request conflicts with the current data (duplicate, wrong status or no capacity).',
    422: 'The request body or parameters failed validation — see "Problems".',
    429: 'Too many requests in a short time; the user must wait before retrying.',
    503: 'A server-side integration (SMTP email, Google sign-in or AI) is not configured or not reachable. '
         'Check backend/.env.',
}

ITSM_HINTS = {
    'InvalidStateTransitionError': 'The incident is not in a status that allows this change. '
                                   'Allowed moves are listed in app/domain/state.py.',
    'UnauthorizedOperationError': "The user's role may not do this (see require_roles(...) on the route and "
                                  'app/domain/state.py), or a technician touched another technician\'s incident.',
    'ResourceNotFoundError': 'The incident, user, service or category in the request does not exist.',
    'DuplicateIncidentError': 'A very similar open incident already exists. The user can confirm and resubmit '
                              '(acknowledge_duplicate=true).',
    'TechnicianUnavailableError': 'Every suitable technician is at their max_concurrent limit. Raise capacity in '
                                  'User & Role Admin or close open incidents.',
    'InvalidInputError': 'The data broke a business rule — see the message.',
    'MissingSlaConfigError': 'No SLA policy exists for this priority. Add one under SLA & Strategy.',
}


def _is_database_outage(exc) -> bool:
    try:
        from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
        return isinstance(exc, (ConnectionFailure, ServerSelectionTimeoutError))
    except ImportError:
        return False


def _status_text(code):
    try:
        return HTTPStatus(code).phrase
    except ValueError:
        return 'Error'


def identify_user(request: Request) -> str:
    """Who sent the request, read from the JWT without a database call."""
    header = request.headers.get('authorization', '')
    if header.lower().startswith('bearer '):
        token = header[7:].strip()
    else:
        token = header.strip() or request.cookies.get('access_token', '')
    if not token:
        return 'anonymous (not signed in)'
    try:
        payload = jwt.decode(token, os.environ.get('JWT_SECRET', ''), algorithms=['HS256'])
        return f"{payload.get('email', '?')} ({payload.get('role', '?')})"
    except jwt.ExpiredSignatureError:
        return 'anonymous (sign-in token expired)'
    except Exception:
        return 'anonymous (invalid sign-in token)'


def _request_details(request: Request) -> dict:
    ctx = request_ctx.get() or {}
    query = request.url.query
    return {
        'Request': f'{request.method} {request.url.path}' + (f'?{query}' if query else ''),
        'User': ctx.get('user') or identify_user(request),
        'Client': ctx.get('client'),
    }


def _rid() -> str:
    ctx = request_ctx.get()
    return ctx['id'] if ctx else uuid.uuid4().hex[:8]


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get('x-request-id', '')
        rid = incoming if re.fullmatch(r'[A-Za-z0-9_-]{4,32}', incoming) else uuid.uuid4().hex[:8]
        ua = request.headers.get('user-agent', '')
        ctx = {
            'id': rid,
            'user': identify_user(request),
            'client': (request.client.host if request.client else '-') + (f' · {ua[:80]}' if ua else ''),
        }
        token = request_ctx.set(ctx)
        start = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception as exc:  # anything no handler dealt with
                ms = (time.perf_counter() - start) * 1000
                log_exception(error_log, '500 Internal Server Error — unhandled exception', exc,
                                        **_request_details(request), **{'Time taken': f'{ms:.0f} ms', 'Reference': rid})
                response = JSONResponse(status_code=500, content={
                    'detail': 'Something went wrong on the server. Please try again; if it keeps happening, '
                              f'give the admin this reference: {rid}',
                    'error': 'InternalServerError',
                    'request_id': rid,
                })
                if _is_database_outage(exc):   # database failure → 503 with a clear message
                    response = JSONResponse(status_code=503, content={
                        'detail': 'The database is temporarily unavailable. Please try again in a minute '
                                  f'(reference {rid}).',
                        'error': 'DatabaseUnavailableError', 'request_id': rid})
            ms = (time.perf_counter() - start) * 1000
            response.headers['X-Request-ID'] = rid
            line = (f'{request.method} {request.url.path} → {response.status_code} {_status_text(response.status_code)} '
                    f'in {ms:.0f} ms · {ctx["user"]}')
            if request.url.path == '/api/health':
                access_log.debug(line)
            elif ms > SLOW_REQUEST_MS:
                access_log.warning('Slow request: ' + line, extra={'details': {
                    'Why this matters': f'Took longer than SLOW_REQUEST_MS ({SLOW_REQUEST_MS} ms).',
                    'How to fix': 'Common causes: a slow external API (Gemini/SMTP), MongoDB on a slow link, '
                                  'or a query without an index.'}})
            else:
                access_log.info(line)
            return response
        finally:
            request_ctx.reset(token)


async def itsm_error_handler(request: Request, exc: ITSMError):
    name = type(exc).__name__
    error_log.warning(f'{exc.status_code} {_status_text(exc.status_code)} — {exc.message}', extra={'details': {
        'What happened': exc.message,
        'Error type': f'{name} (a business rule refused the request)',
        **_request_details(request),
        'Where': where_in_code(exc),
        'Likely cause': ITSM_HINTS.get(name, STATUS_HINTS.get(exc.status_code)),
    }})
    return JSONResponse(status_code=exc.status_code,
                        content={'detail': exc.message, 'error': name, 'request_id': _rid(), **getattr(exc, 'extra', {})})


async def http_error_handler(request: Request, exc: StarletteHTTPException):
    code = exc.status_code
    detail = exc.detail
    hint = STATUS_HINTS.get(code)
    if code == 404 and detail == 'Not Found':
        hint = 'No API route matches this URL. Check the path (all routes start with /api) and the HTTP method.'
    level = logging.ERROR if code >= 500 else logging.WARNING
    title = f'{code} {_status_text(code)}' + ('' if detail == _status_text(code) else f' — {detail}')
    error_log.log(level, title, extra={'details': {
        'What happened': detail,
        **_request_details(request),
        'Where': where_in_code(exc),
        'Likely cause': hint,
    }})
    return JSONResponse(status_code=code, content={'detail': detail, 'request_id': _rid()},
                        headers=getattr(exc, 'headers', None))


async def validation_error_handler(request: Request, exc: RequestValidationError):
    problems, safe_errors = [], []
    for err in exc.errors():
        loc = [str(x) for x in err.get('loc', ()) if x != 'body']
        field = '.'.join(loc) or 'request body'
        secret = any(is_sensitive(x) for x in loc)
        if err.get('type') == 'missing':
            received = 'it was not sent'
        elif 'input' in err:
            received = f'received [hidden — sensitive field]' if secret else f'received {short(err["input"])}'
        else:
            received = ''
        problems.append(f'• {field}: {err.get("msg")}' + (f' ({received})' if received else ''))
        clean = dict(err)
        if secret and 'input' in clean:
            clean['input'] = '[hidden]'
        safe_errors.append(clean)
    error_log.warning(f'422 Invalid input — {len(problems)} problem(s) with the request data', extra={'details': {
        **_request_details(request),
        'Problems': '\n'.join(problems),
        'Likely cause': 'The frontend sent a value the API does not accept (wrong type, too short/long, '
                        'or a required field missing). Field rules live in app/models/schemas.py.',
    }})
    return JSONResponse(status_code=422, content={'detail': jsonable_encoder(safe_errors), 'request_id': _rid()})


def register_error_handling(app: FastAPI):
    """Call before adding CORSMiddleware so error responses still get CORS headers."""
    app.add_middleware(RequestLoggingMiddleware)
    app.add_exception_handler(ITSMError, itsm_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
