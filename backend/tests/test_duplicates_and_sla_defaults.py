"""Duplicate detection that understands different wordings, and the SLA
defaults from the project brief (P1 5 min/30 min … P4 4 h/24 h)."""
import time
from datetime import timedelta

import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.db import db, init_db
from app.domain.sla import build_sla, evaluate_sla, utcnow
from app.services.intelligence import DuplicateDetector, concepts
from app.services.seed import seed_all, DEFAULT_SLA_TARGETS, OLD_DEFAULT_SLA_TARGETS

SVC = 'payment-svc'
INC101 = {'_id': '1', 'number': 'INC101', 'title': 'Payment application unavailable', 'status': 'CLASSIFIED',
          'priority': 'P1', 'service_id': SVC,
          'description': 'The payment application is unavailable and users are unable to complete transactions.'}


# ───────────── duplicate detection (unit) ─────────────

def test_concepts_merge_different_wordings_of_a_failure():
    assert concepts('Unable to make payment') == {'payment', 'failure'}
    assert concepts('Payment transaction failing') == {'payment', 'failure'}
    assert concepts('Wi-Fi not working') == concepts('wifi is down') == {'wifi', 'failure'}


@pytest.mark.parametrize('title, description', [
    ('Payment transaction failing', 'Payment transactions keep failing for everyone'),
    ('Unable to make payment', 'I am unable to make a payment on the portal'),
])
def test_brief_examples_are_flagged_as_duplicates(title, description):
    found = DuplicateDetector().find(title, description, SVC, [INC101])
    assert [d['number'] for d in found] == ['INC101']


@pytest.mark.parametrize('title, description, service', [
    ('Printer not working', 'The printer in room 204 is not working', SVC),       # same service, different problem
    ('Laptop battery not charging', 'My laptop battery does not charge anymore', 'other'),
    ('Email not syncing', 'Outlook inbox does not update', SVC),
])
def test_unrelated_reports_are_not_flagged(title, description, service):
    assert DuplicateDetector().find(title, description, service, [INC101]) == []


def test_saying_something_is_broken_is_not_enough_to_match():
    printer = {**INC101, 'title': 'Printer not working', 'description': 'Printer in the lab is not printing'}
    assert DuplicateDetector().find('Laptop not working', 'Laptop does not turn on', SVC, [printer]) == []


# ───────────── duplicate detection (API) ─────────────

@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


async def _login(ac, email, password):
    r = await ac.post('/api/auth/login', json={'email': email, 'password': password})
    assert r.status_code == 200, r.text
    return {'Authorization': f"Bearer {r.json()['access_token']}"}


@pytest.mark.anyio
async def test_api_warns_about_a_differently_worded_duplicate(anyio_backend):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
        h = await _login(ac, 'emma@example.com', 'Customer@1234')
        services = (await ac.get('/api/catalog/services', headers=h)).json()
        payment = next(s['id'] for s in services if s['name'] == 'Payment Gateway')
        tag = time.time_ns()     # keeps reruns independent
        body = {'category': 'Application', 'service_id': payment, 'impact': 2, 'urgency': 2, 'location_type': 'online'}
        first = await ac.post('/api/incidents', headers=h, json={
            **body, 'title': f'Payment application unavailable {tag}',
            'description': f'The payment application is unavailable, transactions do not complete ({tag}).',
            'acknowledge_duplicate': True})
        assert first.status_code == 201, first.text
        second = await ac.post('/api/incidents', headers=h, json={
            **body, 'title': 'Unable to make payment', 'description': 'I am unable to make a payment, it keeps failing.'})
        assert second.status_code == 409, second.text
        assert first.json()['number'] in second.text


# ───────────── SLA defaults ─────────────

@pytest.mark.anyio
async def test_default_sla_targets_follow_the_brief(anyio_backend):
    await init_db()
    assert DEFAULT_SLA_TARGETS == {'P1': (5, 30), 'P2': (15, 120), 'P3': (60, 480), 'P4': (240, 1440)}
    for priority, (response, resolution) in DEFAULT_SLA_TARGETS.items():
        doc = await db.sla_policies.find_one({'priority': priority, 'service_id': None})
        assert (doc['response_minutes'], doc['resolution_minutes']) == (response, resolution)


@pytest.mark.anyio
async def test_old_defaults_are_upgraded_but_admin_edits_are_kept(anyio_backend):
    await init_db()
    old_r, old_rs = OLD_DEFAULT_SLA_TARGETS['P2']
    await db.sla_policies.update_one({'priority': 'P2', 'service_id': None},
                                     {'$set': {'response_minutes': old_r, 'resolution_minutes': old_rs}})
    await db.sla_policies.update_one({'priority': 'P3', 'service_id': None},
                                     {'$set': {'response_minutes': 45, 'resolution_minutes': 300}})   # admin's choice
    try:
        await seed_all(db)
        p2 = await db.sla_policies.find_one({'priority': 'P2', 'service_id': None})
        p3 = await db.sla_policies.find_one({'priority': 'P3', 'service_id': None})
        assert (p2['response_minutes'], p2['resolution_minutes']) == DEFAULT_SLA_TARGETS['P2']
        assert (p3['response_minutes'], p3['resolution_minutes']) == (45, 300)
    finally:
        r, rs = DEFAULT_SLA_TARGETS['P3']
        await db.sla_policies.update_one({'priority': 'P3', 'service_id': None},
                                         {'$set': {'response_minutes': r, 'resolution_minutes': rs}})


def test_a_new_p1_is_on_track_and_warns_in_its_last_quarter():
    created = utcnow()
    sla = build_sla({'name': 'Default P1', 'response_minutes': 5, 'resolution_minutes': 30}, created)
    sla['responded_at'] = (created + timedelta(minutes=2)).isoformat()
    assert evaluate_sla(sla, created + timedelta(minutes=1))['status'] == 'ON_TRACK'
    assert evaluate_sla(sla, created + timedelta(minutes=22))['status'] == 'ON_TRACK'    # 8 min left
    assert evaluate_sla(sla, created + timedelta(minutes=23))['status'] == 'AT_RISK'     # 7 min left (< 7.5)
    assert evaluate_sla(sla, created + timedelta(minutes=30))['status'] == 'BREACHED'
