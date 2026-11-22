"""Observers that react to incident events (Observer pattern)."""
from app.domain.events import EventObserver, IncidentEvent, EventType as E
from app.domain.sla import utcnow
from app.services.notifications import Notification, NotificationDispatcher


class AuditObserver(EventObserver):
    """Writes every event to the audit trail (complete incident history)."""

    def __init__(self, audit_repo):
        self.audit = audit_repo

    async def on_event(self, e: IncidentEvent):
        await self.audit.add({
            'incident_id': e.incident.get('id'), 'incident_number': e.incident.get('number'),
            'actor_id': e.actor.get('id'), 'actor_name': e.actor.get('name'), 'actor_role': e.actor.get('role'),
            'action': e.type.value, 'description': e.description, 'previous_state': e.previous_state,
            'new_state': e.new_state, 'data': e.data or None, 'timestamp': e.timestamp,
        })


class SlaViolationObserver(EventObserver):
    """Records each SLA breach as its own document (SLA violation register)."""

    def __init__(self, violation_repo):
        self.violations = violation_repo

    async def on_event(self, e: IncidentEvent):
        inc = e.incident
        await self.violations.add({
            'incident_id': inc.get('id'), 'incident_number': inc.get('number'), 'title': inc.get('title'),
            'priority': inc.get('priority'), 'service_name': inc.get('service_name'),
            'assigned_to': inc.get('assigned_to'), 'assigned_name': inc.get('assigned_name'),
            'kind': e.data.get('kind'), 'due_at': e.data.get('due_at'), 'detected_at': utcnow().isoformat(),
        })


class NotificationObserver(EventObserver):
    """Decides who should hear about an event, and what they are told."""

    def __init__(self, user_repo, dispatcher: NotificationDispatcher):
        self.users = user_repo
        self.dispatcher = dispatcher

    async def _user(self, user_id):
        if not user_id or user_id == 'system':
            return None
        try:
            d = await self.users.get(user_id)
        except Exception:
            return None
        return ({'id': str(d['_id']), 'email': d.get('email'), 'name': d.get('name'),
                 'email_notifications': d.get('email_notifications', True)} if d.get('is_active', True) else None)

    async def _admins(self):
        return [{'id': str(d['_id']), 'email': d.get('email'), 'name': d.get('name'),
                 'email_notifications': d.get('email_notifications', True)}
                for d in await self.users.active_admins()]

    async def on_event(self, e: IncidentEvent):
        inc, actor_id = e.incident, e.actor.get('id')
        num, title = inc.get('number'), inc.get('title')
        reporter = await self._user(inc.get('reporter_id'))
        tech = await self._user(inc.get('assigned_to'))
        not_actor = lambda u: u and u['id'] != actor_id
        msg = lambda t, m, kind, **kw: Notification(t, m, kind, inc.get('id'), num, **kw)
        send = self.dispatcher.notify

        if e.type == E.INCIDENT_CREATED:
            await send([reporter], msg('Incident created', f'{num}: {title} — we have received your report.', 'incident_created'))
        elif e.type == E.PRIORITY_CALCULATED and inc.get('priority') == 'P1':
            await send(await self._admins(), msg('New critical (P1) incident', f'{num}: {title} ({inc.get("service_name")})', 'critical'))
        elif e.type == E.ASSIGNED:
            await send([tech] if not_actor(tech) else [], msg('Incident assigned to you', f'{num}: {title} [{inc.get("priority")}]', 'assignment'))
            await send([reporter], msg('Technician assigned', f'{inc.get("assigned_name")} is now handling {num}.', 'technician_assigned'))
        elif e.type == E.PRIORITY_CHANGED:
            await send([u for u in (reporter, tech) if not_actor(u)],
                       msg('Priority changed', f'{num} priority changed from {e.previous_state} to {e.new_state}.', 'priority_changed'))
        elif e.type == E.INFO_REQUESTED:
            await send([reporter], msg('More information needed', f'The technician needs more details on {num}. Add a note and click "Provide info".', 'info_requested'))
        elif e.type == E.RESOLVED:
            summary = e.data.get('summary', '')
            await send([reporter], msg(
                'Incident resolved', f'{num} has been resolved: {summary}', 'resolved',
                email_subject=f'Your BITS reports incident {num} has been resolved',
                email_body=(f'Hello {inc.get("reporter_name") or "Student"},\n\nYour reported issue, "{title}", has been '
                            f'marked as resolved.\n\nResolution summary: {summary}\n\nYou can sign in to BITS reports to '
                            'confirm the fix, or reopen the incident if the issue persists.\n\nBITS reports IT Support')))
        elif e.type == E.CLOSED:
            await send([u for u in (tech,) if not_actor(u)], msg('Incident closed', f'{num} was closed (rating {e.data.get("rating")}/5).', 'closed'))
        elif e.type == E.REOPENED:
            await send([u for u in (tech, reporter) if not_actor(u)], msg('Incident reopened', f'{num} was reopened: the fix did not work.', 'reopened'))
        elif e.type == E.STATUS_CHANGED:
            await send([u for u in (reporter, tech) if not_actor(u)],
                       msg('Incident status changed', f'{num} is now {e.new_state.replace("_", " ").title()}.', 'status_change'))
        elif e.type == E.NOTE_ADDED:
            await send([u for u in (reporter, tech) if not_actor(u)], msg('New note', f'New note on {num}: {e.data.get("text", "")[:120]}', 'note'))
        elif e.type == E.SLA_AT_RISK:
            await send([tech] if tech else await self._admins(),
                       msg('SLA deadline approaching', f'{num} is at risk of missing its {e.data.get("kind", "resolution")} deadline. Open the incident to see the time left.', 'sla_at_risk'))
        elif e.type == E.SLA_BREACHED:
            await send([tech, reporter] + await self._admins(),
                       msg('SLA violated', f'{num} missed its {e.data.get("kind")} deadline.', 'sla_breached'))
        elif e.type == E.ESCALATED:
            recipients = [await self._user(uid) for uid in e.data.get('notify_user_ids', [])]
            await send(recipients, msg(f'Escalated to {e.data.get("label")}', f'{num} [{inc.get("priority")}] has not been acknowledged in time. {e.description}', 'escalation'))
        elif e.type == E.TECHNICIAN_EN_ROUTE:
            await send([reporter] if not_actor(reporter) else [],
                       msg('Technician on the way', f'{e.actor.get("name")} is heading to you for {num}.', 'en_route'))
        elif e.type == E.TECHNICIAN_ARRIVED:
            await send([reporter] if not_actor(reporter) else [],
                       msg('Technician has arrived', f'{e.actor.get("name")} has arrived for {num}. When the job is done, '
                                                     'share the handover code shown on your report.', 'arrived'))
        elif e.type == E.ATTACHMENT_ADDED:
            await send([u for u in (reporter, tech) if not_actor(u)], msg('New attachment', f'{e.description} on {num}.', 'attachment'))
        elif e.type == E.CORRELATION_DETECTED:
            await send(await self._admins(), msg('Possible major incident', e.description, 'correlation'))
