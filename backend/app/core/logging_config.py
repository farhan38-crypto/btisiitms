"""Human-readable logging for BITS reports.

Every log entry starts with one summary line:

    2026-11-01 16:20:03 +0530 | ERROR   | errors         | req 7f3a2c1d | 500 Server error — The database (MongoDB) could not be reached.

and errors add an indented block underneath that says what happened, who
triggered it, where in the code it broke and how to fix it, followed by the
traceback when there is one.

Output goes to the console and to two rotating files:
    backend/logs/app.log     everything at LOG_LEVEL and above (default INFO)
    backend/logs/errors.log  warnings and errors only
"""
import contextvars
import logging
import os
import re
import sys
import time
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# Per-request context (request id, method, path, user), set by the request
# middleware so every log line written while handling a request is tagged.
request_ctx: contextvars.ContextVar = contextvars.ContextVar('request_ctx', default=None)

_SENSITIVE_WORDS = ('password', 'secret', 'token', 'api_key', 'apikey', 'credential', 'authorization', 'cookie',
                    'otpauth', 'backup_code', 'qr_svg')
_SENSITIVE_EXACT = {'code', 'code_hash', 'pwd', 'key'}


def is_sensitive(name) -> bool:
    n = str(name).lower()
    return n in _SENSITIVE_EXACT or any(w in n for w in _SENSITIVE_WORDS)


