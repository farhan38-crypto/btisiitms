"""Receives crash reports from the React app and writes them to errors.log,
so frontend and backend problems can be read in one place."""
import logging
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.core.error_handling import identify_user

router = APIRouter(prefix='/client-errors', tags=['logging'])
log = logging.getLogger('browser')

_MAX_PER_MINUTE = 20
_recent: dict = defaultdict(deque)

KIND_TEXT = {
    'render': 'A page crashed while rendering (caught by the error screen)',
    'uncaught': 'Uncaught JavaScript error',
    'unhandled-rejection': 'A promise failed and nothing handled it',
}


class ClientErrorReport(BaseModel):
    kind: str = Field(default='uncaught', max_length=40)
    message: str = Field(max_length=2000)
    stack: Optional[str] = Field(default=None, max_length=8000)
    component_stack: Optional[str] = Field(default=None, max_length=8000)
    url: Optional[str] = Field(default=None, max_length=500)
    reference: Optional[str] = Field(default=None, max_length=40)
    request_id: Optional[str] = Field(default=None, max_length=40)


def _first_lines(text, n):
    lines = [l.strip() for l in (text or '').strip().splitlines() if l.strip()]
    if not lines:
        return None
    extra = f'\n… {len(lines) - n} more line(s)' if len(lines) > n else ''
    return '\n'.join(lines[:n]) + extra


def _allowed(ip: str) -> bool:
    now = time.monotonic()
    q = _recent[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= _MAX_PER_MINUTE:
        return False
    q.append(now)
    return True


@router.post('', status_code=204)
async def report_client_error(data: ClientErrorReport, request: Request):
    ip = request.client.host if request.client else '-'
    if not _allowed(ip):
        return Response(status_code=204)
    stack = (data.stack or '').strip()
    minified = '/static/js/' in stack
    log.error(f'Browser error — {data.message[:160]}', extra={'details': {
        'What happened': KIND_TEXT.get(data.kind, data.kind),
        'Error message': data.message,
        'Page': data.url,
        'User': identify_user(request),
        'Browser': request.headers.get('user-agent', '')[:160],
        'Error screen ref': data.reference,
        'Related API request': data.request_id,
        'JS stack': _first_lines(stack, 15),
        'React components': _first_lines(data.component_stack, 12),
        'Note': 'Stack is minified (production build). Reproduce with `npm start` for readable file names.'
                if minified else None,
    }})
    return Response(status_code=204)
