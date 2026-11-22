"""Account & security: authenticator app (two-step sign-in), backup codes,
password change/reset, sessions, profile, email preferences and admin controls."""
import itertools
import time

import pyotp
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.container import container
from app.core.db import db, init_db
from app.services import two_factor as tf
from app.services.notifications import Notification, SimulatedEmailChannel, SmtpEmailChannel

PASSWORD = 'Secret123'
_counter = itertools.count()


@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


@pytest.fixture(scope='module', autouse=True)
async def setup_db(anyio_backend):
    await init_db()
    yield
    await container.settings.update_settings({'require_admin_2fa': False})


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://test')


def bearer(token):
    return {'Authorization': f'Bearer {token}'}


async def new_student(ac):
    n = f"{time.time_ns() % 10**5:05d}{next(_counter)}"
    email = f'f2099{n}@hyderabad.bits-pilani.ac.in'
    r = await ac.post('/api/auth/register', json={'name': 'Security Tester', 'email': email, 'password': PASSWORD})
    assert r.status_code == 200, r.text
    return email, bearer(r.json()['access_token'])


def code(secret, steps_ahead=0):
    return pyotp.TOTP(secret).at(time.time() + 30 * steps_ahead)


async def turn_on_2fa(ac, h):
    setup = (await ac.post('/api/account/2fa/setup', headers=h)).json()
    secret = setup['secret'].replace(' ', '')
    r = await ac.post('/api/account/2fa/enable', headers=h, json={'code': code(secret)})
    assert r.status_code == 200, r.text
    return secret, r.json()['backup_codes']


# ───────────── unit ─────────────

def test_secret_is_encrypted_and_backup_codes_are_hashed():
    secret = tf.new_secret()
    stored = tf.encrypt_secret(secret)
    assert secret not in stored and tf.decrypt_secret(stored) == secret
    c = tf.new_backup_codes(1)[0]
    assert len(tf.normalise_backup_code(c)) == 10
    assert tf.hash_backup_code(c) == tf.hash_backup_code(c.upper().replace('-', ' ')) != c


