"""Account & security: the signed-in user's own profile, password, authenticator
app (two-factor sign-in), backup codes, email preferences, sessions and
recent security activity."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response

from app.core.container import container
from app.core.db import db
from app.core.security import get_current_user_doc, hash_password, verify_password, public_user
from app.domain.enums import Role
from app.domain.exceptions import (InvalidInputError, InvalidCodeError, AlreadyExistsError,
                                   UnauthorizedOperationError)
from app.domain.appearance import Appearance
from app.models.schemas import (ProfileUpdate, PasswordChange, CodeInput, PreferencesUpdate, AppearanceUpdate, PHONE_PATTERN,
                                clean_doc)
from app.routers.auth import issue
from app.services import two_factor as tf
from app.services.notifications import Notification

router = APIRouter(prefix='/account', tags=['account'])

EVENT_LABELS = {
    'login': 'Signed in', 'login_failed': 'Wrong password entered', '2fa_failed': 'Wrong authenticator code entered',
    'password_changed': 'Password changed', 'password_reset': 'Password reset', 'account_created': 'Account created',
    '2fa_enabled': 'Authenticator app turned on', '2fa_disabled': 'Authenticator app turned off',
    '2fa_reset_by_admin': 'Authenticator reset by an administrator', 'backup_codes_regenerated': 'New backup codes created',
    'signed_out_everywhere': 'Signed out of all other devices', 'profile_updated': 'Profile updated',
    'preferences_updated': 'Email preferences changed',
}
METHOD_LABELS = {'password': 'password', 'google': 'Google', 'authenticator': 'authenticator app',
                 'backup_code': 'backup code', 'email_code': 'email code'}


def _fresh_session(response: Response, user: dict) -> dict:
    """New token for this device after the account's token version changed."""
    return issue(response, user)


async def _reload(user):
    return await db.users.find_one({'_id': user['_id']})


async def _security_alert(user, title, message):
    """In-app + email alert for important account changes (sent even if email notifications are off)."""
    await container.dispatcher.notify(
        [{'id': str(user['_id']), 'email': user.get('email'), 'name': user.get('name')}],
        Notification(title, message, 'security', email_subject=f'BITS reports: {title.lower()}',
                     email_body=(f"Hello {user.get('name') or ''},\n\n{message}\n\nIf this wasn't you, reset your "
                                 'password and contact the IT help desk.\n\nBITS reports IT Support')))


def _iso_utc(value):
    """MongoDB returns dates without a time zone (they are UTC). Say so explicitly,
    otherwise the browser reads them as local time (5½ hours off in India)."""
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return value


def _event_view(e):
    d = clean_doc({**e, 'at': _iso_utc(e.get('at'))})
    d['label'] = EVENT_LABELS.get(e.get('event'), e.get('event'))
    d['method_label'] = METHOD_LABELS.get(e.get('method'))
    return d


def _two_factor_view(u):
    return {'enabled': bool(u.get('totp_enabled')), 'enabled_at': u.get('totp_enabled_at'),
            'backup_codes_left': tf.TwoFactorService.backup_codes_left(u) if u.get('totp_enabled') else 0}


async def _required_for(u) -> bool:
    settings = await container.settings.get_settings()
    return u.get('role') == Role.ADMIN.value and bool(settings.get('require_admin_2fa'))


# ───────────── overview ─────────────
@router.get('')
async def overview(u=Depends(get_current_user_doc)):
    created = u.get('created_at') or (u['_id'].generation_time if hasattr(u['_id'], 'generation_time') else None)
    return {
        'user': public_user(u),
        'created_at': _iso_utc(created),
        'google_linked': bool(u.get('google_linked')),
        'password_set': u.get('password_set', True) is not False,
        'two_factor': {**_two_factor_view(u), 'required': await _required_for(u)},
        'preferences': {'email_notifications': u.get('email_notifications', True) is not False},
        'activity': [_event_view(e) for e in await container.security_log.recent(str(u['_id']), limit=20)],
    }


