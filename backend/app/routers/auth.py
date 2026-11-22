import asyncio, logging, os, re, secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from app.core.db import db
from app.core.security import (
    create_access_token, create_refresh_token, create_mfa_token, hash_password,
    verify_password, public_user, get_current_user, load_user_from_token
)
from app.models.schemas import (
    RegisterRequest, LoginRequest, GoogleAuthRequest, PasswordResetRequest,
    PasswordResetConfirm, TwoFactorLoginRequest, AuthenticatorResetRequest,
)
from app.core.container import container
from app.domain.models import UserFactory
from app.domain.exceptions import AuthenticationError, ExternalServiceError, AlreadyExistsError, InvalidInputError
from app.services.notifications import SmtpEmailAdapter
from app.domain.enums import Role
from app.services.email import send_email
from app.core.logging_config import log_exception

router = APIRouter(prefix='/auth', tags=['auth'])
logger = logging.getLogger(__name__)
BITS_EMAIL_DOMAIN = os.getenv('ALLOWED_EMAIL_DOMAIN', 'hyderabad.bits-pilani.ac.in').lower().lstrip('@')

def extract_student_id(email: str) -> str:
    """Extracts numeric student ID from BITS email (e.g. f20250051@hyderabad.bits-pilani.ac.in -> 20250051)."""
    prefix = email.split('@')[0].strip()
    match = re.search(r'\d{6,10}', prefix)
    if match:
        return match.group(0)
    cleaned = re.sub(r'^[a-zA-Z]+', '', prefix)
    return cleaned if cleaned else prefix

email_sender = SmtpEmailAdapter()


async def _send_reset_email(recipient: str, code: str):
    """Send the one-time reset code through the email adapter."""
    await email_sender.send(
        recipient,
        'BITS reports password reset code',
        f'Your BITS reports password reset code is: {code}\n\n'
        'It expires in 10 minutes. If you did not request this, you can ignore this email.',
    )

def issue(response: Response, user: dict):
    tv = user.get('token_version', 0)
    a = create_access_token(str(user['_id']), user['email'], user['role'], tv)
    r = create_refresh_token(str(user['_id']), tv)
    secure = os.getenv('COOKIE_SECURE', 'false').lower() == 'true'
    response.set_cookie('access_token', a, httponly=True, samesite='lax', secure=secure, max_age=43200)
    response.set_cookie('refresh_token', r, httponly=True, samesite='lax', secure=secure, max_age=604800)
    return {'access_token': a, 'token_type': 'bearer', 'user': public_user(user)}

@router.post('/register')
async def register(data: RegisterRequest, request: Request, response: Response):
    email = data.email.strip().lower()
    if not email.endswith('@' + BITS_EMAIL_DOMAIN):
        raise HTTPException(
            400,
            f"Students must use their official BITS Pilani Hyderabad email (@{BITS_EMAIL_DOMAIN})"
        )
    if await db.users.find_one({'email': email}):
        raise AlreadyExistsError('This BITS email is already registered. Please sign in.')

    student_id = extract_student_id(email)
    # Factory pattern: the domain decides which User subclass a role maps to.
    user_doc = UserFactory.create(Role.CUSTOMER, name=data.name, email=email, phone=data.phone,
                                  student_id=student_id).to_doc(hash_password(data.password))

    res = await db.users.insert_one(user_doc)
    created = await db.users.find_one({'_id': res.inserted_id})
    await container.security_log.record(created, 'account_created', request=request, method='password')
    return issue(response, created)

@router.post('/login')
async def login(data: LoginRequest, request: Request, response: Response):
    email = data.email.strip().lower()
    u = await db.users.find_one({'email': email})
    if not u or not verify_password(data.password, u['password_hash']):
        if u:
            await container.security_log.record(u, 'login_failed', request=request, method='password')
        raise AuthenticationError('Invalid email or password')
    if not u.get('is_active', True):
        raise HTTPException(403, 'Account deactivated. Please contact campus admin.')
    if u.get('totp_enabled'):
        # Step 1 of 2: the password was right; now the authenticator code is needed.
        return {'mfa_required': True, 'mfa_token': create_mfa_token(str(u['_id']), u.get('token_version', 0)),
                'methods': ['authenticator', 'backup_code']}
    await container.security_log.record(u, 'login', request=request, method='password')
    return issue(response, u)


