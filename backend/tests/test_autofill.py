"""Autofill of issue type (category) and service on the report form — keyword rules, no AI."""
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.db import init_db
from app.services.intelligence import IntelligenceService

intel = IntelligenceService(db=None)
IT_CATS = ['Hardware', 'Software', 'Network', 'Database', 'Cloud', 'Security', 'Authentication', 'Application', 'Storage']
HOSTEL_CATS = ['Carpenter Needed', 'Electrician Needed', 'Technician Needed']
IT_SERVICES = ['Payment Gateway', 'Identity Provider (SSO)', 'Customer Database', 'Email Service', 'Corporate VPN',
               'Cloud Storage', 'HR Portal', 'Office Wi-Fi']


def top(text, cats=IT_CATS, services=IT_SERVICES):
    r = intel.suggest('', text, cats, services)
    return (r['categories'][0]['name'] if r['categories'] else None,
            r['services'][0]['name'] if r['services'] else None)


@pytest.mark.parametrize('text,category,service', [
    ('Wi-Fi keeps disconnecting in my room', 'Network', 'Office Wi-Fi'),
    ('wifi nahi chal raha hostel me', 'Network', 'Office Wi-Fi'),
    ("Can't log in to ERP, the password reset OTP is not coming", 'Authentication', 'Identity Provider (SSO)'),
    ('Locked out of my LMS account after MFA change', 'Authentication', 'Identity Provider (SSO)'),
    ('Firewall is blocking the VPN connection', 'Network', 'Corporate VPN'),
    ('Fee payment failed but money was debited', 'Application', 'Payment Gateway'),
    ('Google Drive storage quota full, cannot upload files', 'Storage', 'Cloud Storage'),
    ('Phishing email asking for my password', 'Security', 'Email Service'),
    ('MATLAB licence expired, cannot install the update', 'Software', None),
    ('Lab monitor and keyboard not working', 'Hardware', None),
])
def test_it_issues(text, category, service):
    assert top(text) == (category, service)


@pytest.mark.parametrize('text,category', [
    ('Fan not working in room 204', 'Electrician Needed'),
    ('Tube light flickering and switch board sparks', 'Electrician Needed'),
    ('Bed is broken and the door lock is jammed', 'Carpenter Needed'),
    ('Cupboard hinge came off', 'Carpenter Needed'),
    ('Geyser is leaking water', 'Technician Needed'),
    ('Water cooler on 2nd floor not cooling', 'Technician Needed'),
])
def test_hostel_repairs_only_suggest_repair_categories(text, category):
    assert top(text, HOSTEL_CATS, []) == (category, None)


def test_never_suggests_options_the_form_does_not_offer():
    assert top('Fan not working in my room') == (None, None)                     # online mode: no repair categories
    assert top('Wi-Fi down in hostel', HOSTEL_CATS, []) == (None, None)          # hostel mode: no IT categories
    assert intel.suggest('', 'wifi down', ['Network'], ['Some Custom Service'])['services'] == []
    assert intel.suggest('', 'wifi down', ['Made Up Category'], [])['categories'] == []


@pytest.mark.parametrize('text', ['', '   ', 'asdkjh qwe zxcmn', '!!!! ????', '12345', '😭😭😭'])
def test_nothing_to_suggest(text):
    assert top(text) == (None, None)


def test_whole_words_only_and_ranking():
    assert top('build failed')[0] is None                     # 'ui' inside 'build' must not count
    r = intel.suggest('', 'wifi router down, internet and network gone, also printer', IT_CATS, IT_SERVICES)
    assert r['categories'][0]['name'] == 'Network' and r['categories'][0]['score'] >= 3
    assert len(r['categories']) <= 3 and len(r['services']) <= 3


def test_title_counts_too_and_long_text_is_fine():
    assert intel.suggest('VPN broken', '', IT_CATS, IT_SERVICES)['services'][0]['name'] == 'Corporate VPN'
    assert top('wifi ' * 5000)[0] == 'Network'


@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_suggest_endpoint(anyio_backend):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as ac:
        r = await ac.post('/api/auth/login', json={'email': 'emma@example.com', 'password': 'Customer@1234'})
        h = {'Authorization': f"Bearer {r.json()['access_token']}"}
        r = await ac.post('/api/intelligence/suggest', headers=h, json={'title': 'Projector', 'description': 'no HDMI signal',
                                                                       'categories': ['Hardware', 'Technician Needed']})
        assert r.status_code == 200 and {c['name'] for c in r.json()['categories']} == {'Hardware', 'Technician Needed'}
        r = await ac.post('/api/intelligence/suggest', headers=h, json={'description': 'vpn down'})
        assert r.json()['services'][0]['name'] == 'Corporate VPN'
        assert (await ac.post('/api/intelligence/suggest', headers=h, json={'description': 'x' * 6001})).status_code == 422
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as anonymous:
        assert (await anonymous.post('/api/intelligence/suggest', json={'description': 'vpn'})).status_code == 401