def test_codes_from_the_neighbouring_30_seconds_are_accepted_but_not_older_ones():
    secret, now = tf.new_secret(), time.time()
    totp = pyotp.TOTP(secret)
    assert tf.matching_step(secret, totp.at(now), now) == int(now // 30)
    assert tf.matching_step(secret, totp.at(now - 30), now) is not None
    assert tf.matching_step(secret, totp.at(now - 120), now) is None
    assert tf.matching_step(secret, 'abcdef', now) is None


def test_email_preference_is_respected_except_for_security_alerts():
    off = {'id': 'u', 'email': 'a@b.c', 'email_notifications': False}
    resolved, security = Notification('t', 'm', 'resolved'), Notification('t', 'm', 'security')
    assert not SimulatedEmailChannel(None).supports(resolved, off)
    assert SimulatedEmailChannel(None).supports(security, off)
    assert SimulatedEmailChannel(None).supports(resolved, {**off, 'email_notifications': True})
    assert 'security' in SmtpEmailChannel.DEFAULT_KINDS


# ───────────── authenticator ─────────────

@pytest.mark.anyio
async def test_setup_shows_a_qr_code_and_needs_a_correct_first_code():
    async with client() as ac:
        _, h = await new_student(ac)
        r = await ac.post('/api/account/2fa/setup', headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body['qr_svg'].lstrip().startswith('<?xml') and '<svg' in body['qr_svg']
        assert body['otpauth_uri'].startswith('otpauth://totp/') and 'BITS%20reports' in body['otpauth_uri']
        r = await ac.post('/api/account/2fa/enable', headers=h, json={'code': '000000'})
        assert r.status_code == 422
        assert (await ac.get('/api/account', headers=h)).json()['two_factor']['enabled'] is False
        secret = body['secret'].replace(' ', '')
        r = await ac.post('/api/account/2fa/enable', headers=h, json={'code': code(secret)})
        assert r.status_code == 200 and len(r.json()['backup_codes']) == 8
        overview = (await ac.get('/api/account', headers=h)).json()
        assert overview['two_factor'] == {**overview['two_factor'], 'enabled': True, 'backup_codes_left': 8}
        assert (await ac.post('/api/account/2fa/setup', headers=h)).status_code == 409


@pytest.mark.anyio
async def test_sign_in_needs_the_code_once_2fa_is_on_and_codes_cannot_be_reused():
    async with client() as ac:
        email, h = await new_student(ac)
        secret, backups = await turn_on_2fa(ac, h)
        r = await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})
        assert r.status_code == 200 and r.json()['mfa_required'] is True and 'access_token' not in r.json()
        mfa = r.json()['mfa_token']
        assert (await ac.get('/api/auth/me', headers=bearer(mfa))).status_code == 401   # not a real session

        later = code(secret, 1)
        r = await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': later})
        assert r.status_code == 200, r.text
        assert (await ac.get('/api/auth/me', headers=bearer(r.json()['access_token']))).json()['email'] == email
        r = await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': later})
        assert r.status_code == 422, 'the same code must not work twice'

        r = await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': backups[0].upper()})
        assert r.status_code == 200 and r.json()['backup_codes_left'] == 7
        assert (await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': backups[0]})).status_code == 422

        methods = [e['method'] for e in (await ac.get('/api/account', headers=h)).json()['activity'] if e['event'] == 'login']
        assert {'authenticator', 'backup_code'} <= set(methods)


@pytest.mark.anyio
async def test_guessing_codes_is_blocked_after_five_wrong_tries():
    async with client() as ac:
        email, h = await new_student(ac)
        secret, _ = await turn_on_2fa(ac, h)
        mfa = (await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})).json()['mfa_token']
        for _ in range(5):
            assert (await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': '111111'})).status_code == 422
        r = await ac.post('/api/auth/login/2fa', json={'mfa_token': mfa, 'code': code(secret, 1)})
        assert r.status_code == 429


@pytest.mark.anyio
async def test_turning_off_and_new_backup_codes_need_a_valid_code():
    async with client() as ac:
        email, h = await new_student(ac)
        secret, old_backups = await turn_on_2fa(ac, h)
        assert (await ac.post('/api/account/2fa/backup-codes', headers=h, json={'code': '123456'})).status_code == 422
        r = await ac.post('/api/account/2fa/backup-codes', headers=h, json={'code': code(secret, 1)})
        assert r.status_code == 200 and set(r.json()['backup_codes']).isdisjoint(old_backups)
        new_backup = r.json()['backup_codes'][0]
        assert (await ac.post('/api/account/2fa/disable', headers=h, json={'code': old_backups[0]})).status_code == 422
        r = await ac.post('/api/account/2fa/disable', headers=h, json={'code': new_backup})
        assert r.status_code == 200 and r.json()['two_factor']['enabled'] is False
        r = await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})
        assert 'access_token' in r.json()


@pytest.mark.anyio
async def test_password_can_be_reset_with_the_authenticator_and_old_sessions_end():
    async with client() as ac:
        email, h = await new_student(ac)
        secret, _ = await turn_on_2fa(ac, h)
        r = await ac.post('/api/auth/password-reset/authenticator',
                          json={'email': email, 'code': '000000', 'password': 'NewSecret456'})
        assert r.status_code == 422
        r = await ac.post('/api/auth/password-reset/authenticator',
                          json={'email': 'nobody@example.com', 'code': '000000', 'password': 'NewSecret456'})
        assert r.status_code == 400
        r = await ac.post('/api/auth/password-reset/authenticator',
                          json={'email': email, 'code': code(secret, 1), 'password': 'NewSecret456'})
        assert r.status_code == 200, r.text
        assert (await ac.get('/api/auth/me', headers=h)).status_code == 401
        r = await ac.post('/api/auth/login', json={'email': email, 'password': 'NewSecret456'})
        assert r.json()['mfa_required'] is True


# ───────────── password, sessions, profile, preferences ─────────────

@pytest.mark.anyio
async def test_change_password_checks_the_current_one_and_signs_out_other_devices():
    async with client() as ac:
        email, h = await new_student(ac)
        other_device = bearer((await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})).json()['access_token'])
        r = await ac.post('/api/account/password', headers=h, json={'current_password': 'wrong-one1', 'new_password': 'Better789'})
        assert r.status_code == 422                          # wrong current password must not log the user out
        assert (await ac.post('/api/account/password', headers=h,
                              json={'current_password': PASSWORD, 'new_password': 'lettersonly'})).status_code == 422
        r = await ac.post('/api/account/password', headers=h, json={'current_password': PASSWORD, 'new_password': 'Better789'})
        assert r.status_code == 200
        assert (await ac.get('/api/auth/me', headers=bearer(r.json()['access_token']))).status_code == 200
        assert (await ac.get('/api/auth/me', headers=other_device)).status_code == 401
        assert (await ac.post('/api/auth/login', json={'email': email, 'password': 'Better789'})).status_code == 200
        notes = await db.notifications.find({'user_id': r.json()['user']['id'], 'kind': 'security'}).to_list(10)
        assert any(n['title'] == 'Password changed' for n in notes)


