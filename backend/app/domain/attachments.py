"""Evidence attached to an incident: photos and voice notes.

    Attachment (abstract)          validates its own content (polymorphism)
     ├── PhotoAttachment           before / after / evidence pictures
     └── VoiceNoteAttachment       recorded audio, optional live transcript
    AttachmentFactory              builds the right subclass for a `kind`

Files are kept in MongoDB as binary (photos are resized in the browser first),
so nothing extra has to be installed or backed up separately.
"""
from __future__ import annotations

import base64
import binascii
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from app.domain.exceptions import InvalidInputError

PHOTO_STAGES = ('before', 'after', 'evidence')


class Attachment(ABC):
    kind: str = ''
    allowed_types: tuple = ()
    max_bytes: int = 0

    def __init__(self, incident_id: str, content_type: str, data_base64: str, uploaded_by: dict, now: datetime,
                 **extra):
        self.incident_id = incident_id
        self.content_type = (content_type or '').split(';')[0].strip().lower()
        self.data = self._decode(data_base64)
        self.uploaded_by = uploaded_by
        self.created_at = now.isoformat()
        self.extra = extra
        self.validate()

    @staticmethod
    def _decode(data_base64: str) -> bytes:
        raw = (data_base64 or '').split(',', 1)[-1]          # accept "data:...;base64,xxxx" too
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise InvalidInputError('The file could not be read (invalid base64 data)') from exc
        if not data:
            raise InvalidInputError('The file is empty')
        return data

    def validate(self):
        if self.content_type not in self.allowed_types:
            raise InvalidInputError(f'{self.label} must be one of: {", ".join(self.allowed_types)}')
        if len(self.data) > self.max_bytes:
            raise InvalidInputError(f'{self.label} is too large (max {self.max_bytes // (1024 * 1024)} MB)')
        self._validate_specific()

    @abstractmethod
    def _validate_specific(self): ...

    @property
    @abstractmethod
    def label(self) -> str: ...

    def _specific_fields(self) -> dict:
        return {}

    def to_doc(self) -> dict:
        return {'incident_id': self.incident_id, 'kind': self.kind, 'content_type': self.content_type,
                'size': len(self.data), 'data': self.data, 'uploaded_by': self.uploaded_by.get('id'),
                'uploaded_by_name': self.uploaded_by.get('name'), 'uploaded_by_role': self.uploaded_by.get('role'),
                'created_at': self.created_at, **self._specific_fields()}


class PhotoAttachment(Attachment):
    kind = 'photo'
    allowed_types = ('image/jpeg', 'image/png', 'image/webp')
    max_bytes = 6 * 1024 * 1024
    label = 'A photo'

    def _validate_specific(self):
        stage = self.extra.get('stage') or 'evidence'
        if stage not in PHOTO_STAGES:
            raise InvalidInputError(f'Photo stage must be one of: {", ".join(PHOTO_STAGES)}')
        self.stage = stage
        self.caption = (self.extra.get('caption') or '').strip()[:200] or None

    def _specific_fields(self):
        return {'stage': self.stage, 'caption': self.caption}


class VoiceNoteAttachment(Attachment):
    kind = 'voice'
    allowed_types = ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac')
    max_bytes = 8 * 1024 * 1024
    max_seconds = 180
    label = 'A voice note'

    def _validate_specific(self):
        duration = self.extra.get('duration_s')
        if duration is not None and not 0 < float(duration) <= self.max_seconds + 5:
            raise InvalidInputError(f'Voice notes can be at most {self.max_seconds // 60} minutes long')
        self.duration_s = round(float(duration), 1) if duration else None
        self.transcript = (self.extra.get('transcript') or '').strip()[:4000] or None

    def _specific_fields(self):
        return {'duration_s': self.duration_s, 'transcript': self.transcript}


class AttachmentFactory:
    """Factory pattern: picks the Attachment subclass for a kind."""
    _kinds = {c.kind: c for c in (PhotoAttachment, VoiceNoteAttachment)}

    @classmethod
    def create(cls, kind: str, **kwargs) -> Attachment:
        try:
            klass = cls._kinds[kind]
        except KeyError as exc:
            raise InvalidInputError(f"Unknown attachment kind '{kind}' (use photo or voice)") from exc
        return klass(**kwargs)


def public_attachment(doc: Optional[dict]) -> Optional[dict]:
    """Metadata only: the binary content is served by its own endpoint."""
    if not doc:
        return None
    d = {k: v for k, v in doc.items() if k != 'data'}
    d['id'] = str(d.pop('_id'))
    return d
