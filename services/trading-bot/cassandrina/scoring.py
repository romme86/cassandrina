"""
Scoring engine for Cassandrina.

Computes per-user accuracy, congruency, and the combined
confidence score used to select a trading strategy.
"""

DEFAULT_ACCURACY: float = 50.0
DEFAULT_CONGRUENCY: float = 50.0

_ACCURACY_TOLERANCE_PCT: float = 2.0   # ±2% to count as "correct"
_WMA_OLD_WEIGHT: float = 0.7
_WMA_NEW_WEIGHT: float = 0.3


def compute_congruency(sats_invested: int, max_sats: int) -> float:
    """Return the round congruency score (0–100) based on sats invested."""
    if max_sats <= 0:
        return 0.0
    raw = (sats_invested / max_sats) * 100.0
    return min(raw, 100.0)


def update_congruency(old_congruency: float, round_congruency: float) -> float:
    """Apply weighted moving average: 70% old + 30% new round value."""
    return _WMA_OLD_WEIGHT * old_congruency + _WMA_NEW_WEIGHT * round_congruency


def is_prediction_correct(predicted: float, actual: float) -> bool:
    """Return True if *actual* is within ±2% of *predicted*."""
    if predicted == 0:
        return actual == 0
    deviation_pct = abs((actual - predicted) / predicted) * 100.0
    return deviation_pct <= _ACCURACY_TOLERANCE_PCT


def update_accuracy(old_accuracy: float, correct: bool) -> float:
    """Apply weighted moving average: 70% old + 30% of (100 if correct else 0)."""
    round_score = 100.0 if correct else 0.0
    return _WMA_OLD_WEIGHT * old_accuracy + _WMA_NEW_WEIGHT * round_score


def compute_confidence(
    avg_accuracy: float,
    avg_congruency: float,
    polymarket_probability: float,
) -> float:
    """
    Combine user accuracy, congruency, and Polymarket probability into
    a single confidence score (0–100).

    polymarket_probability is in [0, 1]; it is scaled to 0–100.
    """
    polymarket_score = polymarket_probability * 100.0
    return (avg_accuracy + avg_congruency + polymarket_score) / 3.0
