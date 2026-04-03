"""
Scoring engine for Cassandrina.

Computes per-prediction and per-user accuracy, confidence,
congruency, and the combined confidence score used to select
a trading strategy.
"""

DEFAULT_ACCURACY: float = 0.5
DEFAULT_CONGRUENCY: float = 0.5
DEFAULT_ROUND_CONFIDENCE: float = 0.5

_MIN_SCORE: float = 0.1
_MAX_SCORE: float = 1.0
_SUCCESS_TOLERANCE_SATS: float = 100.0


def _clamp_score(value: float) -> float:
    return min(max(value, _MIN_SCORE), _MAX_SCORE)


def is_prediction_successful(
    predicted_low: float,
    predicted_high: float,
    actual_low: float,
    actual_high: float,
) -> bool:
    """Return True when both ends of the predicted range are within 100 sats."""
    return (
        abs(predicted_low - actual_low) <= _SUCCESS_TOLERANCE_SATS
        and abs(predicted_high - actual_high) <= _SUCCESS_TOLERANCE_SATS
    )


def compute_prediction_accuracy(
    predicted_low: float,
    predicted_high: float,
    actual_low: float,
    actual_high: float,
) -> float:
    """Score a prediction from normalized low/high deviation, clamped to 0.1–1.0."""
    if actual_low <= 0 or actual_high <= 0:
        return _MIN_SCORE
    low_deviation = abs(predicted_low - actual_low) / actual_low
    high_deviation = abs(predicted_high - actual_high) / actual_high
    average_deviation = (low_deviation + high_deviation) / 2.0
    return _clamp_score(1.0 - average_deviation)


def compute_prediction_confidence(sats_invested: int, min_sats: int, max_sats: int) -> float:
    """Map sats committed linearly from min->10% and max->100%."""
    if max_sats <= min_sats:
        if sats_invested >= max_sats > 0:
            return _MAX_SCORE
        return _MIN_SCORE
    ratio = (sats_invested - min_sats) / (max_sats - min_sats)
    return _clamp_score(_MIN_SCORE + ratio * (_MAX_SCORE - _MIN_SCORE))


def compute_user_accuracy(prediction_accuracies: list[float]) -> float:
    """Average a user's settled prediction accuracy scores."""
    if not prediction_accuracies:
        return DEFAULT_ACCURACY
    return _clamp_score(sum(prediction_accuracies) / len(prediction_accuracies))


def compute_user_congruency(
    prediction_confidences: list[float],
    prediction_accuracies: list[float],
) -> float:
    """
    Compare average confidence versus average success.

    Small differences indicate that the user's conviction matches
    their observed performance.
    """
    if not prediction_confidences or not prediction_accuracies:
        return DEFAULT_CONGRUENCY
    avg_confidence = sum(prediction_confidences) / len(prediction_confidences)
    avg_accuracy = sum(prediction_accuracies) / len(prediction_accuracies)
    return _clamp_score(1.0 - abs(avg_confidence - avg_accuracy))


def compute_real_user_confidence(
    prediction_confidence: float,
    congruency: float,
    accuracy: float,
) -> float:
    """Blend the user's current confidence with their stored congruency and accuracy."""
    return _clamp_score((prediction_confidence * congruency) / max(accuracy, _MIN_SCORE))


def compute_round_confidence(real_user_confidences: list[float]) -> float:
    """Average the effective confidence across the round's paid participants."""
    if not real_user_confidences:
        return DEFAULT_ROUND_CONFIDENCE
    return _clamp_score(sum(real_user_confidences) / len(real_user_confidences))
