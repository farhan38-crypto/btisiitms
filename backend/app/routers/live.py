"""GET /api/live/stream — Server-Sent Events. Browsers' EventSource cannot send an
Authorization header, so the access token comes as ?token=... instead."""
import asyncio

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.core.container import container
from app.core.security import load_user_from_token, public_user

router = APIRouter(prefix='/live', tags=['live updates'])
HEARTBEAT_SECONDS = 20


@router.get('/stream')
async def stream(request: Request, token: str = Query(..., min_length=10, max_length=4000)):
    user = public_user(await load_user_from_token(token, 'access'))
    hub = container.live
    sub = hub.subscribe(user)

    async def events():
        try:
            yield 'retry: 5000\nevent: ready\ndata: {}\n\n'
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(sub.queue.get(), timeout=HEARTBEAT_SECONDS)
                    yield f'event: incident\ndata: {data}\n\n'
                except asyncio.TimeoutError:
                    yield ': keep-alive\n\n'          # comment line keeps proxies (ngrok) from closing it
        finally:
            hub.unsubscribe(sub)

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        # no-transform stops the dev server's gzip from buffering the stream
        'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive'})
