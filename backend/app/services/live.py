"""Live updates over Server-Sent Events (SSE).

LiveHub keeps one queue per open browser tab. LiveEventObserver is just another
Observer on the EventBus: every incident event is pushed to the tabs whose user
is allowed to see that incident, so pages update without refreshing.
"""
import asyncio
import json
import logging
from dataclasses import dataclass, field

from app.domain.events import EventObserver, IncidentEvent, EventType as E

log = logging.getLogger('live')

# Events not worth a live push (internal bookkeeping right after creation).
QUIET = {E.INCIDENT_CLASSIFIED, E.PRIORITY_CALCULATED, E.SLA_APPLIED}


@dataclass(eq=False)
class Subscriber:
    user: dict
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=100))

    def can_see(self, incident: dict) -> bool:
        role, uid = self.user.get('role'), self.user.get('id')
        if role == 'admin':
            return True
        if role == 'technician':
            return incident.get('assigned_to') in (uid, None)
        return incident.get('reporter_id') == uid


class LiveHub:
    def __init__(self):
        self._subscribers: set = set()

    def subscribe(self, user: dict) -> Subscriber:
        sub = Subscriber(user)
        self._subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber):
        self._subscribers.discard(sub)

    @property
    def connections(self) -> int:
        return len(self._subscribers)

    def broadcast(self, message: dict, incident: dict):
        data = json.dumps(message, default=str)
        for sub in list(self._subscribers):
            if not sub.can_see(incident):
                continue
            try:
                sub.queue.put_nowait(data)
            except asyncio.QueueFull:          # a stalled tab must never slow everyone else down
                log.warning('Dropping live update for a slow client')


class LiveEventObserver(EventObserver):
    def __init__(self, hub: LiveHub):
        self.hub = hub

    async def on_event(self, e: IncidentEvent):
        if e.type in QUIET:
            return
        inc = e.incident
        self.hub.broadcast({
            'type': e.type.value, 'incident_id': inc.get('id'), 'number': inc.get('number'),
            'title': inc.get('title'), 'status': inc.get('status'), 'priority': inc.get('priority'),
            'description': e.description, 'actor_id': e.actor.get('id'), 'actor_name': e.actor.get('name'),
            'new_state': e.new_state, 'timestamp': e.timestamp,
        }, inc)
