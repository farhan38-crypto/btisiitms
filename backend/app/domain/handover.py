"""Handover code: a 4-digit code only the reporter can see. The technician asks
for it at the door and enters it to resolve the job, which proves the visit
really happened (like a delivery OTP)."""
from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from app.domain.exceptions import InvalidInputError, TooManyAttemptsError

CODE_LENGTH = 4
MAX_ATTEMPTS = 5


@dataclass
class HandoverCode:
    incident_id: str
    code: str
    attempts: int = 0
    verified_at: Optional[str] = None
    verified_by: Optional[str] = None

    @classmethod
    def issue(cls, incident_id: str) -> 'HandoverCode':
        return cls(incident_id, ''.join(secrets.choice('0123456789') for _ in range(CODE_LENGTH)))

    @property
    def locked(self) -> bool:
        return self.attempts >= MAX_ATTEMPTS and not self.verified_at

    @property
    def attempts_left(self) -> int:
        return max(0, MAX_ATTEMPTS - self.attempts)

    def verify(self, entered: Optional[str], by_user_id: str, now: datetime) -> None:
        """Raises with a helpful message when the code is wrong; marks it verified otherwise."""
        if self.verified_at:
            return
        if self.locked:
            raise TooManyAttemptsError('Too many wrong handover codes. An administrator has to resolve this job.')
        entered = ''.join(ch for ch in (entered or '') if ch.isdigit())
        if not entered:
            raise InvalidInputError('Ask the student for the 4-digit handover code shown on their report, '
                                    'then enter it to resolve this job.')
        self.attempts += 1
        if not hmac.compare_digest(entered, self.code):
            left = self.attempts_left
            raise InvalidInputError(f'Wrong handover code. {left} attempt{"" if left == 1 else "s"} left.'
                                    if left else 'Wrong handover code. The code is now locked; ask an administrator.')
        self.verified_at = now.isoformat()
        self.verified_by = by_user_id

    def to_doc(self) -> dict:
        return {'incident_id': self.incident_id, 'code': self.code, 'attempts': self.attempts,
                'verified_at': self.verified_at, 'verified_by': self.verified_by}

    @classmethod
    def from_doc(cls, d: dict) -> 'HandoverCode':
        return cls(d['incident_id'], d['code'], int(d.get('attempts') or 0), d.get('verified_at'), d.get('verified_by'))
