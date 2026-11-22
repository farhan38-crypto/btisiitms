"""Appearance: the look a person picked, saved with their account so it follows them to
every device they sign in on. The model mirrors MiniMusic's theme types:

    ThemeColor     value object: a colour as hue / saturation / brightness (each 0…1)
    GradientTheme  value object: one to three ThemeColors swept across the window at an angle
    Appearance     value object: the look (BITS reports' own Original and Indigo, or MiniMusic's
                   AMOLED, Dark, Greenboard, Light or Gradient), the
                   current gradient, and the gradients the person saved to reuse

Everything is immutable, and anything unknown or out of range falls back to a default
instead of failing, so an old or hand-edited user document can never break sign-in.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import re

THEMES = ('original', 'indigo', 'amoled', 'dark', 'greenboard', 'light', 'gradient')
# The glass app's themes live in its own registry (frontend-next/src/themes) and new ones are added
# there without touching the server, so any well-formed id is stored; an id the app doesn't know
# falls back to its default on the device. 'auto' means "follow the device's light/dark setting".
GLASS_THEME_ID = re.compile(r'^[a-z0-9][a-z0-9-]{1,39}$')
MAX_SAVED_GRADIENTS = 24


def glass_theme_id(value) -> Optional[str]:
    return value if isinstance(value, str) and GLASS_THEME_ID.match(value) else None


@dataclass(frozen=True)
class GlassPrefs:
    """Display preferences of the glass app that apply on top of any theme."""
    reduce_transparency: bool = False     # solid panels instead of frosted glass
    reduce_motion: bool = False           # calmer animations, still 3D/graphs
    colour_safe: bool = False             # Okabe–Ito priority colours (colour-blind safe)
    auto_light: Optional[str] = None      # theme used by 'auto' when the device is light
    auto_dark: Optional[str] = None       # … and when it is dark

    @classmethod
    def from_doc(cls, doc) -> Optional['GlassPrefs']:
        if not isinstance(doc, dict):
            return None
        return cls(bool(doc.get('reduce_transparency')), bool(doc.get('reduce_motion')), bool(doc.get('colour_safe')),
                   glass_theme_id(doc.get('auto_light')), glass_theme_id(doc.get('auto_dark')))

    def to_dict(self) -> dict:
        d = {'reduce_transparency': self.reduce_transparency, 'reduce_motion': self.reduce_motion, 'colour_safe': self.colour_safe}
        if self.auto_light:
            d['auto_light'] = self.auto_light
        if self.auto_dark:
            d['auto_dark'] = self.auto_dark
        return d


def _unit(value) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


@dataclass(frozen=True)
class ThemeColor:
    h: float
    s: float
    b: float

    @classmethod
    def from_doc(cls, doc) -> 'ThemeColor':
        doc = doc if isinstance(doc, dict) else {}
        return cls(_unit(doc.get('h')), _unit(doc.get('s')), _unit(doc.get('b')))

    def to_dict(self) -> dict:
        return {'h': self.h, 's': self.s, 'b': self.b}


@dataclass(frozen=True)
class GradientTheme:
    colors: tuple = (ThemeColor(0.72, 0.62, 0.42), ThemeColor(0.93, 0.58, 0.55))
    angle: float = 135

    @classmethod
    def from_doc(cls, doc) -> 'GradientTheme':
        if not isinstance(doc, dict) or not isinstance(doc.get('colors'), list) or not doc['colors']:
            return cls()
        try:
            angle = min(360.0, max(0.0, float(doc.get('angle', 135))))
        except (TypeError, ValueError):
            angle = 135.0
        return cls(tuple(ThemeColor.from_doc(c) for c in doc['colors'][:3]), angle)

    def to_dict(self) -> dict:
        return {'colors': [c.to_dict() for c in self.colors], 'angle': self.angle}


@dataclass(frozen=True)
class Appearance:
    theme: str = 'original'
    gradient: GradientTheme = field(default_factory=GradientTheme)
    saved_gradients: tuple = ()
    glass_theme: Optional[str] = None
    glass_prefs: Optional[GlassPrefs] = None

    @classmethod
    def from_doc(cls, doc: Optional[dict]) -> Optional['Appearance']:
        """The saved appearance, or None if this account never chose one."""
        if not isinstance(doc, dict):
            return None
        saved = doc.get('saved_gradients') if isinstance(doc.get('saved_gradients'), list) else []
        return cls(
            theme=doc.get('theme') if doc.get('theme') in THEMES else 'original',
            gradient=GradientTheme.from_doc(doc.get('gradient')),
            saved_gradients=tuple(GradientTheme.from_doc(g) for g in saved[:MAX_SAVED_GRADIENTS]),
            glass_theme=glass_theme_id(doc.get('glass_theme')),
            glass_prefs=GlassPrefs.from_doc(doc.get('glass_prefs')),
        )

    @property
    def is_gradient(self) -> bool:
        return self.theme == 'gradient'

    def to_dict(self) -> dict:
        d = {'theme': self.theme, 'gradient': self.gradient.to_dict(),
             'saved_gradients': [g.to_dict() for g in self.saved_gradients]}
        if self.glass_theme:
            d['glass_theme'] = self.glass_theme
        if self.glass_prefs:
            d['glass_prefs'] = self.glass_prefs.to_dict()
        return d