@router.post('/login/2fa')
async def login_second_step(data: TwoFactorLoginRequest, request: Request, response: Response):
    """Step 2 of 2: check the authenticator (or backup) code and sign the user in."""
    try:
        u = await load_user_from_token(data.mfa_token, 'mfa')
    except HTTPException:
        raise HTTPException(401, 'Sign-in took too long or was interrupted. Enter your password again.')
    method = await container.two_factor.verify(u, data.code, request=request)
    u = await db.users.find_one({'_id': u['_id']})
    await container.security_log.record(u, 'login', request=request, method=method)
    result = issue(response, u)
    result['backup_codes_left'] = container.two_factor.backup_codes_left(u)
    return result

@router.post('/password-reset/request')
async def request_password_reset(data: PasswordResetRequest):
    """Email a six-digit, single-use code to an active, registered account."""
    email = data.email.strip().lower()
    generic = {'message': f'If {email} is registered, a six-digit reset code has been sent. It expires in 10 minutes.'}
    user = await db.users.find_one({'email': email})
    # Respond identically for unknown/deactivated accounts so the endpoint
    # cannot be used to discover which email addresses are registered.
    if not user or not user.get('is_active', True):
        return generic

    now = datetime.now(timezone.utc)
    hourly_requests = await db.password_reset_requests.count_documents({
        'email': email, 'created_at': {'$gte': now - timedelta(hours=1)}
    })
    if hourly_requests >= 3:
        raise HTTPException(429, 'Too many reset codes requested. Please try again in an hour.')

    code = f'{secrets.randbelow(1_000_000):06d}'
    try:
        await _send_reset_email(email, code)
    except Exception as exc:
        log_exception(logger, 'Password-reset email could not be sent', exc, with_traceback=False,
                      Recipient=email, Effect='The user did not receive a reset code (they were shown a 503 error).')
        raise ExternalServiceError('Password-reset email is not configured or could not be sent.')

    await db.password_resets.delete_many({'email': email})
    await db.password_resets.insert_one({
        'email': email,
        'code_hash': hash_password(code),
        'created_at': now,
        'expires_at': now + timedelta(minutes=10),
        'attempts': 0,
    })
    await db.password_reset_requests.insert_one({
        'email': email,
        'created_at': now,
        'expires_at': now + timedelta(hours=1),
    })
    return generic

@router.post('/password-reset/confirm')
async def confirm_password_reset(data: PasswordResetConfirm, request: Request):
    email = data.email.strip().lower()
    now = datetime.now(timezone.utc)
    reset = await db.password_resets.find_one(
        {'email': email, 'expires_at': {'$gt': now}}, sort=[('created_at', -1)]
    )
    if not reset or reset.get('attempts', 0) >= 5 or not verify_password(data.code, reset['code_hash']):
        if reset:
            await db.password_resets.update_one({'_id': reset['_id']}, {'$inc': {'attempts': 1}})
        raise HTTPException(400, 'That reset code is invalid or has expired.')

    result = await db.users.update_one({'email': email}, {'$set': {'password_hash': hash_password(data.password),
                                                                   'password_set': True},
                                                          '$inc': {'token_version': 1}})
    if not result.matched_count:
        raise HTTPException(400, 'That reset code is invalid or has expired.')
    await db.password_resets.delete_many({'email': email})
    await container.security_log.record(await db.users.find_one({'email': email}), 'password_reset',
                                        request=request, method='email_code')
    return {'message': 'Password updated. You can now sign in.'}


