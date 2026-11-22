"""Tests for the field-service features: GPS / building location, navigation links,
"on my way" + GPS-verified arrival, the handover code, photos & voice notes,
QR asset stickers, live updates, building outage detection and the campus map."""
import asyncio
import base64
import json
import time

import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.container import container
from app.core.db import init_db
from app.domain.attachments import AttachmentFactory
from app.domain.exceptions import InvalidInputError, TooManyAttemptsError
from app.domain.geo import GeoPoint, CampusMap, ArrivalPolicy, NavigationLinks
from app.domain.handover import HandoverCode
from app.domain.sla import utcnow

# A 1x1 PNG and a few bytes standing in for a recorded clip.
PNG = base64.b64encode(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).decode()
AUDIO = base64.b64encode(b'\x1aE\xdf\xa3' + b'\x00' * 400).decode()
KRISHNA = CampusMap.DEFAULT_PINS['Krishna Bhavan']


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    await init_db()
    yield
    await container.settings.update_settings(dict(container.settings.DEFAULTS))


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def login(ac, email, password):
    r = await ac.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"], r.json()["access_token"]


async def service_id(ac, h, name):
    return next(s["id"] for s in (await ac.get("/api/catalog/services", headers=h)).json() if s["name"] == name)


async def hostel_report(ac, h, **extra):
    ts = time.time_ns()
    body = {"title": f"Ceiling fan not spinning {ts}", "description": f"Fan makes a grinding noise and stops {ts}",
            "category": "Electrician Needed", "service_id": await service_id(ac, h, "Electrician Support"),
            "impact": 1, "urgency": 2, "location_type": "hostel", "hostel_name": "Krishna Bhavan",
            "room_number": "204", "phone": "+91 98765 43210", "acknowledge_duplicate": True, **extra}
    r = await ac.post("/api/incidents", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ───────────── pure domain objects ─────────────

def test_geopoint_distance_and_validation():
    a = GeoPoint(17.5465, 78.5725)
    b = GeoPoint(17.5474, 78.5725)          # ~100 m north
    assert 95 < a.distance_to(b) < 105
    with pytest.raises(InvalidInputError):
        GeoPoint(123, 0)
    assert GeoPoint.from_doc(None) is None
    assert GeoPoint(1, 2, 30).is_precise and not GeoPoint(1, 2, 500).is_precise
    assert not GeoPoint(1, 2, source='building').is_precise


def test_arrival_policy_uses_accuracy_and_building_slack():
    target = GeoPoint(17.5465, 78.5725, 10)
    near = GeoPoint(17.5474, 78.5725, 10)          # ~100 m
    far = GeoPoint(17.5500, 78.5725, 10)           # ~390 m
    policy = ArrivalPolicy(radius_m=100)
    assert policy.check(target, near).verified
    assert not policy.check(target, far).verified
    building = GeoPoint(17.5465, 78.5725, source='building')
    medium = GeoPoint(17.5482, 78.5725, 5)          # ~190 m: too far for a GPS pin, fine for a building pin
    assert not policy.check(target, medium).verified
    assert policy.check(building, medium).verified


def test_navigation_links_and_campus_map():
    links = NavigationLinks.for_point(GeoPoint(17.5, 78.5))
    assert links['google'].startswith('https://www.google.com/maps/dir/?api=1&destination=17.5%2C78.5')
    assert 'openstreetmap.org' in links['osm']
    m = CampusMap({'Library': {'lat': 1.0, 'lng': 2.0}})
    assert m.pin_for('Library').lat == 1.0
    assert m.pin_for('Nowhere') is None
    assert any(b['name'] == 'Library' and b['corrected'] for b in m.buildings())
    name, dist = m.nearest(GeoPoint(*KRISHNA))
    assert name == 'Krishna Bhavan' and dist < 1


def test_handover_code_attempts_and_lock():
    code = HandoverCode('x', '1234')
    with pytest.raises(InvalidInputError):
        code.verify('', 'u', utcnow())
    for _ in range(4):
        with pytest.raises(InvalidInputError):
            code.verify('0000', 'u', utcnow())
    code.verify('1234', 'u', utcnow())               # 5th attempt is right
    assert code.verified_at
    locked = HandoverCode('y', '1234', attempts=5)
    with pytest.raises(TooManyAttemptsError):
        locked.verify('1234', 'u', utcnow())


def test_attachment_factory_validates_per_kind():
    who = {'id': 'u1', 'name': 'U', 'role': 'customer'}
    photo = AttachmentFactory.create('photo', incident_id='i', content_type='image/png', data_base64=PNG,
                                     uploaded_by=who, now=utcnow(), stage='before')
    assert photo.to_doc()['stage'] == 'before'
    with pytest.raises(InvalidInputError):
        AttachmentFactory.create('photo', incident_id='i', content_type='application/pdf', data_base64=PNG,
                                 uploaded_by=who, now=utcnow())
    with pytest.raises(InvalidInputError):
        AttachmentFactory.create('voice', incident_id='i', content_type='audio/webm', data_base64=AUDIO,
                                 uploaded_by=who, now=utcnow(), duration_s=999)
    with pytest.raises(InvalidInputError):
        AttachmentFactory.create('video', incident_id='i', content_type='video/mp4', data_base64=PNG,
                                 uploaded_by=who, now=utcnow())
    with pytest.raises(InvalidInputError):
        AttachmentFactory.create('photo', incident_id='i', content_type='image/png', data_base64='not base64!!',
                                 uploaded_by=who, now=utcnow())


# ───────────── API flows ─────────────

@pytest.mark.anyio
async def test_location_gps_or_building_pin():
    async with client() as ac:
        h, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        gps = await hostel_report(ac, h, latitude=KRISHNA[0], longitude=KRISHNA[1], accuracy_m=12)
        assert gps["geo"]["source"] == "gps" and gps["geo"]["accuracy_m"] == 12
        pin = await hostel_report(ac, h)
        assert pin["geo"]["source"] == "building"
        assert (pin["geo"]["lat"], pin["geo"]["lng"]) == KRISHNA
        info = (await ac.get(f"/api/incidents/{gps['id']}/field", headers=h)).json()
        assert info["on_site"] and info["precise"] and info["navigation"]["google"].startswith("https://www.google.com/maps")
        audit = (await ac.get(f"/api/incidents/{gps['id']}", headers=h)).json()["audit"]
        assert any(a["action"] == "LOCATION_CAPTURED" for a in audit)


@pytest.mark.anyio
async def test_full_field_visit_with_handover_code():
    async with client() as ac:
        sh, student, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        th, tech, _ = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        inc = await hostel_report(ac, sh, latitude=KRISHNA[0], longitude=KRISHNA[1], accuracy_m=10)
        iid = inc["id"]

        # Only the reporter sees the code; the technician sees that one is required.
        mine = (await ac.get(f"/api/incidents/{iid}/field", headers=sh)).json()["handover"]
        assert mine["required"] and len(mine["code"]) == 4
        theirs = (await ac.get(f"/api/incidents/{iid}/field", headers=th)).json()["handover"]
        assert theirs["code"] is None
        stored = await container.incidents.get(iid)
        assert "handover" not in stored and mine["code"] not in json.dumps(stored.get("field_visit") or {})

        # Students cannot log visits; unassigned technicians cannot either.
        assert (await ac.post(f"/api/incidents/{iid}/field/en-route", headers=sh)).status_code == 403
        assert (await ac.post(f"/api/incidents/{iid}/field/en-route", headers=th)).status_code == 409

        assert (await ac.post(f"/api/incidents/{iid}/assign", headers=th, json={"technician_id": tech["id"]})).status_code == 200
        r = await ac.post(f"/api/incidents/{iid}/field/en-route", headers=th)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ACKNOWLEDGED" and r.json()["field_visit"]["status"] == "EN_ROUTE"

        # Too far away → refused with the distance; close by → verified arrival and work starts.
        far = await ac.post(f"/api/incidents/{iid}/field/arrive", headers=th,
                            json={"latitude": KRISHNA[0] + 0.01, "longitude": KRISHNA[1], "accuracy_m": 10})
        assert far.status_code == 422 and "m away" in far.json()["detail"]
        ok = await ac.post(f"/api/incidents/{iid}/field/arrive", headers=th,
                           json={"latitude": KRISHNA[0] + 0.0003, "longitude": KRISHNA[1], "accuracy_m": 15})
        assert ok.status_code == 200, ok.text
        visit = ok.json()["field_visit"]
        assert visit["status"] == "ARRIVED" and visit["verified"] is True and visit["distance_m"] < 60
        assert ok.json()["status"] == "IN_PROGRESS"

        resolve = {"target_status": "RESOLVED", "resolution_summary": "Replaced the fan capacitor"}
        r = await ac.post(f"/api/incidents/{iid}/transition", headers=th, json=resolve)
        assert r.status_code == 422 and "handover code" in r.json()["detail"]
        wrong = "0000" if mine["code"] != "0000" else "1111"
        r = await ac.post(f"/api/incidents/{iid}/transition", headers=th, json={**resolve, "handover_code": wrong})
        assert r.status_code == 422 and "attempts left" in r.json()["detail"]
        r = await ac.post(f"/api/incidents/{iid}/transition", headers=th, json={**resolve, "handover_code": mine["code"]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "RESOLVED" and r.json()["field_visit"]["handover_verified_at"]
        audit = (await ac.get(f"/api/incidents/{iid}", headers=th)).json()["audit"]
        actions = [a["action"] for a in audit]
        for expected in ("TECHNICIAN_EN_ROUTE", "TECHNICIAN_ARRIVED", "HANDOVER_VERIFIED", "RESOLVED"):
            assert expected in actions
        kinds = {n["kind"] for n in (await ac.get("/api/notifications", headers=sh)).json()["items"]
                 if n.get("incident_id") == iid}
        assert {"en_route", "arrived"} <= kinds


@pytest.mark.anyio
async def test_arrival_without_gps_and_admin_bypass():
    async with client() as ac:
        sh, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        ah, _, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        th, tech, _ = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        inc = await hostel_report(ac, sh)
        iid = inc["id"]
        await ac.post(f"/api/incidents/{iid}/assign", headers=ah, json={"technician_id": tech["id"]})
        r = await ac.post(f"/api/incidents/{iid}/field/arrive", headers=th, json={})
        assert r.status_code == 200, r.text
        assert r.json()["field_visit"]["verified"] is False
        # An administrator can resolve without the code; the audit says so.
        r = await ac.post(f"/api/incidents/{iid}/transition", headers=ah,
                          json={"target_status": "RESOLVED", "resolution_summary": "Fixed remotely"})
        assert r.status_code == 200, r.text
        audit = (await ac.get(f"/api/incidents/{iid}", headers=ah)).json()["audit"]
        assert any("without the handover code" in a["description"] for a in audit)


@pytest.mark.anyio
async def test_handover_code_can_be_switched_off_and_online_issues_have_no_visit():
    async with client() as ac:
        sh, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        ah, _, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        th, tech, _ = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        r = await ac.put("/api/admin/settings", headers=ah, json={"require_handover_code": False})
        assert r.status_code == 200, r.text
        try:
            inc = await hostel_report(ac, sh)
            await ac.post(f"/api/incidents/{inc['id']}/assign", headers=ah, json={"technician_id": tech["id"]})
            for target in ("ACKNOWLEDGED", "IN_PROGRESS"):
                await ac.post(f"/api/incidents/{inc['id']}/transition", headers=th, json={"target_status": target})
            r = await ac.post(f"/api/incidents/{inc['id']}/transition", headers=th,
                              json={"target_status": "RESOLVED", "resolution_summary": "Done"})
            assert r.status_code == 200, r.text
        finally:
            await ac.put("/api/admin/settings", headers=ah, json={"require_handover_code": True})

        online = await ac.post("/api/incidents", headers=sh, json={
            "title": f"Cannot log in to LMS {time.time_ns()}", "description": "Password reset link never arrives",
            "category": "Authentication", "service_id": await service_id(ac, sh, "Identity Provider (SSO)"),
            "impact": 1, "urgency": 1, "location_type": "online", "phone": "+91 98765 43210",
            "acknowledge_duplicate": True})
        assert online.status_code == 201, online.text
        assert online.json()["geo"] is None
        info = (await ac.get(f"/api/incidents/{online.json()['id']}/field", headers=sh)).json()
        assert info["on_site"] is False and info["navigation"] is None


@pytest.mark.anyio
async def test_photos_and_voice_notes():
    async with client() as ac:
        sh, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        th, _, _ = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        oh, _, _ = await login(ac, "emma@example.com", "Customer@1234")
        inc = await hostel_report(ac, sh)
        iid = inc["id"]
        r = await ac.post(f"/api/incidents/{iid}/attachments", headers=sh,
                          json={"kind": "photo", "content_type": "image/png", "data_base64": PNG, "stage": "before"})
        assert r.status_code == 201, r.text
        photo = r.json()
        assert "data" not in photo and photo["size"] > 0
        r = await ac.post(f"/api/incidents/{iid}/attachments", headers=sh, json={
            "kind": "voice", "content_type": "audio/webm;codecs=opus", "data_base64": AUDIO, "duration_s": 4.2,
            "transcript": "the fan in room 204 makes a grinding noise"})
        assert r.status_code == 201, r.text
        assert r.json()["content_type"] == "audio/webm" and r.json()["transcript"].startswith("the fan")
        # Students cannot add the technician's "after" photo.
        r = await ac.post(f"/api/incidents/{iid}/attachments", headers=sh,
                          json={"kind": "photo", "content_type": "image/png", "data_base64": PNG, "stage": "after"})
        assert r.status_code == 403
        items = (await ac.get(f"/api/incidents/{iid}/attachments", headers=th)).json()   # unassigned queue: visible
        assert [a["kind"] for a in items] == ["photo", "voice"]
        content = await ac.get(f"/api/attachments/{photo['id']}/content", headers=sh)
        assert content.status_code == 200 and content.headers["content-type"] == "image/png"
        assert content.content == base64.b64decode(PNG)
        # Another student cannot read it.
        assert (await ac.get(f"/api/attachments/{photo['id']}/content", headers=oh)).status_code == 403
        assert (await ac.get(f"/api/incidents/{iid}/attachments", headers=oh)).status_code == 403


@pytest.mark.anyio
async def test_qr_assets_prefill_and_link_reports():
    async with client() as ac:
        ah, _, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        sh, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        seeded = (await ac.get("/api/assets", headers=ah)).json()
        assert any(a["code"] == "AST-0001" for a in seeded)
        assert (await ac.get("/api/assets", headers=sh)).status_code == 403

        r = await ac.post("/api/assets", headers=ah, json={
            "name": "Router, Ram Bhavan 1st floor", "kind": "Network", "location_type": "hostel",
            "hostel_name": "Ram Bhavan", "room_number": "1st floor", "category": "Technician Needed",
            "service_name": "Technician Support"})
        assert r.status_code == 201, r.text
        code = r.json()["code"]
        assert code.startswith("AST-") and r.json()["location"]["formatted"] == "Ram Bhavan, Room 1st floor"

        svg = await ac.get(f"/api/assets/{code}/qr.svg", headers=ah, params={"base": "https://demo.example.dev"})
        assert svg.status_code == 200 and svg.text.lstrip().startswith("<?xml") or "<svg" in svg.text
        assert (await ac.get(f"/api/assets/{code}/qr.svg", headers=ah, params={"base": "javascript:alert(1)"})).status_code == 422

        info = (await ac.get(f"/api/assets/{code.lower()}", headers=sh)).json()
        assert info["name"].startswith("Router") and info["open_reports"] == 0
        r = await ac.post("/api/incidents", headers=sh, json={
            "title": f"Wi-Fi down near router {time.time_ns()}", "description": "No internet on the whole floor",
            "category": "Technician Needed", "service_id": await service_id(ac, sh, "Technician Support"),
            "impact": 2, "urgency": 2, "location_type": "hostel", "hostel_name": "Ram Bhavan",
            "room_number": "1st floor", "phone": "+91 98765 43210", "asset_code": code, "acknowledge_duplicate": True})
        assert r.status_code == 201, r.text
        assert r.json()["asset"] == {"code": code, "name": "Router, Ram Bhavan 1st floor"}
        assert (await ac.get(f"/api/assets/{code}", headers=sh)).json()["open_reports"] == 1
        bad = await ac.post("/api/incidents", headers=sh, json={
            "title": "Something broken here", "description": "Scanned an unknown sticker", "category": "Technician Needed",
            "service_id": await service_id(ac, sh, "Technician Support"), "impact": 1, "urgency": 1,
            "location_type": "hostel", "hostel_name": "Ram Bhavan", "room_number": "1", "phone": "+91 98765 43210",
            "asset_code": "AST-9999", "acknowledge_duplicate": True})
        assert bad.status_code == 404
        assert (await ac.delete(f"/api/assets/{code}", headers=ah)).status_code == 204


@pytest.mark.anyio
async def test_building_outage_detection_and_campus_map():
    async with client() as ac:
        ah, _, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        sh, _, _ = await login(ac, "f20250051@hyderabad.bits-pilani.ac.in", "Student@1234")
        await container.correlation_alerts.col.delete_many({'building': 'Gautam Bhavan'})
        sid = await service_id(ac, sh, "Technician Support")
        for n in range(3):
            r = await ac.post("/api/incidents", headers=sh, json={
                "title": f"No power in my room {n} {time.time_ns()}", "description": f"Lights and sockets dead {n}",
                "category": "Technician Needed", "service_id": sid, "impact": 1, "urgency": 2,
                "location_type": "hostel", "hostel_name": "Gautam Bhavan", "room_number": str(100 + n),
                "phone": "+91 98765 43210", "acknowledge_duplicate": True})
            assert r.status_code == 201, r.text
        alerts = await container.correlation_alerts.find({'building': 'Gautam Bhavan'})
        assert len(alerts) == 1 and alerts[0]['count'] >= 3

        m = (await ac.get("/api/campus/map", headers=ah)).json()
        assert any(p["building"] == "Gautam Bhavan" for p in m["points"])
        assert any(h["building"] == "Gautam Bhavan" and h["is_hotspot"] for h in m["hotspots"])
        assert any(o["building"] == "Gautam Bhavan" for o in m["outages"])
        assert (await ac.get("/api/campus/map", headers=sh)).status_code == 403

        b = (await ac.get("/api/campus/buildings", headers=sh)).json()
        assert len(b["buildings"]) >= 20
        r = await ac.put("/api/campus/buildings/Library", headers=ah, json={"latitude": 17.5459, "longitude": 78.5711})
        assert r.status_code == 200
        lib = next(x for x in r.json()["buildings"] if x["name"] == "Library")
        assert lib["corrected"] and lib["lat"] == 17.5459
        assert (await ac.put("/api/campus/buildings/Library", headers=sh, json={"latitude": 1, "longitude": 1})).status_code == 403
        assert (await ac.put("/api/campus/buildings/Mars", headers=ah, json={"latitude": 1, "longitude": 1})).status_code == 404


@pytest.mark.anyio
async def test_live_hub_delivers_only_to_people_who_may_see_the_incident():
    from app.services.live import LiveHub, LiveEventObserver
    from app.domain.events import IncidentEvent, EventType as E
    hub = LiveHub()
    obs = LiveEventObserver(hub)
    reporter = hub.subscribe({'id': 'stu1', 'role': 'customer'})
    other = hub.subscribe({'id': 'stu2', 'role': 'customer'})
    admin = hub.subscribe({'id': 'adm', 'role': 'admin'})
    tech = hub.subscribe({'id': 't1', 'role': 'technician'})
    inc = {'id': 'i1', 'number': 'INC-1', 'reporter_id': 'stu1', 'assigned_to': 't2', 'status': 'ASSIGNED'}
    await obs.on_event(IncidentEvent(E.TECHNICIAN_EN_ROUTE, inc, {'id': 't2', 'name': 'T'}, 'on the way'))
    await obs.on_event(IncidentEvent(E.SLA_APPLIED, inc, {'id': 'system'}, 'quiet'))
    assert reporter.queue.qsize() == 1 and admin.queue.qsize() == 1
    assert other.queue.qsize() == 0 and tech.queue.qsize() == 0
    msg = json.loads(reporter.queue.get_nowait())
    assert msg['type'] == 'TECHNICIAN_EN_ROUTE' and msg['number'] == 'INC-1'
    hub.unsubscribe(reporter)
    assert hub.connections == 3


@pytest.mark.anyio
async def test_live_stream_requires_a_valid_token():
    async with client() as ac:
        r = await ac.get("/api/live/stream", params={"token": "x" * 20})
        assert r.status_code == 401
