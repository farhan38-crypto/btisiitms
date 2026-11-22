"""Non-IT detection through the API, with and without AI."""
import json
import time

import httpx
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.container import container
from app.core.db import init_db
from app.services.intelligence import GeminiAdapter


@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


@pytest.fixture
async def api(anyio_backend):
    await init_db()
    container.intel.classifier_factory = lambda: None            # default: no AI, like a demo without internet
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
        r = await ac.post('/api/auth/login', json={'email': 'f20250051@hyderabad.bits-pilani.ac.in', 'password': 'Student@1234'})
        ac.headers['Authorization'] = f"Bearer {r.json()['access_token']}"
        yield ac
    container.intel.classifier_factory = GeminiAdapter.from_env


def gemini_says(scope=None, *, fail=False, **fields):
    calls = []

    def handler(request):
        calls.append(request)
        if fail:
            return httpx.Response(503)
        body = {'title': 'AI title for report', 'improved_description': 'AI rewritten description text.', 'category': 'Network',
                'impact': 2, 'urgency': 2, **fields}
        if scope is not None:
            body['scope'] = scope
        return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': json.dumps(body)}]}}]})
    container.intel.classifier_factory = lambda: GeminiAdapter('k', 'gemini-2.5-flash', transport=httpx.MockTransport(handler), retry_delay=0)
    return calls


async def scope(api, description, title='', use_ai=True):
    r = await api.post('/api/intelligence/scope', json={'title': title, 'description': description, 'use_ai': use_ai})
    assert r.status_code == 200, r.text
    return r.json()


async def report(api, title, description, **extra):
    svc = next(s['id'] for s in (await api.get('/api/catalog/services')).json() if s['name'] == 'Office Wi-Fi')
    return await api.post('/api/incidents', json={
        'title': title, 'description': description, 'category': 'Network', 'service_id': svc, 'impact': 1, 'urgency': 1,
        'location_type': 'online', 'acknowledge_duplicate': True, **extra})


# ───────────── without AI ─────────────

@pytest.mark.anyio
async def test_scope_endpoint_without_ai(api):
    r = await scope(api, 'A report indicating a potential suicide involving a student named Farhan')
    assert r['in_scope'] is False and r['kind'] == 'mental_health_crisis' and r['emergency'] is True
    assert r['source'] == 'rules' and any(c['number'] == '14416' for c in r['contacts'])
    assert (await scope(api, 'Wi-Fi keeps disconnecting in Krishna Bhavan'))['in_scope'] is True


@pytest.mark.anyio
async def test_generate_details_does_not_rewrite_a_crisis_into_a_ticket(api):
    text = 'A report has been received indicating a potential suicide involving a student named Farhan.'
    r = await api.post('/api/intelligence/generate-incident', json={'description': text})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['scope']['in_scope'] is False and body['scope']['kind'] == 'mental_health_crisis'
    assert body['description'] == text and body['priority'] == 'Not applicable'


@pytest.mark.anyio
async def test_submitting_a_non_it_report_is_stopped_with_guidance(api):
    r = await report(api, f'Medical help {time.time_ns()}', 'My roommate fainted and is not breathing properly')
    assert r.status_code == 422 and r.json()['error'] == 'OutOfScopeError'
    assert r.json()['scope']['kind'] == 'medical_emergency'
    assert any(c['number'] == '9640921921' for c in r.json()['scope']['contacts'])


@pytest.mark.anyio
async def test_reporter_can_override_a_false_alarm_and_it_is_recorded(api):
    title = f'Projector smoke test {time.time_ns()}'
    r = await report(api, title, 'Smoke coming out of the projector fan vent, it smells hot')
    assert r.status_code == 422
    r = await report(api, title, 'Smoke coming out of the projector fan vent, it smells hot', confirm_in_scope=True)
    assert r.status_code == 201, r.text
    audit = (await api.get(f"/api/incidents/{r.json()['id']}")).json()['audit']
    assert any('after a "fire" warning' in a['description'] for a in audit)
    assert not any('Smoke coming' in a['description'] for a in audit)          # report text is not copied into the log


@pytest.mark.anyio
async def test_it_reports_with_scary_words_go_through(api):
    for title, desc in [('Kill process needed', 'Need to kill the process, the app keeps crashing on lab PCs'),
                        ('Firewall blocks VPN', 'The firewall is blocking the VPN on the hostel network'),
                        ('Password stolen', 'Someone stole my password and logged into my email account')]:
        r = await report(api, f'{title} {time.time_ns()}', desc)
        assert r.status_code == 201, (title, r.text)


# ───────────── with AI ─────────────

@pytest.mark.anyio
async def test_ai_catches_what_keywords_miss(api):
    gemini_says('mental_health_crisis')
    r = await scope(api, 'My friend has been giving away his things and saying goodbye to everyone')
    assert r['in_scope'] is False and r['kind'] == 'mental_health_crisis' and r['source'] == 'ai'
    gemini_says('other_non_it')
    assert (await scope(api, 'The canteen guy overcharged me for chai'))['kind'] == 'other_non_it'


@pytest.mark.anyio
async def test_ai_cannot_override_a_crisis_detected_by_rules(api):
    calls = gemini_says('it')
    r = await scope(api, 'my roommate is suicidal and the wifi is down')
    assert r['kind'] == 'mental_health_crisis' and r['source'] == 'rules'
    assert calls == []                      # emergency answered instantly, no waiting for the AI


@pytest.mark.anyio
async def test_ai_can_clear_a_non_safety_rule_match(api):
    gemini_says('it')
    r = await scope(api, 'Mess food is terrible and the mess menu page shows yesterday')
    assert r['in_scope'] is True


@pytest.mark.anyio
@pytest.mark.parametrize('ai_scope', [None, 'banana', 42, ['it']])
async def test_missing_or_garbage_ai_scope_falls_back_to_rules(api, ai_scope):
    gemini_says(ai_scope)
    assert (await scope(api, 'There is a snake in the corridor'))['kind'] == 'pest_animal'
    assert (await scope(api, 'Printer jammed in the library'))['in_scope'] is True


@pytest.mark.anyio
async def test_ai_outage_falls_back_to_rules(api):
    gemini_says(fail=True)
    assert (await scope(api, 'Gas leak in the mess kitchen'))['kind'] == 'fire'
    assert (await scope(api, 'Mess food is terrible'))['kind'] == 'other_non_it'
    assert (await scope(api, 'Projector not turning on in LTC'))['in_scope'] is True


@pytest.mark.anyio
async def test_generate_details_with_ai_marking_non_it(api):
    gemini_says('medical_emergency', title='Medical Assistance Required')
    r = await api.post('/api/intelligence/generate-incident', json={'description': 'My friend twisted her ankle badly on the stairs'})
    body = r.json()
    assert body['scope']['kind'] == 'medical_emergency' and body['title'] != 'Medical Assistance Required'


@pytest.mark.anyio
async def test_rules_only_mode_never_calls_ai(api):
    calls = gemini_says('other_non_it')
    r = await scope(api, 'Mess menu', use_ai=False)
    assert calls == [] and r['source'] == 'rules'


@pytest.mark.anyio
async def test_scope_input_limits(api):
    assert (await api.post('/api/intelligence/scope', json={'description': 'x' * 6001})).status_code == 422
    assert (await scope(api, ''))['in_scope'] is True