@router.post('/password-reset/authenticator')
async def reset_with_authenticator(data: AuthenticatorResetRequest, request: Request):
    """Reset a forgotten password with a code from the authenticator app (no email needed)."""
    email = data.email.strip().lower()
    user = await db.users.find_one({'email': email})
    if not user or not user.get('is_active', True) or not user.get('totp_enabled'):
        # Same answer whether or not the account exists or has an authenticator.
        raise HTTPException(400, 'The email or the authenticator code is not correct.')
    method = await container.two_factor.verify(user, data.code, request=request)
    await db.users.update_one({'_id': user['_id']}, {'$set': {'password_hash': hash_password(data.password),
                                                              'password_set': True},
                                                     '$inc': {'token_version': 1}})
    await db.password_resets.delete_many({'email': email})
    await container.security_log.record(user, 'password_reset', request=request, method=method)
    return {'message': 'Password updated. You can now sign in.'}

@router.post('/google')
async def google_auth(data: GoogleAuthRequest, request: Request, response: Response):
    """Verify a Google ID token server-side; never trust browser profile fields."""
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    if not client_id:
        raise HTTPException(503, 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.')
    if not data.credential:
        raise HTTPException(400, 'Google credential is required')
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        decoded = id_token.verify_oauth2_token(data.credential, google_requests.Request(), client_id)
    except Exception as exc:
        # Do not log the credential; the exception is enough to diagnose setup issues.
        log_exception(logger, 'Google sign-in rejected: the ID token could not be verified', exc, level=logging.WARNING,
                      with_traceback=False,
                      **{'Likely cause': 'GOOGLE_CLIENT_ID in backend/.env differs from REACT_APP_GOOGLE_CLIENT_ID in '
                                         'frontend/.env, the token expired, or the computer clock is wrong.'})
        raise HTTPException(401, 'Google identity could not be verified')
    if decoded.get('iss') not in ('accounts.google.com', 'https://accounts.google.com') or not decoded.get('email_verified'):
        raise HTTPException(401, 'A verified Google email is required')
    # The redirect sign-in flow sends the nonce it gave Google; a token minted for a
    # different sign-in attempt (e.g. one copied from another browser) is rejected.
    if data.nonce and not secrets.compare_digest(str(decoded.get('nonce', '')), data.nonce):
        raise HTTPException(401, 'Google sign-in could not be confirmed. Please try again.')
    email = decoded.get('email', '').strip().lower()
    name = decoded.get('name', '').strip()
    if not email or not email.endswith('@' + BITS_EMAIL_DOMAIN):
        raise HTTPException(403, f'Only @{BITS_EMAIL_DOMAIN} Google Workspace accounts are allowed')

    u = await db.users.find_one({'email': email})
    if u:
        if not u.get('is_active', True):
            raise HTTPException(403, 'Account is deactivated')
        # Google is the profile source: retain only its verified email and displayed name.
        update_fields = {} if u.get('google_linked') else {'google_linked': True}
        if name and u.get('name') != name:
            update_fields['name'] = name
        if not u.get('student_id'):
            update_fields['student_id'] = extract_student_id(email)
        if update_fields:
            await db.users.update_one({'_id': u['_id']}, {'$set': update_fields})
            u = await db.users.find_one({'_id': u['_id']})
        await container.security_log.record(u, 'login', request=request, method='google')
        return issue(response, u)

    student_id = extract_student_id(email)
    # Google-only accounts get an unguessable random password so nobody can
    # sign in to them through the email/password form.
    dummy_pwd = hash_password(secrets.token_urlsafe(32))
    new_user = UserFactory.create(Role.CUSTOMER, name=name or f"BITS Student {student_id}", email=email,
                                  student_id=student_id).to_doc(dummy_pwd)
    new_user.update({'google_linked': True, 'password_set': False})

    res = await db.users.insert_one(new_user)
    created = await db.users.find_one({'_id': res.inserted_id})
    await container.security_log.record(created, 'login', request=request, method='google')
    return issue(response, created)

@router.post('/logout')
async def logout(response: Response):
    response.delete_cookie('access_token')
    response.delete_cookie('refresh_token')
    return {'ok': True}

@router.get('/me')
async def me(user=Depends(get_current_user)):
    settings = await container.settings.get_settings()
    return {**user, 'two_factor_required': user['role'] == Role.ADMIN.value and bool(settings.get('require_admin_2fa'))}
