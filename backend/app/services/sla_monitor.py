"""Background SLA monitoring and automatic escalation (runs every 60 s).

For every open incident it:
  1. re-evaluates the SLA (ON_TRACK → AT_RISK → BREACHED) and warns before deadlines,
  2. records each missed deadline once in the SLA violation register,
  3. escalates critical incidents that nobody has acknowledged in time:

        Level 1  Team Lead            50% of the response window   → technicians skilled in the category
        Level 2  System Administrator 100% (response SLA missed)   → administrators (+ auto-dispatch if unassigned)
        Level 3  IT Manager           200% of the response window  → administrators, marked urgent
"""
import logging
from dataclasses import dataclass
from typing import Optional

from app.domain.enums import IncidentStatus as S, SlaStatus
from app.domain.events import IncidentEvent, EventType as E
from app.domain.exceptions import ITSMError
from app.domain.models import Incident, SYSTEM
from app.domain.sla import utcnow, parse_dt

log = logging.getLogger('sla-monitor')


@dataclass(frozen=True)
class EscalationLevel:
    level: int
    label: str
    fraction_of_response: float
    audience: str   # 'team' or 'admins'


class EscalationPolicy:
    LEVELS = (
        EscalationLevel(1, 'Team Lead', 0.5, 'team'),
        EscalationLevel(2, 'System Administrator', 1.0, 'admins'),
        EscalationLevel(3, 'IT Manager', 2.0, 'admins'),
    )

    def __init__(self, priorities=('P1', 'P2')):
        self.priorities = set(priorities)

    def due_level(self, incident: Incident, now) -> Optional[EscalationLevel]:
        """Highest level that is due and not reached yet, or None."""
        if incident.priority not in self.priorities or incident.is_acknowledged:
            return None
        if incident.status not in (S.NEW, S.CLASSIFIED, S.ASSIGNED):
            return None
        created = parse_dt(incident.created_at)
        response_minutes = incident.sla.get('response_minutes')
        if not created or not response_minutes:
            return None
        elapsed = (now - created).total_seconds() / 60
        current = int(incident.escalation.get('level') or 0)
        due = [lvl for lvl in self.LEVELS if elapsed >= lvl.fraction_of_response * response_minutes and lvl.level > current]
        return due[-1] if due else None


class SlaMonitor:
    def __init__(self, incidents, users, settings, bus, incident_service):
        self.incidents = incidents
        self.users = users
        self.settings = settings
        self.bus = bus
        self.service = incident_service

    async def _publish(self, type_, incident, description, **data):
        await self.bus.publish(IncidentEvent(type_, incident.snapshot(), SYSTEM.to_actor(), description, data=data))

    async def _recipients(self, incident: Incident, level: EscalationLevel):
        if level.audience == 'team':
            techs = await self.users.active_technicians()
            team = [t for t in techs if incident.category in (t.get('skills') or [])] or techs
            return [str(t['_id']) for t in team]
        return [str(a['_id']) for a in await self.users.active_admins()]

    async def run_once(self, now=None) -> int:
        now = now or utcnow()
        settings = await self.settings.get_settings()
        policy = EscalationPolicy(settings.get('escalation_priorities') or [])
        touched = 0
        for doc in await self.incidents.open_incidents():
            if not isinstance(doc.get('sla'), dict):
                continue
            incident = Incident(doc)
            old_status, new_status, sla = incident.refresh_sla(now)
            events = []
            if new_status == SlaStatus.AT_RISK.value and old_status != new_status:
                events.append((E.SLA_AT_RISK, 'SLA at risk: the resolution deadline is approaching',
                               {'kind': 'resolution', 'due_at': sla.get('resolution_due_at')}))

            level = policy.due_level(incident, now) if settings.get('escalation_enabled', True) else None
            recipients = []
            if level:
                incident.escalate(level.level, level.label, now)
                recipients = await self._recipients(incident, level)
                events.append((E.ESCALATED, f'Escalated to level {level.level} ({level.label}): not acknowledged '
                                            f'within {int(level.fraction_of_response * 100)}% of the response time',
                               {'level': level.level, 'label': level.label, 'notify_user_ids': recipients}))

            if incident.changes():
                await self.incidents.save_changes(incident)
                touched += 1
            for type_, text, data in events:
                await self._publish(type_, incident, text, **data)
            await self.service.record_sla_breaches(incident)

            if level and level.level >= 2 and not incident.assigned_to and incident.status == S.CLASSIFIED:
                try:
                    await self.service.auto_assign(await self.incidents.get(incident.id), SYSTEM)
                except ITSMError as exc:
                    log.warning(f'Escalation could not auto-dispatch {incident.number}: {exc.message}')
        return touched