def redact(value, _depth=0):
    """Return a copy that is safe to log: secrets hidden, long text shortened."""
    if _depth > 6:
        return '…'
    if isinstance(value, dict):
        return {k: ('[hidden]' if is_sensitive(k) else redact(v, _depth + 1)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        items = [redact(v, _depth + 1) for v in list(value)[:20]]
        return items + ([f'… (+{len(value) - 20} more)'] if len(value) > 20 else [])
    if isinstance(value, str) and len(value) > 300:
        return value[:300] + f'… (+{len(value) - 300} chars)'
    return value


def redact_url(url: str) -> str:
    """Hide the user:password part of connection strings such as MONGO_URL."""
    return re.sub(r'//[^@/]+@', '//***:***@', url or '')


def short(value, limit=120) -> str:
    text = repr(value)
    return text if len(text) <= limit else text[:limit] + f'… ({len(text)} chars)'


class _ContextFilter(logging.Filter):
    def filter(self, record):
        ctx = request_ctx.get()
        record.request_id = ctx.get('id', '-') if ctx else '-'
        return True


# Frames from these files are plumbing, not where bugs live.
_PLUMBING = ('app/core/error_handling.py',)


def _project_path(filename):
    """Path relative to backend/ for project files, else None (libraries)."""
    try:
        rel = Path(filename).resolve().relative_to(BACKEND_ROOT)
    except (ValueError, OSError):
        return None
    if rel.parts and rel.parts[0] in ('.venv', 'venv') or 'site-packages' in rel.parts:
        return None
    return rel.as_posix()


def format_traceback(exc_type, exc, tb):
    """Traceback focused on this project's code. Library frames are collapsed
    into one line; set LOG_FULL_TRACEBACKS=true to see everything."""
    if os.getenv('LOG_FULL_TRACEBACKS', '').lower() == 'true':
        return ''.join(traceback.format_exception(exc_type, exc, tb)).rstrip().splitlines()
    te = traceback.TracebackException(exc_type, exc, tb)
    chain, cur = [], te
    while cur is not None and len(chain) < 5:
        chain.append(cur)
        cur = cur.__cause__ or (None if cur.__suppress_context__ else cur.__context__)
    chain.reverse()  # oldest first, the error that reached us last
    useful = lambda c: any(_project_path(f.filename) not in (None,) + _PLUMBING for f in c.stack)
    keep = [c for c in chain[:-1] if useful(c)] + [chain[-1]]
    out = []
    for i, c in enumerate(keep):
        if i:
            out += ['', 'The error above led to this error:']
        out.append('Traceback (most recent call last):')
        hidden = 0
        frames = list(c.stack)
        for n, f in enumerate(frames):
            rel = _project_path(f.filename)
            show = (rel is not None and rel not in _PLUMBING) or n == len(frames) - 1
            if not show:
                hidden += 1
                continue
            if hidden:
                out.append(f'  … {hidden} framework/library frame(s) hidden …')
                hidden = 0
            out.append(f'  File "{rel or f.filename}", line {f.lineno}, in {f.name}')
            if f.line:
                out.append(f'    {f.line.strip()}')
        out += [line.rstrip() for line in ''.join(c.format_exception_only()).splitlines()]
    return out


class HumanFormatter(logging.Formatter):
    COLORS = {'DEBUG': '\033[90m', 'INFO': '\033[36m', 'WARNING': '\033[33m', 'ERROR': '\033[31m', 'CRITICAL': '\033[1;41m'}
    RESET = '\033[0m'

    def __init__(self, color=False):
        super().__init__()
        self.color = color

    def format(self, record):
        t = time.localtime(record.created)
        stamp = time.strftime('%Y-%m-%d %H:%M:%S %z', t)
        level = f'{record.levelname:<7}'
        if self.color:
            level = f'{self.COLORS.get(record.levelname, "")}{level}{self.RESET}'
        rid = getattr(record, 'request_id', '-')
        name = 'uvicorn' if record.name == 'uvicorn.error' else record.name
        lines = [f'{stamp} | {level} | {name[:14]:<14} | req {rid:<8} | {record.getMessage()}']

        details = {k: v for k, v in (getattr(record, 'details', None) or {}).items() if v not in (None, '', [], {})}
        if details:
            width = max(len(k) for k in details)
            for key, val in details.items():
                parts = str(val).splitlines() or ['']
                lines.append(f'    {key:<{width}} : {parts[0]}')
                lines.extend(f'    {"":<{width}}   {p}' for p in parts[1:])

        if record.exc_info and record.exc_info[0] is not None:
            lines.append('    Traceback (the line that failed is at the bottom):')
            lines.extend('      ' + line for line in format_traceback(*record.exc_info))

        if details or record.exc_info:
            lines.append('    ' + '─' * 72)
        return '\n'.join(lines)


_log_dir = None


def setup_logging():
    """Configure console + file logging once. Safe to call repeatedly."""
    global _log_dir
    if _log_dir is not None:
        return _log_dir
    level = getattr(logging, os.getenv('LOG_LEVEL', 'INFO').upper(), logging.INFO)
    log_dir = Path(os.getenv('LOG_DIR') or BACKEND_ROOT / 'logs')

    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)
    ctx_filter = _ContextFilter()

    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(HumanFormatter(color=sys.stderr.isatty() and not os.getenv('NO_COLOR')))
    console.addFilter(ctx_filter)
    root.addHandler(console)

    file_problem = None
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        for name, min_level in (('app.log', logging.NOTSET), ('errors.log', logging.WARNING)):
            fh = RotatingFileHandler(log_dir / name, maxBytes=5_000_000, backupCount=5, encoding='utf-8')
            fh.setLevel(min_level)
            fh.setFormatter(HumanFormatter())
            fh.addFilter(ctx_filter)
            root.addHandler(fh)
    except OSError as exc:
        file_problem = exc

    # Route uvicorn's messages through our format; our middleware writes the access log.
    for name in ('uvicorn', 'uvicorn.error'):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True
    access = logging.getLogger('uvicorn.access')
    access.handlers = []
    access.propagate = False
    access.disabled = True
    for noisy in ('pymongo', 'httpx', 'httpcore', 'urllib3', 'google', 'watchfiles', 'asyncio'):
        logging.getLogger(noisy).setLevel(max(level, logging.WARNING))

    _log_dir = log_dir
    if file_problem:
        logging.getLogger('logging').warning(
            'Could not write log files; logging to the console only',
            extra={'details': {'Folder': str(log_dir), 'Reason': str(file_problem),
                               'How to fix': 'Set LOG_DIR in backend/.env to a writable folder.'}})
    return log_dir


def where_in_code(exc) -> str:
    """The deepest frame inside this project (not a library), e.g.
    'app/services/incident_service.py:212 in transition()  →  current=S(inc["status"])'."""
    tb = getattr(exc, '__traceback__', None)
    if tb is None:
        return ''
    best = None
    for frame in traceback.extract_tb(tb):
        path = Path(frame.filename)
        rel = _project_path(path)
        if rel is None or rel in _PLUMBING:
            continue
        best = (rel, frame)
    if not best:
        return ''
    rel, frame = best
    code = f'  →  {frame.line.strip()}' if frame.line else ''
    return f'{rel}:{frame.lineno} in {frame.name}(){code}'


def explain_exception(exc):
    """Translate an exception into (what happened, how to fix it) in plain English."""
    msg = str(exc) or type(exc).__name__

    try:
        import pymongo.errors as pe
        if isinstance(exc, (pe.ServerSelectionTimeoutError, pe.AutoReconnect, pe.ConnectionFailure, pe.NetworkTimeout)):
            return ('The database (MongoDB) could not be reached.',
                    f'Make sure MongoDB is running and MONGO_URL is correct (currently '
                    f'{redact_url(os.getenv("MONGO_URL", "mongodb://localhost:27017"))}). '
                    'With Docker: `docker compose up mongo`. On macOS with Homebrew: '
                    '`brew services start mongodb-community`.')
        if isinstance(exc, pe.DuplicateKeyError):
            key = (getattr(exc, 'details', None) or {}).get('keyValue')
            return ('Tried to save a record that already exists (a unique field clashed).',
                    f'Duplicate value: {redact(key)}. Check for an existing record before inserting, '
                    'or pick a different value.')
        if isinstance(exc, pe.OperationFailure):
            return ('MongoDB rejected a database operation.',
                    f'MongoDB said: {msg[:300]}. Check the query/update syntax and the database user\'s permissions.')
    except ImportError:
        pass

    try:
        from bson.errors import InvalidId
        if isinstance(exc, InvalidId):
            return ('An ID in the request is not a valid MongoDB ID.',
                    'IDs are 24 hexadecimal characters (e.g. 6ae7184ea8b47ccdd1adc379). '
                    'Check the URL or the value the frontend sent.')
    except ImportError:
        pass

    import smtplib
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return ('The email server rejected the SMTP username/password.',
                'For Gmail, SMTP_PASSWORD must be a 16-character App Password '
                '(Google Account → Security → 2-Step Verification → App passwords), not your normal password.')
    if isinstance(exc, smtplib.SMTPException) or (isinstance(exc, RuntimeError) and 'SMTP' in msg):
        return ('An email could not be sent.',
                'Check SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM_EMAIL in backend/.env, '
                f'then restart the server. Mail server said: {msg[:200]}')

    try:
        import httpx
        if isinstance(exc, httpx.TimeoutException):
            return ('An external service (e.g. Google Gemini) took too long to answer.',
                    'Usually temporary — retry. If it keeps happening, check the internet connection.')
        if isinstance(exc, httpx.HTTPError):
            return ('A request to an external service failed.',
                    'Check the internet connection and LLM_API_KEY / LLM_MODEL in backend/.env.')
    except ImportError:
        pass

    try:
        import jwt
        if isinstance(exc, jwt.PyJWTError):
            return ('A sign-in token could not be read.',
                    'The token is expired, damaged, or was signed with a different JWT_SECRET. '
                    'Users simply need to sign in again (this happens to everyone after JWT_SECRET changes).')
    except ImportError:
        pass

    try:
        from pydantic import ValidationError
        if isinstance(exc, ValidationError):
            return ('The server built data that failed its own validation rules.',
                    'This is a backend bug: a value did not match its Pydantic model. '
                    f'Details: {msg[:400]}')
    except ImportError:
        pass

    if isinstance(exc, KeyError):
        key = exc.args[0] if exc.args else '?'
        if isinstance(key, str) and key.isupper():
            return (f'The required setting {key} is missing.',
                    f'Add {key}=... to backend/.env (see backend/.env.example) and restart the server.')
        return (f'Expected the field {key!r}, but it was missing.',
                'A stored record or request lacks this field. Records created before a code change '
                'are a common cause — read it with .get() or migrate old records.')
    if isinstance(exc, (ConnectionRefusedError, TimeoutError)) or type(exc).__name__ == 'gaierror':
        return ('A network connection failed (refused, timed out, or host name not found).',
                'Check the host/port of the service being contacted and that it is running.')
    if isinstance(exc, (TypeError, AttributeError, ValueError, IndexError, ZeroDivisionError, NameError)):
        return ('A programming error happened in the backend.',
                'This is a code bug, not a user mistake. Start at "Where" and read the traceback bottom-up.')
    return ('An unexpected error happened.', 'Read the traceback below, starting from the bottom.')


def log_exception(logger, message, exc, level=logging.ERROR, with_traceback=True, **details):
    """Log an exception with its plain-English explanation attached."""
    summary, hint = explain_exception(exc)
    info = {'What happened': summary, 'Error message': f'{type(exc).__name__}: {str(exc)[:1000]}'}
    info.update(details)
    info['Where'] = where_in_code(exc)
    info['How to fix'] = hint
    logger.log(level, message, exc_info=(type(exc), exc, exc.__traceback__) if with_traceback else None,
               extra={'details': info})
