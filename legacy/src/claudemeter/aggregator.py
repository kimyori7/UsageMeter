from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Dict, Iterable, List, Optional, Sequence, Set

from claudemeter.parser import UsageEvent
from claudemeter.pricing import PriceTable, compute_cost
from claudemeter.block_calculator import current_block


class Period(Enum):
    CURRENT_BLOCK = "current_block"
    TODAY = "today"
    THIS_WEEK = "this_week"
    THIS_MONTH = "this_month"
    ALL_TIME = "all_time"


@dataclass
class AggregateMetrics:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0
    cost: float = 0.0
    last_activity: Optional[datetime] = None

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
        )

    def add(self, event: UsageEvent, cost: float) -> None:
        self.input_tokens += event.input_tokens
        self.output_tokens += event.output_tokens
        self.cache_creation_tokens += event.cache_creation_tokens
        self.cache_read_tokens += event.cache_read_tokens
        self.cost += cost
        if self.last_activity is None or event.timestamp > self.last_activity:
            self.last_activity = event.timestamp


@dataclass
class ModelNode(AggregateMetrics):
    model: str = ""


@dataclass
class SessionNode(AggregateMetrics):
    project_path: str = ""
    models: Dict[str, ModelNode] = field(default_factory=dict)


@dataclass
class PeriodNode(AggregateMetrics):
    period: Optional[Period] = None
    sessions: Dict[str, SessionNode] = field(default_factory=dict)


@dataclass
class AggregateTree:
    periods: Dict[Period, PeriodNode] = field(default_factory=dict)


def _local_midnight(now: datetime) -> datetime:
    local = now.astimezone()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc)


def _local_week_start(now: datetime) -> datetime:
    local = now.astimezone()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    monday = midnight - timedelta(days=local.weekday())
    return monday.astimezone(timezone.utc)


def _local_month_start(now: datetime) -> datetime:
    local = now.astimezone()
    first = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return first.astimezone(timezone.utc)


def period_for(timestamp: datetime, *, now: datetime) -> Set[Period]:
    result: Set[Period] = {Period.ALL_TIME}
    if timestamp >= _local_month_start(now):
        result.add(Period.THIS_MONTH)
    if timestamp >= _local_week_start(now):
        result.add(Period.THIS_WEEK)
    if timestamp >= _local_midnight(now):
        result.add(Period.TODAY)
    return result


def aggregate(
    events: Iterable[UsageEvent],
    *,
    price_table: PriceTable,
    now: Optional[datetime] = None,
) -> AggregateTree:
    if now is None:
        now = datetime.now(timezone.utc)

    events_list = list(events)

    block = current_block(events_list, now=now)
    block_event_ids = {id(e) for e in block.events} if block else set()

    tree = AggregateTree()

    def ensure(period: Period) -> PeriodNode:
        if period not in tree.periods:
            tree.periods[period] = PeriodNode(period=period)
        return tree.periods[period]

    for event in events_list:
        cost = compute_cost(event, price_table)
        periods = period_for(event.timestamp, now=now)
        if id(event) in block_event_ids:
            periods.add(Period.CURRENT_BLOCK)
        for period in periods:
            node = ensure(period)
            node.add(event, cost)
            session = node.sessions.setdefault(
                event.project_path,
                SessionNode(project_path=event.project_path),
            )
            session.add(event, cost)
            model = session.models.setdefault(
                event.model, ModelNode(model=event.model)
            )
            model.add(event, cost)

    return tree
