"""
TDD — Scoring Engine tests.
Tests cover accuracy, congruency, confidence score blending, and edge cases.
Run: pytest tests/test_scoring.py
"""

import pytest
from cassandrina.scoring import (
    compute_congruency,
    update_accuracy,
    update_congruency,
    compute_confidence,
    DEFAULT_ACCURACY,
    DEFAULT_CONGRUENCY,
)


# ── Constants ────────────────────────────────────────────────

class TestDefaults:
    def test_default_accuracy_is_50(self):
        assert DEFAULT_ACCURACY == 50.0

    def test_default_congruency_is_50(self):
        assert DEFAULT_CONGRUENCY == 50.0


# ── compute_congruency (single round) ────────────────────────

class TestComputeCongruency:
    def test_min_sats_gives_low_congruency(self):
        # 100 / 5000 = 2%
        result = compute_congruency(sats_invested=100, max_sats=5000)
        assert result == pytest.approx(2.0)

    def test_max_sats_gives_100_percent(self):
        result = compute_congruency(sats_invested=5000, max_sats=5000)
        assert result == pytest.approx(100.0)

    def test_half_sats_gives_50_percent(self):
        result = compute_congruency(sats_invested=2500, max_sats=5000)
        assert result == pytest.approx(50.0)

    def test_zero_sats_gives_zero(self):
        result = compute_congruency(sats_invested=0, max_sats=5000)
        assert result == pytest.approx(0.0)

    def test_sats_exceed_max_capped_at_100(self):
        # Edge case: someone somehow sends more than max
        result = compute_congruency(sats_invested=6000, max_sats=5000)
        assert result == pytest.approx(100.0)


# ── update_congruency (weighted moving average) ──────────────

class TestUpdateCongruency:
    def test_initial_congruency_updated_from_default(self):
        # new_congruency = 0.7 * 50 + 0.3 * 100 = 35 + 30 = 65
        result = update_congruency(old_congruency=50.0, round_congruency=100.0)
        assert result == pytest.approx(65.0)

    def test_zero_round_congruency(self):
        # new = 0.7 * 50 + 0.3 * 0 = 35
        result = update_congruency(old_congruency=50.0, round_congruency=0.0)
        assert result == pytest.approx(35.0)

    def test_converges_toward_full_participation(self):
        congruency = 50.0
        for _ in range(20):
            congruency = update_congruency(congruency, 100.0)
        # Should converge near 100
        assert congruency > 90.0

    def test_converges_toward_zero_participation(self):
        congruency = 50.0
        for _ in range(20):
            congruency = update_congruency(congruency, 0.0)
        assert congruency < 10.0


# ── update_accuracy ──────────────────────────────────────────

class TestUpdateAccuracy:
    def test_correct_prediction_raises_accuracy(self):
        result = update_accuracy(old_accuracy=50.0, correct=True)
        # 0.7 * 50 + 0.3 * 100 = 65
        assert result == pytest.approx(65.0)

    def test_incorrect_prediction_lowers_accuracy(self):
        result = update_accuracy(old_accuracy=50.0, correct=False)
        # 0.7 * 50 + 0.3 * 0 = 35
        assert result == pytest.approx(35.0)

    def test_high_accuracy_with_correct_keeps_high(self):
        result = update_accuracy(old_accuracy=90.0, correct=True)
        # 0.7 * 90 + 0.3 * 100 = 63 + 30 = 93
        assert result == pytest.approx(93.0)

    def test_price_within_2_percent_is_correct(self):
        """Integration: ±2% tolerance check helper."""
        from cassandrina.scoring import is_prediction_correct
        assert is_prediction_correct(predicted=100_000, actual=101_000) is True  # +1%
        assert is_prediction_correct(predicted=100_000, actual=102_000) is True  # +2%
        assert is_prediction_correct(predicted=100_000, actual=102_001) is False  # just over

    def test_price_outside_2_percent_is_incorrect(self):
        from cassandrina.scoring import is_prediction_correct
        assert is_prediction_correct(predicted=100_000, actual=97_000) is False  # -3%

    def test_exact_match_is_correct(self):
        from cassandrina.scoring import is_prediction_correct
        assert is_prediction_correct(predicted=95_000, actual=95_000) is True


# ── compute_confidence ───────────────────────────────────────

class TestComputeConfidence:
    def test_equal_inputs_50_percent(self):
        # (50 + 50 + 50) / 3 = 50
        result = compute_confidence(
            avg_accuracy=50.0,
            avg_congruency=50.0,
            polymarket_probability=0.5,
        )
        assert result == pytest.approx(50.0)

    def test_high_confidence_scenario(self):
        # (80 + 70 + 0.9*100) / 3 = (80 + 70 + 90) / 3 = 80
        result = compute_confidence(
            avg_accuracy=80.0,
            avg_congruency=70.0,
            polymarket_probability=0.9,
        )
        assert result == pytest.approx(80.0)

    def test_no_polymarket_data_uses_50_percent_neutral(self):
        # polymarket_probability=0.5 is the neutral fallback
        result = compute_confidence(
            avg_accuracy=60.0,
            avg_congruency=60.0,
            polymarket_probability=0.5,
        )
        assert result == pytest.approx((60 + 60 + 50) / 3)

    def test_full_certainty_gives_100(self):
        result = compute_confidence(
            avg_accuracy=100.0,
            avg_congruency=100.0,
            polymarket_probability=1.0,
        )
        assert result == pytest.approx(100.0)

    def test_zero_certainty_gives_0(self):
        result = compute_confidence(
            avg_accuracy=0.0,
            avg_congruency=0.0,
            polymarket_probability=0.0,
        )
        assert result == pytest.approx(0.0)

    def test_polymarket_probability_scaled_to_100(self):
        # polymarket at 0.7 → 70 in the average
        result = compute_confidence(
            avg_accuracy=0.0,
            avg_congruency=0.0,
            polymarket_probability=0.6,
        )
        assert result == pytest.approx((0 + 0 + 60) / 3)
