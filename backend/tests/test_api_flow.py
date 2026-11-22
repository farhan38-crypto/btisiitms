import pytest
from httpx import AsyncClient, ASGITransport
from server import app
from app.core.db import db, client, init_db

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    # Start every run from a clean test database so reruns don't trip
    # duplicate detection or technician capacity limits.
    assert db.name.endswith('_test'), 'Refusing to wipe a non-test database'
    await client.drop_database(db.name)
    await init_db()

@pytest.mark.anyio
async def test_auth_login_all_roles():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Admin login
        r = await ac.post("/api/auth/login", json={"email": "admin@example.com", "password": "ChangeMe@123"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "admin"
        admin_token = r.json()["access_token"]

        # Customer login
        r = await ac.post("/api/auth/login", json={"email": "emma@example.com", "password": "Customer@1234"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "customer"
        cust_token = r.json()["access_token"]

        # Tech login
        r = await ac.post("/api/auth/login", json={"email": "alice.chen@itsm.local", "password": "Tech@1234"})
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "technician"
        tech_token = r.json()["access_token"]

@pytest.mark.anyio
async def test_full_incident_lifecycle():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Login as customer
        r_cust = await ac.post("/api/auth/login", json={"email": "emma@example.com", "password": "Customer@1234"})
        cust_headers = {"Authorization": f"Bearer {r_cust.json()['access_token']}"}

        # 2. Get catalog
        r_cat = await ac.get("/api/catalog/categories", headers=cust_headers)
        assert r_cat.status_code == 200
        category = r_cat.json()[0]["name"]

        r_svc = await ac.get("/api/catalog/services", headers=cust_headers)
        assert r_svc.status_code == 200
        service_id = r_svc.json()[0]["id"]

        # 3. Create incident
        inc_data = {
            "title": "Corporate VPN connection dropped in office",
            "description": "Unable to connect to internal services via VPN since this morning.",
            "category": category,
            "service_id": service_id,
            "impact": 2,
            "urgency": 2,
            "business_criticality": 2,
            "affected_users": 15
        }
        r_inc = await ac.post("/api/incidents", json=inc_data, headers=cust_headers)
        assert r_inc.status_code == 201, r_inc.text
        inc = r_inc.json()
        inc_id = inc["id"]
        assert inc["status"] == "CLASSIFIED"
        assert inc["priority"] in ["P1", "P2", "P3", "P4"]

        # 4. Login as admin
        r_adm = await ac.post("/api/auth/login", json={"email": "admin@example.com", "password": "ChangeMe@123"})
        adm_headers = {"Authorization": f"Bearer {r_adm.json()['access_token']}"}

        # Check overview
        r_rep = await ac.get("/api/reports/overview", headers=adm_headers)
        assert r_rep.status_code == 200
        assert r_rep.json()["totals"]["total"] >= 1

        # 5. Admin auto-assigns
        r_assign = await ac.post(f"/api/incidents/{inc_id}/auto-assign", headers=adm_headers)
        assert r_assign.status_code == 200, r_assign.text
        assigned_inc = r_assign.json()
        assert assigned_inc["status"] == "ASSIGNED"
        assert assigned_inc["assigned_to"] is not None

        # 6. Tech login & acknowledge
        tech_email = "alice.chen@itsm.local"
        r_tech = await ac.post("/api/auth/login", json={"email": tech_email, "password": "Tech@1234"})
        tech_headers = {"Authorization": f"Bearer {r_tech.json()['access_token']}"}

        # Tech acknowledges or admin acknowledges
        r_ack = await ac.post(f"/api/incidents/{inc_id}/transition", json={"target_status": "ACKNOWLEDGED"}, headers=adm_headers)
        assert r_ack.status_code == 200
        assert r_ack.json()["status"] == "ACKNOWLEDGED"

        # 7. Move to IN_PROGRESS
        r_prog = await ac.post(f"/api/incidents/{inc_id}/transition", json={"target_status": "IN_PROGRESS"}, headers=adm_headers)
        assert r_prog.status_code == 200
        assert r_prog.json()["status"] == "IN_PROGRESS"

        # 8. Resolve
        r_res = await ac.post(f"/api/incidents/{inc_id}/transition", json={
            "target_status": "RESOLVED",
            "resolution_summary": "Rebooted VPN gateway and refreshed IP pool",
            "root_cause": "IP pool exhaustion"
        }, headers=adm_headers)
        assert r_res.status_code == 200
        assert r_res.json()["status"] == "RESOLVED"
        assert r_res.json()["resolution"]["summary"] == "Rebooted VPN gateway and refreshed IP pool"

        # 9. Customer verifies
        r_ver = await ac.post(f"/api/incidents/{inc_id}/transition", json={"target_status": "VERIFIED"}, headers=cust_headers)
        assert r_ver.status_code == 200
        assert r_ver.json()["status"] == "VERIFIED"

        # 10. Customer closes
        r_cls = await ac.post(f"/api/incidents/{inc_id}/transition", json={"target_status": "CLOSED", "feedback_rating": 5}, headers=cust_headers)
        assert r_cls.status_code == 200
        assert r_cls.json()["status"] == "CLOSED"
        assert r_cls.json()["closure"]["feedback_rating"] == 5

@pytest.mark.anyio
async def test_bits_student_registration_restriction():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Non-BITS email must fail
        resp = await ac.post("/api/auth/register", json={
            "name": "External Student",
            "email": "external.person@gmail.com",
            "password": "Password@123"
        })
        assert resp.status_code == 400
        assert "hyderabad.bits-pilani.ac.in" in resp.json()["detail"]

        # Valid BITS Hyderabad email must succeed and extract student ID
        import time
        unique_email = f"f2025{int(time.time() * 1000) % 10000:04d}@hyderabad.bits-pilani.ac.in"
        resp_bits = await ac.post("/api/auth/register", json={
            "name": "BITS Test Student",
            "email": unique_email,
            "password": "Student@1234",
            "phone": "+91 91234 56789"
        })
        assert resp_bits.status_code == 200
        data = resp_bits.json()
        assert data["user"]["role"] == "customer"
        assert len(data["user"]["student_id"]) >= 4

@pytest.mark.anyio
async def test_admin_user_creation_any_email():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Sign in as admin
        login_resp = await ac.post("/api/auth/login", json={
            "email": "admin@example.com",
            "password": "ChangeMe@123"
        })
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        import time
        suffix = int(time.time() * 1000)
        # Admin creates new Admin with external domain
        admin_create = await ac.post("/api/admin/users", headers=headers, json={
            "name": "Co-Admin Officer",
            "email": f"coadmin_{suffix}@bits-admin.org",
            "password": "AdminPassword@123",
            "role": "admin",
            "phone": "+91 99999 88888"
        })
        assert admin_create.status_code == 201
        assert admin_create.json()["role"] == "admin"
        assert admin_create.json()["email"] == f"coadmin_{suffix}@bits-admin.org"

        # Admin creates new Technician with custom skills & capacity
        tech_create = await ac.post("/api/admin/users", headers=headers, json={
            "name": "Hostel Net Tech",
            "email": f"tech_{suffix}@network.net",
            "password": "TechPassword@123",
            "role": "technician",
            "skills": ["Network", "Hardware"],
            "max_concurrent": 8,
            "phone": "+91 97777 66666"
        })
        assert tech_create.status_code == 201
        assert tech_create.json()["role"] == "technician"
        assert tech_create.json()["skills"] == ["Network", "Hardware"]
        assert tech_create.json()["max_concurrent"] == 8

@pytest.mark.anyio
async def test_bits_campus_incident_location_and_intelligence():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Login as student
        login_resp = await ac.post("/api/auth/login", json={
            "email": "f20250051@hyderabad.bits-pilani.ac.in",
            "password": "Student@1234"
        })
        token = login_resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Test Intelligence classification
        class_resp = await ac.post("/api/intelligence/classify", headers=headers, json={
            "title": "Wi-Fi outage in Krishna Bhavan",
            "description": "Entire 2nd floor router is down before midsem exams"
        })
        assert class_resp.status_code == 200
        intel_data = class_resp.json()
        assert intel_data["category"] == "Network"
        assert intel_data["impact"] == 3
        assert intel_data["score"] >= 80
        assert "root_cause_hypothesis" in intel_data

        # Get service
        svc_resp = await ac.get("/api/catalog/services", headers=headers)
        services = svc_resp.json()
        technician_service_id = next(s["id"] for s in services if s["name"] == "Technician Support")
        electrician_service_id = next(s["id"] for s in services if s["name"] == "Electrician Support")

        import time
        ts = int(time.time() * 1000)
        # File Hostel complaint
        hostel_inc = await ac.post("/api/incidents", headers=headers, json={
            "title": f"Krishna Bhavan Wi-Fi down {ts}",
            "description": f"Router offline in 2nd floor wing B {ts}",
            "category": "Technician Needed",
            "service_id": technician_service_id,
            "impact": 2,
            "urgency": 2,
            "location_type": "hostel",
            "hostel_name": "Krishna Bhavan",
            "room_number": "204",
            "phone": "+91 98765 43210"
        })
        assert hostel_inc.status_code == 201
        doc = hostel_inc.json()
        assert doc["student_id"] == "20250051"
        assert doc["location"]["type"] == "hostel"
        assert doc["location"]["hostel_name"] == "Krishna Bhavan"
        assert doc["location"]["formatted"] == "Krishna Bhavan, Room 204"

        # File Academic Block complaint
        acad_inc = await ac.post("/api/incidents", headers=headers, json={
            "title": f"Projector not working in LTC {ts}",
            "description": f"HDMI cable broken and lamp warning blinking {ts}",
            "category": "Electrician Needed",
            "service_id": electrician_service_id,
            "impact": 2,
            "urgency": 2,
            "location_type": "academics",
            "academic_block": "LTC (Lecture Theatre Complex)",
            "room_number": "LTC-101",
            "phone": "+91 98765 43210"
        })
        assert acad_inc.status_code == 201
        acad_doc = acad_inc.json()
        assert acad_doc["location"]["type"] == "academics"
        assert acad_doc["location"]["academic_block"] == "LTC (Lecture Theatre Complex)"
        assert acad_doc["location"]["formatted"] == "LTC (Lecture Theatre Complex), Room/Lab LTC-101"
