"""Regression tests for bugs fixed on 2026-11-01."""
import time
import pytest
from httpx import AsyncClient, ASGITransport
from server import app
from app.core.db import db, init_db
from app.services.intelligence import IntelligenceService


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    await init_db()


async def login(ac, email, password):
    r = await ac.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


async def new_incident(ac, headers, **extra):
    svc = (await ac.get("/api/catalog/services", headers=headers)).json()
    service_id = next(s["id"] for s in svc if s["name"] == "Office Wi-Fi")
    ts = time.time_ns()
    body = {
        "title": f"Regression incident {ts}",
        "description": f"Unique regression description number {ts}",
        "category": "Network", "service_id": service_id,
        "impact": 1, "urgency": 1, "location_type": "online",
        "acknowledge_duplicate": True,
    }
    body.update(extra)
    r = await ac.post("/api/incidents", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_password_reset_does_not_reveal_unknown_accounts():
    async with client() as ac:
        r = await ac.post("/api/auth/password-reset/request", json={"email": "nobody-here@example.com"})
        assert r.status_code == 200
        assert "If nobody-here@example.com is registered" in r.json()["message"]


@pytest.mark.anyio
async def test_audit_trail_visible_by_incident_number_and_assignment_previous_state():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await new_incident(ac, cust)
        r = await ac.post(f"/api/incidents/{inc['number']}/notes", json={"text": "note via number"}, headers=adm)
        assert r.status_code == 200, r.text
        r = await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=adm)
        assert r.status_code == 200, r.text
        for key in (inc["id"], inc["number"]):
            audit = (await ac.get(f"/api/incidents/{key}", headers=adm)).json()["audit"]
            actions = [a["action"] for a in audit]
            assert actions == ["INCIDENT_CREATED", "INCIDENT_CLASSIFIED", "PRIORITY_CALCULATED", "SLA_APPLIED",
                               "NOTE_ADDED", "ASSIGNED"], actions
            assert audit[-1]["previous_state"] == "CLASSIFIED"


@pytest.mark.anyio
async def test_reopen_clears_resolution_and_resumes_sla():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await new_incident(ac, cust)
        await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=adm)
        for st in ("ACKNOWLEDGED", "IN_PROGRESS"):
            assert (await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": st}, headers=adm)).status_code == 200
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": "RESOLVED", "resolution_summary": "Fixed"}, headers=adm)
        assert r.json()["sla"]["status"] == "MET"
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": "IN_PROGRESS"}, headers=cust)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resolution"] is None
        assert body["sla"]["resolved_at"] is None
        assert body["sla"]["status"] != "MET"


@pytest.mark.anyio
async def test_blank_resolution_summary_rejected():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await new_incident(ac, cust)
        await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=adm)
        for st in ("ACKNOWLEDGED", "IN_PROGRESS"):
            await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": st}, headers=adm)
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": "RESOLVED", "resolution_summary": "   "}, headers=adm)
        assert r.status_code == 422


@pytest.mark.anyio
async def test_technician_cannot_take_or_list_another_technicians_incident():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        bob, bob_user = await login(ac, "bob.kumar@itsm.local", "Tech@1234")
        alice, alice_user = await login(ac, "alice.chen@itsm.local", "Tech@1234")
        inc = await new_incident(ac, cust)
        r = await ac.post(f"/api/incidents/{inc['id']}/assign", json={"technician_id": bob_user["id"]}, headers=adm)
        assert r.status_code == 200, r.text
        r = await ac.post(f"/api/incidents/{inc['id']}/assign", json={"technician_id": alice_user["id"]}, headers=alice)
        assert r.status_code == 403
        listed = (await ac.get("/api/incidents", params={"assigned_to": bob_user["id"]}, headers=alice)).json()
        assert all(x["assigned_to"] in (None, alice_user["id"]) for x in listed)


@pytest.mark.anyio
async def test_update_keeps_location_nested_and_recalculates_priority():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await new_incident(ac, cust)
        assert inc["priority"] == "P4"
        r = await ac.patch(f"/api/incidents/{inc['id']}", json={
            "impact": 3, "urgency": 3, "business_criticality": 3,
            "location_type": "academics", "academic_block": "Library", "room_number": "12",
        }, headers=adm)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["priority"] == "P1"
        assert body["sla"]["response_minutes"] == 5
        assert body["location"]["formatted"] == "Library, Room/Lab 12"
        assert "academic_block" not in body and "location_type" not in body


@pytest.mark.anyio
async def test_admin_cannot_deactivate_self():
    async with client() as ac:
        adm, adm_user = await login(ac, "admin@example.com", "ChangeMe@123")
        r = await ac.patch(f"/api/admin/users/{adm_user['id']}/active", json={"is_active": False}, headers=adm)
        assert r.status_code == 422
        assert (await ac.get("/api/auth/me", headers=adm)).status_code == 200


@pytest.mark.anyio
async def test_resolved_today_is_counted():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        before = (await ac.get("/api/reports/overview", headers=adm)).json()["totals"]["resolved_today"]
        inc = await new_incident(ac, cust)
        await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=adm)
        for st in ("ACKNOWLEDGED", "IN_PROGRESS"):
            await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": st}, headers=adm)
        await ac.post(f"/api/incidents/{inc['id']}/transition", json={"target_status": "RESOLVED", "resolution_summary": "Done"}, headers=adm)
        after = (await ac.get("/api/reports/overview", headers=adm)).json()["totals"]["resolved_today"]
        assert after == before + 1


@pytest.mark.anyio
async def test_classifier_matches_whole_words_only():
    intel = IntelligenceService(db)
    r = await intel.classify("Download page in building", "Example firewall plan for groups")
    assert r["impact"] != 3, "'download'/'example'/'firewall' must not count as outage words"
    assert r["category"] != "Application", "'ui' inside 'building' must not count"


@pytest.mark.anyio
async def test_generate_incident_never_500s_on_short_input():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        r = await ac.post("/api/intelligence/generate-incident", json={"description": "a          b"}, headers=cust)
        assert r.status_code == 200, r.text


@pytest.mark.anyio
async def test_google_accounts_cannot_be_logged_into_with_a_derived_password(monkeypatch):
    from app.routers import auth as auth_router
    email = f"f2025{time.time_ns() % 10000:04d}@hyderabad.bits-pilani.ac.in"
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client")
    import google.oauth2.id_token as id_token
    monkeypatch.setattr(id_token, "verify_oauth2_token", lambda *a, **k: {
        "iss": "accounts.google.com", "email_verified": True, "email": email, "name": "G User"})
    async with client() as ac:
        r = await ac.post("/api/auth/google", json={"credential": "x"})
        assert r.status_code == 200, r.text
        sid = auth_router.extract_student_id(email)
        r = await ac.post("/api/auth/login", json={"email": email, "password": f"GoogleAuth_{email}_{sid}"})
        assert r.status_code == 401