# ───────────── profile ─────────────
@router.patch('/profile')
async def update_profile(data: ProfileUpdate, request: Request, u=Depends(get_current_user_doc)):
    changes = {}
    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise InvalidInputError('Name cannot be empty')
        if u.get('google_linked') and name != u.get('name'):
            raise InvalidInputError('Your name comes from your Google account. Change it there and sign in again.')
        changes['name'] = name
    if data.phone is not None:
        phone = data.phone.strip()
        if phone and not re.fullmatch(PHONE_PATTERN, phone):
            raise InvalidInputError('Enter a phone number with 7–20 digits, e.g. +91 98765 43210')
        changes['phone'] = phone or None
    changes = {k: v for k, v in changes.items() if v != u.get(k)}
    if changes:
        await db.users.update_one({'_id': u['_id']}, {'$set': changes})
        await container.security_log.record(u, 'profile_updated', request=request, detail=', '.join(sorted(changes)))
    return {'user': public_user(await _reload(u))}


# ───────────── password ─────────────
@router.post('/password')
async def change_password(data: PasswordChange, request: Request, response: Response,
                          u=Depends(get_current_user_doc)):
    has_password = u.get('password_set', True) is not False
    if has_password:
        if not data.current_password or not verify_password(data.current_password, u['password_hash']):
            # 422, not 401: a wrong *current* password must not sign the user out.
            raise InvalidInputError('Your current password is not correct')
        if verify_password(data.new_password, u['password_hash']):
            raise InvalidInputError('The new password must be different from the current one')
    if not (re.search(r'[A-Za-z]', data.new_password) and re.search(r'\d', data.new_password)):
        raise InvalidInputError('Use at least 8 characters with both letters and numbers')
    await db.users.update_one({'_id': u['_id']}, {'$set': {'password_hash': hash_password(data.new_password),
                                                           'password_set': True},
                                                  '$inc': {'token_version': 1}})
    await container.security_log.record(u, 'password_changed', request=request)
    await _security_alert(u, 'Password changed', 'The password for your BITS reports account was just '
                                                 'changed. Other devices have been signed out.')
    return _fresh_session(response, await _reload(u))


# ───────────── authenticator app ─────────────
@router.post('/2fa/setup')
async def start_two_factor_setup(u=Depends(get_current_user_doc)):
    """Step 1: a new secret, shown as a QR code. Nothing changes until it is confirmed."""
    if u.get('totp_enabled'):
        raise AlreadyExistsError('The authenticator app is already on. Turn it off first to connect a new phone.')
    secret = tf.new_secret()
    await db.users.update_one({'_id': u['_id']}, {'$set': {'totp_pending_secret': tf.encrypt_secret(secret)}})
    uri = tf.provisioning_uri(secret, u['email'])
    return {'secret': ' '.join(secret[i:i + 4] for i in range(0, len(secret), 4)), 'otpauth_uri': uri,
            'qr_svg': tf.qr_svg(uri), 'issuer': tf.ISSUER, 'account': u['email']}


@router.post('/2fa/enable')
async def enable_two_factor(data: CodeInput, request: Request, u=Depends(get_current_user_doc)):
    """Step 2: the first code from the app proves it was set up correctly."""
    if u.get('totp_enabled'):
        raise AlreadyExistsError('The authenticator app is already on.')
    if not u.get('totp_pending_secret'):
        raise InvalidInputError('Start the setup again: no QR code is waiting to be confirmed.')
    secret = tf.decrypt_secret(u['totp_pending_secret'])
    step = tf.matching_step(secret, data.code)
    if step is None:
        raise InvalidCodeError('That code does not match. Type the 6-digit code currently shown in the app '
                               '(and check that the phone’s time is set automatically).')
    codes = tf.new_backup_codes()
    await db.users.update_one({'_id': u['_id']}, {
        '$set': {'totp_secret': u['totp_pending_secret'], 'totp_enabled': True, 'totp_last_step': step,
                 'totp_enabled_at': datetime.now(timezone.utc).isoformat(),
                 'backup_codes': [tf.hash_backup_code(c) for c in codes]},
        '$unset': {'totp_pending_secret': ''}})
    await container.security_log.record(u, '2fa_enabled', request=request)
    await _security_alert(u, 'Authenticator app turned on', 'Two-step sign-in is now on: after your password '
                                                            'you will be asked for a code from your authenticator app.')
    return {'backup_codes': codes, 'two_factor': _two_factor_view(await _reload(u))}