@pytest.mark.anyio
async def test_sign_out_other_devices_keeps_this_one():
    async with client() as ac:
        email, h = await new_student(ac)
        r = await ac.post('/api/account/sessions/sign-out-others', headers=h)
        assert r.status_code == 200
        assert (await ac.get('/api/auth/me', headers=h)).status_code == 401
        assert (await ac.get('/api/auth/me', headers=bearer(r.json()['access_token']))).status_code == 200


@pytest.mark.anyio
async def test_profile_and_preferences():
    async with client() as ac:
        _, h = await new_student(ac)
        assert (await ac.patch('/api/account/profile', headers=h, json={'phone': 'call me'})).status_code == 422
        r = await ac.patch('/api/account/profile', headers=h, json={'name': 'Renamed Tester', 'phone': '+91 98765 43210'})
        assert r.status_code == 200 and r.json()['user']['name'] == 'Renamed Tester'
        r = await ac.patch('/api/account/preferences', headers=h, json={'email_notifications': False})
        assert r.json()['preferences']['email_notifications'] is False
        overview = (await ac.get('/api/account', headers=h)).json()
        assert overview['preferences']['email_notifications'] is False and overview['password_set'] is True
        assert [e['event'] for e in overview['activity']][:2] == ['preferences_updated', 'profile_updated']
        assert all(e['at'].endswith('+00:00') for e in overview['activity']), 'times must carry their UTC offset'
        assert overview['created_at'].endswith('+00:00')


# ───────────── admin ─────────────

@pytest.mark.anyio
async def test_secrets_never_leave_the_server_and_admin_can_reset_2fa():
    async with client() as ac:
        email, h = await new_student(ac)
        await turn_on_2fa(ac, h)
        adm = bearer((await ac.post('/api/auth/login', json={'email': 'admin@example.com', 'password': 'ChangeMe@123'})).json()['access_token'])
        users = (await ac.get('/api/admin/users', headers=adm)).json()
        me = next(u for u in users if u['email'] == email)
        assert me['totp_enabled'] is True
        assert not {'totp_secret', 'backup_codes', 'password_hash', 'totp_last_step'} & set(me)
        assert (await ac.post(f"/api/admin/users/{me['id']}/reset-2fa", headers=h)).status_code == 403
        assert (await ac.post(f"/api/admin/users/{me['id']}/reset-2fa", headers=adm)).status_code == 200
        r = await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})
        assert 'access_token' in r.json()
        events = [e['event'] for e in (await ac.get('/api/account', headers=h)).json()['activity']]
        assert '2fa_reset_by_admin' in events


@pytest.mark.anyio
async def test_requiring_2fa_for_admins():
    async with client() as ac:
        seeded = bearer((await ac.post('/api/auth/login', json={'email': 'admin@example.com', 'password': 'ChangeMe@123'})).json()['access_token'])
        r = await ac.put('/api/admin/settings', headers=seeded, json={'require_admin_2fa': True})
        assert r.status_code == 422, 'an admin without 2FA must not lock themselves out'

        email = f'sec-admin-{time.time_ns()}@example.com'
        assert (await ac.post('/api/admin/users', headers=seeded, json={
            'name': 'Second Admin', 'email': email, 'password': PASSWORD, 'role': 'admin'})).status_code == 201
        second = bearer((await ac.post('/api/auth/login', json={'email': email, 'password': PASSWORD})).json()['access_token'])
        secret, _ = await turn_on_2fa(ac, second)
        try:
            assert (await ac.put('/api/admin/settings', headers=second, json={'require_admin_2fa': True})).status_code == 200
            r = await ac.get('/api/admin/users', headers=seeded)
            assert r.status_code == 403 and r.json().get('code') == '2fa_required'
            assert (await ac.get('/api/auth/me', headers=seeded)).json()['two_factor_required'] is True
            assert (await ac.get('/api/admin/users', headers=second)).status_code == 200
            r = await ac.post('/api/account/2fa/disable', headers=second, json={'code': code(secret, 1)})
            assert r.status_code == 403
        finally:
            await container.settings.update_settings({'require_admin_2fa': False})
        assert (await ac.get('/api/admin/users', headers=seeded)).status_code == 200
