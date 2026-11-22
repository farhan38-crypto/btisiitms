"""Observer pattern: incident events and the event bus.

IncidentService only *publishes* what happened ("INC-00012 was assigned").
Observers decide what to do about it: write the audit trail, notify people,
record SLA violations. A new reaction (e.g. an SMS observer) is a new
observer class plus one `subscribe` call; the service does not change.
"""
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Optional

from app.domain.sla import utcnow

log = logging.getLogger('events')


class EventType(str, Enum):
    INCIDENT_CREATED = 'INCIDENT_CREATED'
    INCIDENT_CLASSIFIED = 'INCIDENT_CLASSIFIED'
    PRIORITY_CALCULATED = 'PRIORITY_CALCULATED'
    SLA_APPLIED = 'SLA_APPLIED'
    ASSIGNED = 'ASSIGNED'
    STATUS_CHANGED = 'STATUS_CHANGED'
    INFO_REQUESTED = 'INFO_REQUESTED'
    RESOLVED = 'RESOLVED'
    REOPENED = 'REOPENED'
    CLOSED = 'CLOSED'
    PRIORITY_CHANGED = 'PRIORITY_CHANGED'
    INCIDENT_UPDATED = 'INCIDENT_UPDATED'
    NOTE_ADDED = 'NOTE_ADDED'
    SLA_AT_RISK = 'SLA_AT_RISK'
    SLA_BREACHED = 'SLA_BREACHED'
    ESCALATED = 'ESCALATED'
    CORRELATION_DETECTED = 'CORRELATION_DETECTED'
    LOCATION_CAPTURED = 'LOCATION_CAPTURED'
    TECHNICIAN_EN_ROUTE = 'TECHNICIAN_EN_ROUTE'
    TECHNICIAN_ARRIVED = 'TECHNICIAN_ARRIVED'
    HANDOVER_VERIFIED = 'HANDOVER_VERIFIED'
    ATTACHMENT_ADDED = 'ATTACHMENT_ADDED'


@dataclass(frozen=True)
class IncidentEvent:
    type: EventType
    incident: dict                    # Incident.snapshot()
    actor: dict                       # User.to_actor()
    description: str
    previous_state: Optional[str] = None
    new_state: Optional[str] = None
    data: dict = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: utcnow().isoformat())


class EventObserver(ABC):
    """Interface every observer implements."""

    @abstractmethod
    async def on_event(self, event: IncidentEvent) -> None: ...


class EventBus:
    """The subject: keeps observers and forwards each published event to them."""

    def __init__(self):
        self._observers: list = []

    def subscribe(self, observer: EventObserver, types: Optional[Iterable[EventType]] = None):
        self._observers.append((observer, frozenset(types) if types else None))

    async def publish(self, event: IncidentEvent):
        for observer, types in self._observers:
            if types is not None and event.type not in types:
                continue
            try:
                await observer.on_event(event)
            except Exception as exc:
                # One failing observer (e.g. email down) must never break the request.
                from app.core.logging_config import log_exception
                log_exception(log, f'{type(observer).__name__} failed while handling {event.type.value} '
                                   f'for {event.incident.get("number")}', exc, level=logging.WARNING)
