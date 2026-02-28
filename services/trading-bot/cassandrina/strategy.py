"""
Strategy selector for Cassandrina.

Maps a confidence score to one of five risk-tiered strategies (A–E),
provides direction (long/short), leverage, and grid parameters.
"""

from enum import Enum


class Strategy(str, Enum):
    A = "A"   # confidence ≥ 65 — Futures, 20x–40x leverage
    B = "B"   # confidence 55–64 — Futures, up to 20x
    C = "C"   # confidence 45–54 — Neutral grid
    D = "D"   # confidence 35–44 — Spot, 10% TP
    E = "E"   # confidence < 35  — Spot, 2% TP


# Strategy boundaries (lower bound inclusive)
_STRATEGY_THRESHOLDS: list[tuple[float, Strategy]] = [
    (65.0, Strategy.A),
    (55.0, Strategy.B),
    (45.0, Strategy.C),
    (35.0, Strategy.D),
]

# Default leverage per strategy
_DEFAULT_LEVERAGE: dict[Strategy, int] = {
    Strategy.A: 30,   # midpoint of 20–40
    Strategy.B: 20,
    Strategy.C: 1,
    Strategy.D: 1,
    Strategy.E: 1,
}

# Take-profit percentage per strategy
TAKE_PROFIT_PCT: dict[Strategy, float] = {
    Strategy.A: 0.0,   # full TP at target (handled by target_price)
    Strategy.B: 0.0,
    Strategy.C: 0.0,   # grid manages its own TP
    Strategy.D: 10.0,
    Strategy.E: 2.0,
}

# Grid distance fraction for Strategy C
_GRID_DISTANCE_FRACTION: float = 0.20


def select_strategy(confidence: float) -> Strategy:
    """Return the appropriate Strategy for the given confidence score (0–100)."""
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


def get_grid_midpoint(current_price: float, target_price: float) -> float:
    """
    For Strategy C, the grid midpoint is 20% of the distance from
    current_price toward target_price.
    """
    distance = target_price - current_price
    return current_price + _GRID_DISTANCE_FRACTION * distance
