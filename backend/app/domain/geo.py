"""Field-service geography: where an issue is, how a technician gets there,
and whether they really arrived.

    GeoPoint                 value object (immutable), knows its distance to another point
    CampusMap                building name → pin; admin-corrected pins override the defaults
    NavigationLinkProvider   Strategy/Adapter: turns a destination into a maps link
     ├── GoogleMapsDirections
     └── OpenStreetMapDirections
    ArrivalPolicy            business rule: "close enough" to count as arrived
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from typing import Optional
from urllib.parse import urlencode

from app.domain.exceptions import InvalidInputError

EARTH_RADIUS_M = 6_371_000
GEO_SOURCES = ('gps', 'building', 'asset', 'manual')


@dataclass(frozen=True)
class GeoPoint:
    lat: float
    lng: float
    accuracy_m: Optional[float] = None     # GPS accuracy radius reported by the phone
    source: str = 'gps'                    # where the point came from (see GEO_SOURCES)

    def __post_init__(self):
        try:
            lat, lng = float(self.lat), float(self.lng)
        except (TypeError, ValueError) as exc:
            raise InvalidInputError('Latitude and longitude must be numbers') from exc
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise InvalidInputError('Latitude must be between -90 and 90 and longitude between -180 and 180')
        if self.source not in GEO_SOURCES:
            raise InvalidInputError(f'Unknown location source: {self.source}')
        object.__setattr__(self, 'lat', round(lat, 7))
        object.__setattr__(self, 'lng', round(lng, 7))
        if self.accuracy_m is not None:
            object.__setattr__(self, 'accuracy_m', round(max(0.0, float(self.accuracy_m)), 1))

    def distance_to(self, other: 'GeoPoint') -> float:
        """Great-circle (haversine) distance in metres."""
        p1, p2 = math.radians(self.lat), math.radians(other.lat)
        dp, dl = p2 - p1, math.radians(other.lng - self.lng)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))

    @property
    def is_precise(self) -> bool:
        """A real GPS fix that is good enough to navigate to (indoor fixes are often 50-500 m off)."""
        return self.source in ('gps', 'manual') and (self.accuracy_m is None or self.accuracy_m <= 60)

    def to_doc(self) -> dict:
        return asdict(self)

    @classmethod
    def from_doc(cls, d: Optional[dict]) -> Optional['GeoPoint']:
        if not d or d.get('lat') is None or d.get('lng') is None:
            return None
        return cls(d['lat'], d['lng'], d.get('accuracy_m'), d.get('source') or 'gps')


class CampusMap:
    """Approximate pins for BITS Pilani Hyderabad buildings.

    The defaults are rough positions around the campus centre (17.5465 N, 78.5725 E).
    Admins can drag a pin to the right spot on the Campus map page; those corrections
    are stored in MongoDB and win over these defaults.
    """
    CENTRE = GeoPoint(17.5465, 78.5725, source='building')
    DEFAULT_PINS = {
        # academic area
        'Block A': (17.54515, 78.57170), 'Block B': (17.54545, 78.57225), 'Block C': (17.54575, 78.57280),
        'Block D': (17.54605, 78.57335), 'Block F': (17.54480, 78.57290), 'Block G': (17.54455, 78.57235),
        'NAB (New Academic Block)': (17.54420, 78.57150), 'LTC (Lecture Theatre Complex)': (17.54630, 78.57215),
        'Library': (17.54560, 78.57120), 'Workshop': (17.54395, 78.57360),
        'SAC (Student Activity Centre)': (17.54720, 78.57390), 'Medical Centre': (17.54780, 78.57180),
        # hostels (bhavans)
        'Vishwakarma Bhavan': (17.54810, 78.57290), 'Valmiki Bhavan': (17.54845, 78.57360),
        'Gautam Bhavan': (17.54880, 78.57430), 'Gandhi Bhavan': (17.54915, 78.57500),
        'Ram Bhavan': (17.54760, 78.57480), 'Vyas Bhavan': (17.54725, 78.57545),
        'Shankar Bhavan': (17.54690, 78.57610), 'Krishna Bhavan': (17.54655, 78.57675),
    }

    def __init__(self, overrides: Optional[dict] = None):
        self._pins = {name: GeoPoint(lat, lng, source='building') for name, (lat, lng) in self.DEFAULT_PINS.items()}
        for name, point in (overrides or {}).items():
            self._pins[name] = GeoPoint(point['lat'], point['lng'], source='building')
        self._corrected = set((overrides or {}).keys())

    def pin_for(self, building: Optional[str]) -> Optional[GeoPoint]:
        return self._pins.get(building) if building else None

    def buildings(self) -> list:
        return [{'name': n, 'lat': p.lat, 'lng': p.lng, 'corrected': n in self._corrected}
                for n, p in self._pins.items()]

    def nearest(self, point: GeoPoint) -> tuple:
        """(building name, distance in metres) closest to a GPS point."""
        return min(((n, p.distance_to(point)) for n, p in self._pins.items()), key=lambda x: x[1])


class NavigationLinkProvider(ABC):
    """Strategy: one way of opening turn-by-turn directions to a destination."""
    name: str = ''

    @abstractmethod
    def directions_url(self, destination: GeoPoint, label: str = '') -> str: ...


class GoogleMapsDirections(NavigationLinkProvider):
    """Adapter for the public Google Maps URL scheme (no API key needed)."""
    name = 'google'

    def directions_url(self, destination, label=''):
        return 'https://www.google.com/maps/dir/?' + urlencode(
            {'api': 1, 'destination': f'{destination.lat},{destination.lng}', 'travelmode': 'walking'})


class OpenStreetMapDirections(NavigationLinkProvider):
    name = 'osm'

    def directions_url(self, destination, label=''):
        return (f'https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B'
                f'{destination.lat}%2C{destination.lng}#map=18/{destination.lat}/{destination.lng}')


class NavigationLinks:
    """Builds every supported link for one destination."""
    PROVIDERS = (GoogleMapsDirections(), OpenStreetMapDirections())

    @classmethod
    def for_point(cls, point: GeoPoint, label='') -> dict:
        return {p.name: p.directions_url(point, label) for p in cls.PROVIDERS}


@dataclass(frozen=True)
class ArrivalCheck:
    distance_m: float
    allowed_m: float
    verified: bool


class ArrivalPolicy:
    """A technician counts as 'arrived' when they are within `radius_m` of the issue.

    GPS is imprecise indoors, so the reported accuracy of both fixes is added to the
    radius (capped, so a 2 km "accuracy" cannot prove anything).
    """
    MAX_ACCURACY_ALLOWANCE = 150
    BUILDING_PIN_ALLOWANCE = 120      # a building pin marks the middle of a large building, not the room

    def __init__(self, radius_m: float = 150):
        self.radius_m = max(20.0, float(radius_m))

    def check(self, target: GeoPoint, technician: GeoPoint) -> ArrivalCheck:
        slack = min(self.MAX_ACCURACY_ALLOWANCE, (target.accuracy_m or 0) + (technician.accuracy_m or 0))
        if target.source == 'building':
            slack += self.BUILDING_PIN_ALLOWANCE
        allowed = self.radius_m + slack
        distance = target.distance_to(technician)
        return ArrivalCheck(round(distance, 1), round(allowed, 1), distance <= allowed)
