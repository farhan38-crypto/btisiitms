"""Generate-details fills the whole form: category, service, impact, urgency,
criticality, affected people and location — with and without AI."""
import json
import time

import httpx
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.container import container
from app.core.db import init_db
from app.domain.campus import extract_location, estimate_criticality
from app.domain.models import Location
from app.services.intelligence import GeminiAdapter


@pytest.mark.parametrize('text,expected', [
    ('Router in my room 204 of Krishna Bhavan is dead', {'type': 'hostel', 'hostel_name': 'Krishna Bhavan', 'room_number': '204'}),
    ('wifi down in gautam hostel rm 115', {'type': 'hostel', 'hostel_name': 'Gautam Bhavan', 'room_number': '115'}),
    ('Projector in LTC-101 shows no signal', {'type': 'academics', 'academic_block': 'LTC (Lecture Theatre Complex)', 'room_number': 'LTC-101'}),
    ('Lab 203 PCs in D block not booting', {'type': 'academics', 'academic_block': 'Block D', 'room_number': '203'}),
    ('Block F classroom F-105 AC leaking', {'type': 'academics', 'academic_block': 'Block F', 'room_number': 'F-105'}),
    ('NAB 2nd floor printer jammed', {'type': 'academics', 'academic_block': 'NAB (New Academic Block)', 'room_number': None}),
    ('Medical Centre computer will not start', {'type': 'academics', 'academic_block': 'Medical Centre'}),
    ('Room No. 32B fan broken', {'type': None, 'room_number': '32B'}),
    ('My laptop cannot connect to the VPN', {'type': None, 'room_number': None}),
    ('', {'type': None, 'room_number': None}),
    ('I scored 204 marks in the exam block', {'type': None, 'room_number': None}),     # numbers alone are not rooms
])
def test_extract_location(text, expected):
    got = extract_location(text)
    assert {k: got[k] for k in expected} == expected


@pytest.mark.parametrize('text,level', [
    ('Wi-Fi down and my quiz starts in 10 minutes', 3), ('Fee payment failing before the deadline', 3),
    ('Cannot submit my assignment on the LMS', 2), ('Lab PC not working during class', 2),
    ('Fan making noise', 1), ('', 1),
])
def test_estimate_criticality(text, level):
    assert estimate_criticality(text) == level


def test_online_location_is_formatted():
    assert Location('online', None, 'Krishna Bhavan', '204').formatted == 'Online assistance — Krishna Bhavan, Room 204'
    assert Location('online', 'Library', None, None).formatted == 'Online assistance — Library'
    assert Location('online').formatted == 'Online assistance'


@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


@pytest.fixture
async def api(anyio_backend):
    await init_db()
    container.intel.classifier_factory = lambda: None
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
        r = await ac.post('/api/auth/login', json={'email': 'f20250051@hyderabad.bits-pilani.ac.in', 'password': 'Student@1234'})
        ac.headers['Authorization'] = f"Bearer {r.json()['access_token']}"
        yield ac
    container.intel.classifier_factory = GeminiAdapter.from_env


def gemini(reply):
    def handler(request):
        return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': json.dumps(reply)}]}}]})
    container.intel.classifier_factory = lambda: GeminiAdapter('k', 'm', transport=httpx.MockTransport(handler), retry_delay=0)


async def generate(api, text):
    r = await api.post('/api/intelligence/generate-incident', json={'description': text})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.anyio
async def test_screenshot_case_with_ai(api):
    # The AI rewrite drops the place ("the user's room"); the location still comes from the student's words.
    gemini({'title': "Router in user's room not functioning", 'category': 'Network', 'impact': 1, 'urgency': 2,
            'improved_description': "The network router in my room is not working, so I have no network access.",
            'affected_users_estimate': 1, 'business_criticality': 2, 'scope': 'it'})
    d = await generate(api, 'router in my room 204 krishna bhavan not working, no internet since morning, assignment due')
    assert d['category'] == 'Network' and d['service'] == 'Office Wi-Fi'
    assert d['location'] == {'type': 'hostel', 'hostel_name': 'Krishna Bhavan', 'academic_block': None, 'room_number': '204'}
    assert d['business_criticality'] == 2 and d['affected_users'] == 1 and (d['impact'], d['urgency']) == (1, 2)
    assert 'Location' not in d['missing_information']


