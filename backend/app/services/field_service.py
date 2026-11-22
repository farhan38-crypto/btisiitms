"""Field visits and evidence: everything that happens after an on-site job is assigned.

FieldVisitService  — "I'm on my way", "I've arrived" (GPS-verified), navigation links,
                     the reporter's handover code.
AttachmentService  — photos (before / after / evidence) and voice notes.

Both reuse IncidentService for access checks and publish events on the same
EventBus, so audit, notifications and live updates need no extra code.
"""
from app.domain.attachments import AttachmentFactory, public_attachment
from app.domain.enums import Role, IncidentStatus as S
from app.domain.events import EventType as E
from app.domain.exceptions import InvalidInputError, UnauthorizedOperationError, InvalidStateTransitionError
from app.domain.geo import GeoPoint, ArrivalPolicy, NavigationLinks
from app.domain.handover import HandoverCode
from app.domain.models import Incident
from app.domain.sla import utcnow


class FieldVisitService:
    def __init__(self, incident_service, handovers, settings):
        self.incidents = incident_service
        self.handovers = handovers
        self.settings = settings

    async def _load(self, iid, user) -> tuple:
        inc = await self.incidents.get(iid)
        self.incidents.assert_access(inc, user)
        return Incident(inc), self.incidents.actor(user)

    async def info(self, iid, user) -> dict:
        """Where to go and how: pin, navigation links, visit progress, and (for the reporter) the code."""
        incident, actor = await self._load(iid, user)
        geo = incident.geo
        out = {
            'on_site': incident.is_on_site,
            'geo': geo.to_doc() if geo else None,
            'precise': bool(geo and geo.is_precise),
            'building': incident.building,
            'navigation': NavigationLinks.for_point(geo, incident.location.formatted) if geo else None,
            'visit': incident.field_visit or None,
            'handover': None,
        }
        doc = await self.handovers.for_incident(incident.id) if incident.location.type == 'hostel' else None
        if doc:
            code = HandoverCode.from_doc(doc)
            settings = await self.settings.get_settings()
            out['handover'] = {
                'required': bool(settings.get('require_handover_code', True)),
                'verified_at': code.verified_at, 'locked': code.locked, 'attempts_left': code.attempts_left,
                # Only the person who reported it ever sees the code itself.
                'code': code.code if actor.id == incident.reporter_id else None,
            }
        return out

    async def start_trip(self, iid, user) -> dict:
        incident, actor = await self._load(iid, user)
        now = utcnow()
        incident.start_trip(actor, now)
        if incident.status == S.ASSIGNED:          # setting off means the job has been seen
            incident.transition_to(S.ACKNOWLEDGED, actor.role, now)
            incident.acknowledge(now)
        await self.incidents.incidents.save_changes(incident)
        await self.incidents._publish(E.TECHNICIAN_EN_ROUTE, incident, actor,
                                      f'{actor.name} is on the way to {incident.location.formatted}')
        return await self.incidents.get(incident.id)

    async def arrive(self, iid, data, user) -> dict:
        incident, actor = await self._load(iid, user)
        now = utcnow()
        point = None
        if data.latitude is not None and data.longitude is not None:
            point = GeoPoint(data.latitude, data.longitude, data.accuracy_m, 'gps')
        target = incident.geo
        check = None
        if point and target:
            settings = await self.settings.get_settings()
            check = ArrivalPolicy(settings.get('arrival_radius_m', 150)).check(target, point)
            if not check.verified:
                raise InvalidInputError(
                    f'You seem to be {check.distance_m:.0f} m away from the reported location (allowed: '
                    f'{check.allowed_m:.0f} m). Walk closer and try again, or check in without location.')
        incident.arrive(actor, point, check, now)
        if incident.status in (S.ASSIGNED, S.ACKNOWLEDGED):
            if incident.status == S.ASSIGNED:
                incident.transition_to(S.ACKNOWLEDGED, actor.role, now)
                incident.acknowledge(now)
            incident.transition_to(S.IN_PROGRESS, actor.role, now)
        await self.incidents.incidents.save_changes(incident)
        how = (f'GPS-verified, {check.distance_m:.0f} m from the reported spot' if check
               else 'checked in without a location fix')
        await self.incidents._publish(E.TECHNICIAN_ARRIVED, incident, actor, f'{actor.name} arrived on site ({how})',
                                      verified=bool(check), distance_m=check.distance_m if check else None)
        return await self.incidents.get(incident.id)


class AttachmentService:
    MAX_PER_INCIDENT = 30

    def __init__(self, incident_service, attachments):
        self.incidents = incident_service
        self.attachments = attachments

    async def list(self, iid, user) -> list:
        inc = await self.incidents.get(iid)
        self.incidents.assert_access(inc, user)
        return [public_attachment(d) for d in await self.attachments.for_incident(inc['_id'])]

    async def add(self, iid, data, user) -> dict:
        inc = await self.incidents.get(iid)
        self.incidents.assert_access(inc, user)
        incident, actor = Incident(inc), self.incidents.actor(user)
        if incident.status == S.CLOSED:
            raise InvalidStateTransitionError('Closed incidents cannot receive new files')
        if data.stage == 'after' and actor.role == Role.CUSTOMER:
            raise UnauthorizedOperationError('Only the technician adds the "after" photo')
        if await self.attachments.count_for(incident.id) >= self.MAX_PER_INCIDENT:
            raise InvalidInputError(f'An incident can have at most {self.MAX_PER_INCIDENT} files')
        attachment = AttachmentFactory.create(
            data.kind, incident_id=incident.id, content_type=data.content_type, data_base64=data.data_base64,
            uploaded_by=actor.to_actor(), now=utcnow(), stage=data.stage, caption=data.caption,
            duration_s=data.duration_s, transcript=data.transcript)
        doc = await self.attachments.add(attachment.to_doc())
        what = {'voice': 'voice note', 'photo': f'{attachment.extra.get("stage") or "evidence"} photo'}[attachment.kind]
        await self.incidents._publish(E.ATTACHMENT_ADDED, incident, actor, f'{actor.name} added a {what}',
                                      attachment_id=str(doc['_id']), kind=attachment.kind)
        return public_attachment(doc)

    async def content(self, attachment_id, user) -> dict:
        doc = await self.attachments.get(attachment_id)
        inc = await self.incidents.get(doc['incident_id'])
        self.incidents.assert_access(inc, user)
        return doc