@router.post('/2fa/disable')
async def disable_two_factor(data: CodeInput, request: Request, u=Depends(get_current_user_doc)):
    if not u.get('totp_enabled'):
        raise InvalidInputError('The authenticator app is not on.')
    if await _required_for(u):
        raise UnauthorizedOperationError('Administrators are required to use an authenticator app. '
                                         'Another administrator can reset it if you are moving to a new phone.')
    method = await container.two_factor.verify(u, data.code, request=request)
    await db.users.update_one({'_id': u['_id']}, {'$set': {'totp_enabled': False},
                                                  '$unset': {'totp_secret': '', 'backup_codes': '',
                                                             'totp_last_step': '', 'totp_enabled_at': ''}})
    await container.security_log.record(u, '2fa_disabled', request=request, method=method)
    await _security_alert(u, 'Authenticator app turned off', 'Two-step sign-in was turned off for your account. '
                                                             'Only your password is now needed to sign in.')
    return {'two_factor': _two_factor_view(await _reload(u))}


@router.post('/2fa/backup-codes')
async def regenerate_backup_codes(data: CodeInput, request: Request, u=Depends(get_current_user_doc)):
    if not u.get('totp_enabled'):
        raise InvalidInputError('Turn on the authenticator app first.')
    await container.two_factor.verify(u, data.code, request=request, allow={'authenticator'})
    codes = tf.new_backup_codes()
    await db.users.update_one({'_id': u['_id']}, {'$set': {'backup_codes': [tf.hash_backup_code(c) for c in codes]}})
    await container.security_log.record(u, 'backup_codes_regenerated', request=request)
    return {'backup_codes': codes, 'two_factor': _two_factor_view(await _reload(u))}


# ───────────── preferences & sessions ─────────────
@router.patch('/preferences')
async def update_preferences(data: PreferencesUpdate, request: Request, u=Depends(get_current_user_doc)):
    changes = data.model_dump(exclude_none=True)
    if changes:
        await db.users.update_one({'_id': u['_id']}, {'$set': changes})
        await container.security_log.record(u, 'preferences_updated', request=request,
                                            detail=', '.join(f'{k}={v}' for k, v in changes.items()))
    fresh = await _reload(u)
    return {'preferences': {'email_notifications': fresh.get('email_notifications', True) is not False}}


@router.put('/appearance')
async def save_appearance(data: AppearanceUpdate, u=Depends(get_current_user_doc)):
    """The look for this account (Original, Indigo, AMOLED, Dark, Greenboard, Light or a gradient, plus saved
    gradients), so it follows the person to every device. Not a security event, so it is
    not written to the activity log."""
    doc = data.model_dump(exclude_none=True)
    saved = u.get('appearance') or {}
    # Each app sends only its own fields; keep the other app's choice instead of wiping it.
    for key in ('glass_theme', 'glass_prefs'):
        if key not in doc and saved.get(key):
            doc[key] = saved[key]
    if 'gradient' not in doc and saved.get('gradient'):
        doc['gradient'] = saved['gradient']
    if not data.saved_gradients and saved.get('saved_gradients') and 'glass_theme' in data.model_fields_set:
        doc['saved_gradients'] = saved['saved_gradients']
    appearance = Appearance.from_doc(doc)
    await db.users.update_one({'_id': u['_id']}, {'$set': {'appearance': appearance.to_dict()}})
    return {'appearance': appearance.to_dict()}


@router.post('/sessions/sign-out-others')
async def sign_out_other_devices(request: Request, response: Response, u=Depends(get_current_user_doc)):
    """Invalidate every token issued so far, then give this device a new one."""
    await db.users.update_one({'_id': u['_id']}, {'$inc': {'token_version': 1}})
    await container.security_log.record(u, 'signed_out_everywhere', request=request)
    return _fresh_session(response, await _reload(u))
