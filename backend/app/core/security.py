import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from bson import ObjectId
from fastapi import Depends, HTTPException, Request

from app.core.db import db
from app.domain.exceptions import UnauthorizedOperationError
from app.domain.appearance import Appearance

ALG = 'HS256'
MFA_TOKEN_MINUTES = 5


def hash_password(p): return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def verify_password(p, h): return bcrypt.checkpw(p.encode(), h.encode())


def _encode(payload): return jwt.encode(payload, os.environ['JWT_SECRET'], algorithm=ALG)


def create_access_token(uid, email, role, token_version=0):
    # `tv` (token version) lets the user sign out every other device: bumping
    # the version stored on the account invalidates all older tokens at once.
    return _encode({'sub': uid, 'email': email, 'role': role, 'type': 'access', 'tv': int(token_version or 0),
                    'exp': datetime.now(timezone.utc) + timedelta(hours=12)})


def create_refresh_token(uid, token_version=0):
    return _encode({'sub': uid, 'type': 'refresh', 'tv': int(token_version or 0),
                    'exp': datetime.now(timezone.utc) + timedelta(days=7)})


def create_mfa_token(uid, token_version=0):
    """Proof that the password was right; only good for entering the authenticator code."""
    return _encode({'sub': uid, 'type': 'mfa', 'tv': int(token_version or 0),
                    'exp': datetime.now(timezone.utc) + timedelta(minutes=MFA_TOKEN_MINUTES)})


def decode_token(t):
    try:
        return jwt.decode(t, os.environ['JWT_SECRET'], algorithms=[ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, 'Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(401, 'Invalid token')


def _appearance(u):
    saved = Appearance.from_doc(u.get('appearance'))
    return saved.to_dict() if saved else None       # None = never chosen; the app keeps the device's choice


def public_user(u):
    return {
        'id': str(u['_id']),
        'name': u['name'],
        'email': u['email'],
        'role': u['role'],
        'student_id': u.get('student_id'),
        'phone': u.get('phone'),
        'picture': u.get('picture'),
        'skills': u.get('skills', []),
        'max_concurrent': u.get('max_concurrent', 5),
        'is_active': u.get('is_active', True),
        'two_factor_enabled': bool(u.get('totp_enabled')),
        'appearance': _appearance(u),
    }


async def load_user_from_token(token: str, expected_type: str) -> dict:
    """Decode a token and return the (active) user document it belongs to."""
    p = decode_token(token)
    if p.get('type') != expected_type:
        raise HTTPException(401, 'Invalid token type')
    try:
        u = await db.users.find_one({'_id': ObjectId(p['sub'])})
    except Exception:
        u = None
    if not u or not u.get('is_active', True):
        raise HTTPException(401, 'User not found or deactivated')
    if int(p.get('tv', 0)) != int(u.get('token_version', 0)):
        raise HTTPException(401, 'This session was signed out. Please sign in again.')
    return u


def token_from_request(request: Request) -> str:
    auth_header = request.headers.get('Authorization', '')
    if auth_header.lower().startswith('bearer '):
        return auth_header[7:].strip()
    return auth_header.strip() or request.cookies.get('access_token', '')


async def get_current_user_doc(request: Request) -> dict:
    token = token_from_request(request)
    if not token:
        raise HTTPException(401, 'Not authenticated')
    return await load_user_from_token(token, 'access')


async def get_current_user(request: Request):
    return public_user(await get_current_user_doc(request))


def require_roles(*roles):
    async def dep(user=Depends(get_current_user)):
        if user['role'] not in roles: raise UnauthorizedOperationError('Insufficient permissions')
        return user
    return dep
