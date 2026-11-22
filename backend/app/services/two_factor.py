"""Two-factor sign-in with an authenticator app (TOTP, RFC 6238).

    SecondFactor (interface)
      ├── TotpFactor        6-digit code from Google / Microsoft Authenticator, Authy, …
      └── BackupCodeFactor  one-time recovery codes for when the phone is lost

TwoFactorService tries each factor in turn (polymorphism), consumes the code
atomically so it can never be used twice, and blocks guessing after
MAX_FAILURES wrong codes in FAILURE_WINDOW.

Storage
  • The TOTP secret has to be readable by the server to check codes, so it is
    encrypted (Fernet / AES) with a key derived from TOTP_ENCRYPTION_KEY, or
    JWT_SECRET when that is not set.
  • Backup codes are only ever compared, so only an HMAC-SHA256 of each is kept.
"""
import base64
import hashlib
import hmac
import io
import os
import re
import secrets
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyotp
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet, InvalidToken

from app.domain.exceptions import ITSMError, InvalidCodeError, TooManyAttemptsError

ISSUER = 'BITS reports'
PERIOD = 30                 # seconds per code
VALID_WINDOW = 1            # also accept the previous/next code (phone clock ±30 s)
BACKUP_CODE_COUNT = 8
MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=15)


def _key_material() -> bytes:
    return (os.getenv('TOTP_ENCRYPTION_KEY') or os.getenv('JWT_SECRET') or '').encode()


def encrypt_secret(secret: str) -> str:
    key = base64.urlsafe_b64encode(hashlib.sha256(b'bits-reports/totp-secret:' + _key_material()).digest())
    return Fernet(key).encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    key = base64.urlsafe_b64encode(hashlib.sha256(b'bits-reports/totp-secret:' + _key_material()).digest())
    try:
        return Fernet(key).decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise ITSMError('Your authenticator settings cannot be read because the server key changed. '
                        'Use a backup code or ask an administrator to reset your authenticator.') from exc


def hash_backup_code(code: str) -> str:
    key = hashlib.sha256(b'bits-reports/backup-code:' + _key_material()).digest()
    return hmac.new(key, normalise_backup_code(code).encode(), hashlib.sha256).hexdigest()


def normalise_backup_code(code: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (code or '').lower())


def new_backup_codes(n=BACKUP_CODE_COUNT) -> list:
    """Codes like 'k7d2m-9xq4p' (10 characters ≈ 50 bits each)."""
    alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'          # no 0/o, 1/l/i look-alikes
    codes = []
    for _ in range(n):
        raw = ''.join(secrets.choice(alphabet) for _ in range(10))
        codes.append(f'{raw[:5]}-{raw[5:]}')
    return codes


def new_secret() -> str:
    return pyotp.random_base32()                          # 32 base32 characters = 160 bits


def provisioning_uri(secret: str, account: str) -> str:
    return pyotp.TOTP(secret, interval=PERIOD).provisioning_uri(name=account, issuer_name=ISSUER)


def qr_svg(data: str) -> str:
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


def matching_step(secret: str, code: str, now: Optional[float] = None) -> Optional[int]:
    """The 30-second time step whose code equals `code`, or None."""
    code = re.sub(r'\s', '', code or '')
    if not re.fullmatch(r'\d{6}', code):
        return None
    totp = pyotp.TOTP(secret, interval=PERIOD)
    current = int((now if now is not None else time.time()) // PERIOD)
    for step in [current] + [current + d for w in range(1, VALID_WINDOW + 1) for d in (-w, w)]:
        if hmac.compare_digest(totp.at(step * PERIOD), code):
            return step
    return None


# ───────────────────────── factors ─────────────────────────

class SecondFactor(ABC):
    """One way of proving you have your second factor."""
    name: str = ''

    @abstractmethod
    def consume(self, user: dict, code: str, now: float) -> Optional[tuple]:
        """If `code` is right, return the (filter, update) that uses it up; otherwise None.
        The filter makes the update fail if the code was used in the meantime (no replay)."""


class TotpFactor(SecondFactor):
    name = 'authenticator'

    def consume(self, user, code, now):
        if not user.get('totp_secret'):
            return None
        step = matching_step(decrypt_secret(user['totp_secret']), code, now)
        if step is None:
            return None
        unused = {'$or': [{'totp_last_step': {'$lt': step}}, {'totp_last_step': {'$exists': False}},
                          {'totp_last_step': None}]}
        return {'_id': user['_id'], **unused}, {'$set': {'totp_last_step': step}}


class BackupCodeFactor(SecondFactor):
    name = 'backup_code'

    def consume(self, user, code, now):
        if len(normalise_backup_code(code)) != 10:
            return None
        h = hash_backup_code(code)
        if h not in (user.get('backup_codes') or []):
            return None
        return {'_id': user['_id'], 'backup_codes': h}, {'$pull': {'backup_codes': h}}


class TwoFactorService:
    factors = (TotpFactor(), BackupCodeFactor())

    def __init__(self, db, security_log):
        self.db = db
        self.log = security_log

    async def _recent_failures(self, user_id) -> int:
        since = datetime.now(timezone.utc) - FAILURE_WINDOW
        return await self.log.count({'user_id': user_id, 'event': '2fa_failed', 'at': {'$gte': since}})

    async def verify(self, user: dict, code: str, request=None, allow=None) -> str:
        """Check a code from any allowed factor. Returns the factor's name or raises."""
        uid = str(user['_id'])
        if await self._recent_failures(uid) >= MAX_FAILURES:
            raise TooManyAttemptsError('Too many wrong codes. Wait 15 minutes and try again.')
        now = time.time()
        for factor in self.factors:
            if allow and factor.name not in allow:
                continue
            used = factor.consume(user, code, now)
            if used and (await self.db.users.update_one(*used)).modified_count:
                return factor.name
        await self.log.record(user, '2fa_failed', request=request)
        raise InvalidCodeError('That code is not correct. Check the newest code in your authenticator app.')

    @staticmethod
    def backup_codes_left(user: dict) -> int:
        return len(user.get('backup_codes') or [])
