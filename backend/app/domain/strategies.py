"""Strategy pattern for priority calculation and technician assignment.

Each algorithm is its own class behind a common abstract interface, so the
algorithm in use can be swapped at runtime from the admin settings without
changing IncidentService (open/closed principle).
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from app.domain.enums import Priority
from app.domain.exceptions import InvalidInputError, TechnicianUnavailableError


# ─────────────────────────── Priority ───────────────────────────

@dataclass
class PriorityInput:
    impact: int
    urgency: int
    business_criticality: int = 1
    affected_users: int = 1
    service_criticality: int = 1     # criticality of the affected IT service (1..3)

    def __post_init__(self):
        values = (self.impact, self.urgency, self.business_criticality, self.service_criticality)
        if not all(1 <= v <= 3 for v in values) or self.affected_users < 1:
            raise InvalidInputError('impact, urgency and business criticality must be 1..3; affected_users >= 1')


@dataclass
class PriorityResult:
    priority: Priority
    score: int
    strategy: str
    explanation: str = ''


class PriorityStrategy(ABC):
    key: str = ''
    name: str = ''
    description: str = ''

    @abstractmethod
    def calculate(self, i: PriorityInput) -> PriorityResult: ...


class MatrixPriorityStrategy(PriorityStrategy):
    key = 'matrix'
    name = 'Impact × Urgency matrix'
    description = 'Classic ITIL matrix: score = impact × urgency. 9 → P1, 6 → P2, 3–4 → P3, otherwise P4.'

    def calculate(self, i):
        s = i.impact * i.urgency
        p = Priority.P1 if s >= 9 else Priority.P2 if s >= 6 else Priority.P3 if s >= 3 else Priority.P4
        return PriorityResult(p, s, self.key, f'impact {i.impact} × urgency {i.urgency} = {s}')


class WeightedScorePriorityStrategy(PriorityStrategy):
    key = 'weighted'
    name = 'Weighted score (service-aware)'
    description = ('score = impact × urgency × criticality + affected-users bonus, where criticality is the higher of '
                   'the reported business criticality and the affected service\'s criticality. '
                   '≥18 → P1, ≥10 → P2, ≥4 → P3, otherwise P4.')

    @staticmethod
    def users_bonus(n):
        return 6 if n >= 100 else 3 if n >= 20 else 1 if n >= 5 else 0

    def calculate(self, i):
        crit = max(i.business_criticality, i.service_criticality)
        bonus = self.users_bonus(i.affected_users)
        s = i.impact * i.urgency * crit + bonus
        p = Priority.P1 if s >= 18 else Priority.P2 if s >= 10 else Priority.P3 if s >= 4 else Priority.P4
        return PriorityResult(p, s, self.key,
                              f'impact {i.impact} × urgency {i.urgency} × criticality {crit} + users bonus {bonus} = {s}')


class PriorityStrategyFactory:
    registry = {c.key: c for c in (WeightedScorePriorityStrategy, MatrixPriorityStrategy)}
    default = 'weighted'

    @classmethod
    def get(cls, name) -> PriorityStrategy:
        return cls.registry.get(name, cls.registry[cls.default])()

    @classmethod
    def describe(cls):
        return [{'key': c.key, 'name': c.name, 'description': c.description} for c in cls.registry.values()]


# ─────────────────────────── Assignment ───────────────────────────

@dataclass
class TechnicianProfile:
    id: str
    name: str
    skills: list = field(default_factory=list)
    open_count: int = 0
    max_concurrent: int = 5
    resolved_in_category: int = 0
    resolved_for_service: int = 0
    avg_resolution_minutes: float = 0
    last_assigned_at: Optional[datetime] = None

    @property
    def has_capacity(self):
        return self.open_count < self.max_concurrent


@dataclass
class Ranked:
    technician: TechnicianProfile
    score: float
    breakdown: dict


class AssignmentStrategy(ABC):
    """Template method: `select` is shared; each subclass only defines `rank`."""
    key: str = ''
    name: str = ''
    description: str = ''

    def select(self, incident, profiles) -> TechnicianProfile:
        ranked = self.rank(incident, profiles)
        if not ranked:
            raise TechnicianUnavailableError('No active technician is available')
        tech = lambda r: getattr(r, 'technician', r)
        available = [r for r in ranked if tech(r).has_capacity] or (ranked if incident.get('priority') == 'P1' else [])
        if not available:
            raise TechnicianUnavailableError('All suitable technicians are at capacity')
        return tech(available[0])

    @abstractmethod
    def rank(self, incident, profiles) -> list: ...


class SkillBasedStrategy(AssignmentStrategy):
    key = 'skill'
    name = 'Skill-based'
    description = 'Prefers technicians whose skills include the incident category; ties go to the lighter workload.'

    def rank(self, incident, profiles):
        return sorted(profiles, key=lambda p: (incident.get('category') in p.skills, p.has_capacity, -p.open_count),
                      reverse=True)


class LoadBalancedStrategy(AssignmentStrategy):
    key = 'load'
    name = 'Load-balanced'
    description = 'Sends the incident to the technician with the fewest open incidents.'

    def rank(self, incident, profiles):
        return sorted(profiles, key=lambda p: (p.has_capacity, -p.open_count), reverse=True)


class RoundRobinStrategy(AssignmentStrategy):
    key = 'round_robin'
    name = 'Round robin'
    description = 'Cycles through technicians: whoever was assigned least recently goes next.'

    def rank(self, incident, profiles):
        return sorted(profiles, key=lambda p: p.last_assigned_at or datetime.min.replace(tzinfo=timezone.utc))


class ExperienceBasedStrategy(AssignmentStrategy):
    key = 'experience'
    name = 'Experience-based'
    description = ('Prefers technicians who have resolved the most incidents in this category and for this service, '
                   'then the fastest average resolution time.')

    def rank(self, incident, profiles):
        return sorted(profiles, key=lambda p: (p.resolved_in_category + p.resolved_for_service,
                                               -(p.avg_resolution_minutes or 10 ** 9)), reverse=True)


class SmartRecommendationStrategy(AssignmentStrategy):
    key = 'smart'
    name = 'Smart recommendation'
    description = ('Weighted score: 35% skill match, 25% free capacity, 20% category experience, '
                   '10% experience with the service, 10% resolution speed.')

    def rank(self, incident, profiles):
        out = []
        for p in profiles:
            skill = 1 if incident.get('category') in p.skills else .2
            load = max(0, 1 - (p.open_count / max(p.max_concurrent, 1)))
            exp = min(1, p.resolved_in_category / 10)
            svc = min(1, p.resolved_for_service / 5)
            speed = 1 / (1 + p.avg_resolution_minutes / 240) if p.avg_resolution_minutes else .5
            score = .35 * skill + .25 * load + .2 * exp + .1 * svc + .1 * speed
            out.append(Ranked(p, round(score, 4), {'skill': skill, 'load': load, 'experience': exp,
                                                   'service': svc, 'speed': speed}))
        return sorted(out, key=lambda x: x.score, reverse=True)


class PriorityBasedStrategy(AssignmentStrategy):
    """Composite: critical work goes to the most experienced, routine work is load-balanced."""
    key = 'priority'
    name = 'Priority-based'
    description = 'P1/P2 incidents go to the most experienced skilled technician; P3/P4 are spread by workload.'

    def rank(self, incident, profiles):
        if incident.get('priority') in ('P1', 'P2'):
            skilled = [p for p in profiles if incident.get('category') in p.skills]
            others = [p for p in profiles if p not in skilled]
            exp = ExperienceBasedStrategy()
            return exp.rank(incident, skilled) + exp.rank(incident, others)
        return LoadBalancedStrategy().rank(incident, profiles)


class AssignmentStrategyFactory:
    registry = {c.key: c for c in (SmartRecommendationStrategy, SkillBasedStrategy, LoadBalancedStrategy,
                                   RoundRobinStrategy, ExperienceBasedStrategy, PriorityBasedStrategy)}
    default = 'smart'

    @classmethod
    def get(cls, name) -> AssignmentStrategy:
        return cls.registry.get(name, cls.registry[cls.default])()

    @classmethod
    def describe(cls):
        return [{'key': c.key, 'name': c.name, 'description': c.description} for c in cls.registry.values()]