@pytest.mark.anyio
async def test_without_ai_everything_still_fills(api):
    d = await generate(api, 'The router in my room 204 in Krishna Bhavan is not working and there is no internet before my quiz')
    assert d['category'] == 'Network' and d['service'] == 'Office Wi-Fi' and d['confidence'] == 0.62
    assert d['location']['hostel_name'] == 'Krishna Bhavan' and d['business_criticality'] == 3


@pytest.mark.anyio
@pytest.mark.parametrize('text,category,service', [
    ('The ceiling fan in my room 112 Gandhi Bhavan stopped working', 'Electrician Needed', None),
    ('My bed frame broke and the cupboard door lock is jammed in Ram Bhavan', 'Carpenter Needed', None),
    ('Locked out of my ERP account, OTP not coming', 'Authentication', 'Identity Provider (SSO)'),
    ('Fee payment failed on the portal but money was debited', 'Application', 'Payment Gateway'),
    ('VPN keeps disconnecting from home', 'Network', 'Corporate VPN'),
])
async def test_without_ai_category_and_service_for_common_reports(api, text, category, service):
    d = await generate(api, text)
    assert (d['category'], d['service']) == (category, service)


@pytest.mark.anyio
async def test_ai_garbage_criticality_falls_back_to_rules(api):
    gemini({'title': 'Wi-Fi outage', 'category': 'Network', 'business_criticality': 'very', 'affected_users_estimate': -3})
    d = await generate(api, 'Wi-Fi is down across Block C during the midsem exam')
    assert d['business_criticality'] == 3 and d['affected_users'] == 1 and d['location']['academic_block'] == 'Block C'


@pytest.mark.anyio
async def test_online_report_keeps_location_and_hostel_visit_time(api):
    svc = {s['name']: s['id'] for s in (await api.get('/api/catalog/services')).json()}
    r = await api.post('/api/incidents', json={
        'title': f'LAN port dead {time.time_ns()}', 'description': 'The LAN port in my room gives no connection at all',
        'category': 'Network', 'service_id': svc['Office Wi-Fi'], 'impact': 1, 'urgency': 2, 'location_type': 'online',
        'hostel_name': 'Krishna Bhavan', 'room_number': '204', 'acknowledge_duplicate': True})
    assert r.status_code == 201 and r.json()['location']['formatted'] == 'Online assistance — Krishna Bhavan, Room 204'
    r = await api.post('/api/incidents', json={
        'title': f'Fan broken {time.time_ns()}', 'description': 'Ceiling fan does not turn on at all', 'category': 'Electrician Needed',
        'service_id': svc['Electrician Support'], 'impact': 1, 'urgency': 2, 'location_type': 'hostel', 'hostel_name': 'Ram Bhavan',
        'room_number': '12', 'visit_availability': 'Weekdays after 5 pm', 'acknowledge_duplicate': True})
    assert r.status_code == 201 and r.json()['visit_availability'] == 'Weekdays after 5 pm'


@pytest.mark.anyio
async def test_without_ai_title_is_short_and_urgency_reflects_the_text(api):
    d = await generate(api, 'router in my room 204 krishna bhavan not working, no internet since morning, assignment due')
    assert d['title'] == 'Router in my room 204 krishna bhavan not working'
    assert d['urgency'] == 2 and d['business_criticality'] == 2
    d = await generate(api, 'Wi-Fi is down in Block C and my quiz starts in ten minutes')
    assert d['urgency'] == 3
    d = await generate(api, 'a' * 300)
    assert 4 <= len(d['title']) <= 70


def test_short_title_edge_cases():
    from app.services.intelligence import IntelligenceService
    t = IntelligenceService._short_title
    assert t('vpn broken. tried restarting') == 'Vpn broken'
    assert t('hi') == 'Campus IT support request'
    assert t('word ' * 40).endswith('word') and len(t('word ' * 40)) <= 70
