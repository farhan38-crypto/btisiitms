"""Notification mechanisms.

    NotificationChannel (interface)
      ├── InAppChannel            bell icon in the web app          (always on)
      ├── SimulatedEmailChannel   email queued in `email_logs`      (always on)
      └── SmtpEmailChannel        real email through an EmailSender (selected events, if SMTP is configured)

    EmailSender (interface)  ←  SmtpEmailAdapter   (Adapter pattern around smtplib)

Adding SMS or push notifications means writing one more NotificationChannel
subclass and passing it to the NotificationDispatcher — nothing else changes.
"""
import asyncio
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

from app.domain.sla import utcnow
from app.services.email import send_email

log = logging.getLogger('notifications')


@dataclass(frozen=True)
class Notification:
    title: str
    message: str
    kind: str
    incident_id: Optional[str] = None
    incident_number: Optional[str] = None
    email_subject: Optional[str] = None
    email_body: Optional[str] = None


# ─────────────── Adapter: external email provider ───────────────

class EmailSender(ABC):
    """What the app needs from any email provider."""

    @abstractmethod
    async def send(self, recipient: str, subject: str, body: str) -> None: ...

    @abstractmethod
    def is_configured(self) -> bool: ...


class SmtpEmailAdapter(EmailSender):
    """Adapts the blocking smtplib helper to the async EmailSender interface."""

    def is_configured(self):
        return all((os.getenv(k) or '').strip() for k in ('SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD'))

    async def send(self, recipient, subject, body):
        await asyncio.to_thread(send_email, recipient, subject, body)


# ─────────────── Channels ───────────────

class NotificationChannel(ABC):
    name: str = ''

    def supports(self, notification: Notification, recipient: dict) -> bool:
        return True

    @abstractmethod
    async def send(self, recipient: dict, notification: Notification) -> None: ...


class InAppChannel(NotificationChannel):
    name = 'in_app'

    def __init__(self, db):
        self.db = db

    async def send(self, recipient, n):
        await self.db.notifications.insert_one({
            'user_id': recipient['id'], 'title': n.title, 'message': n.message, 'kind': n.kind,
            'incident_id': n.incident_id, 'incident_number': n.incident_number, 'read': False,
            'created_at': utcnow().isoformat()})


def wants_email(notification: Notification, recipient: dict) -> bool:
    """Security alerts always go out; everything else respects the user's email preference."""
    return notification.kind == 'security' or recipient.get('email_notifications', True) is not False


class SimulatedEmailChannel(NotificationChannel):
    name = 'simulated_email'

    def __init__(self, db):
        self.db = db

    def supports(self, n, recipient):
        return wants_email(n, recipient)

    async def send(self, recipient, n):
        await self.db.email_logs.insert_one({
            'user_id': recipient['id'], 'recipient': recipient.get('email'), 'subject': n.email_subject or n.title,
            'body': n.email_body or n.message, 'channel': self.name, 'status': 'queued',
            'created_at': utcnow().isoformat()})


class SmtpEmailChannel(NotificationChannel):
    """Real email, only for the events people genuinely want in their inbox."""
    name = 'smtp'
    DEFAULT_KINDS = frozenset({'resolved', 'sla_breached', 'escalation', 'security'})

    def __init__(self, db, sender: EmailSender, kinds=DEFAULT_KINDS):
        self.db = db
        self.sender = sender
        self.kinds = frozenset(kinds)

    def supports(self, n, recipient):
        return (n.kind in self.kinds and bool(recipient.get('email')) and wants_email(n, recipient)
                and self.sender.is_configured())

    async def send(self, recipient, n):
        subject, body = n.email_subject or n.title, n.email_body or n.message
        entry = {'user_id': recipient['id'], 'recipient': recipient['email'], 'subject': subject, 'body': body,
                 'channel': self.name, 'created_at': utcnow().isoformat()}
        try:
            await self.sender.send(recipient['email'], subject, body)
            await self.db.email_logs.insert_one({**entry, 'status': 'sent'})
        except Exception as exc:
            from app.core.logging_config import log_exception
            log_exception(log, f'Email "{subject}" could not be sent', exc, level=logging.WARNING,
                          with_traceback=False, Recipient=recipient['email'],
                          Effect='The in-app notification was still delivered; only the email failed.')
            await self.db.email_logs.insert_one({**entry, 'status': 'failed', 'error': str(exc)[:500]})


class NotificationDispatcher:
    """Sends one notification to many people over every channel that supports it."""

    def __init__(self, channels):
        self.channels = list(channels)

    async def notify(self, recipients, notification: Notification):
        seen = set()
        for r in recipients:
            if not r or not r.get('id') or r['id'] in seen or r['id'] == 'system':
                continue
            seen.add(r['id'])
            for ch in self.channels:
                if ch.supports(notification, r):
                    try:
                        await ch.send(r, notification)
                    except Exception as exc:
                        from app.core.logging_config import log_exception
                        log_exception(log, f'{ch.name} notification failed', exc, level=logging.WARNING,
                                      with_traceback=False, Recipient=r.get('email') or r['id'])
