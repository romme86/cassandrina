"""
Strategy selector for Cassandrina.

Maps confidence to directional risk tiers and exposes shared strategy metadata.
Grid selection is handled by the decision engine.
"""

from enum import Enum


class Strategy(str, Enum):
    A = "A"   # highest-confidence directional futures
    B = "B"   # strong directional futures
    C = "C"   # balanced-range grid
    D = "D"   # moderate-confidence directional futures
    E = "E"   # lowest-confidence mandatory directional futures


# Strategy boundaries (lower bound inclusive)
_STRATEGY_THRESHOLDS: list[tuple[float, Strategy]] = [
    (80.0, Strategy.A),
    (65.0, Strategy.B),
    (35.0, Strategy.D),
]

# Default leverage per strategy
_DEFAULT_LEVERAGE: dict[Strategy, int] = {
    Strategy.A: 30,
    Strategy.B: 20,
    Strategy.C: 1,
    Strategy.D: 10,
    Strategy.E: 5,
}


def select_strategy(confidence: float) -> Strategy:
    """Return the appropriate directional Strategy for the given confidence score (0–100)."""
    for threshold, strategy in _STRATEGY_THRESHOLDS:
        if confidence >= threshold:
            return strategy
    return Strategy.E


def get_direction(current_price: float, target_price: float) -> str:
    """Return 'long' if target > current, else 'short'."""
    return "long" if target_price >= current_price else "short"


def get_leverage(strategy: Strategy) -> int:
    """Return the default leverage for the given strategy."""
    return _DEFAULT_LEVERAGE[strategy]
