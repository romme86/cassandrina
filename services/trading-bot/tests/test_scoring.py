"""
Tests for the Cassandrina scoring engine.
"""

import pytest

from cassandrina.scoring import (
    DEFAULT_ACCURACY,
    DEFAULT_CONGRUENCY,
    DEFAULT_ROUND_CONFIDENCE,
    compute_prediction_accuracy,
    compute_prediction_confidence,
    compute_real_user_confidence,
    compute_round_confidence,
    compute_user_accuracy,
    compute_user_congruency,
    is_prediction_successful,
)


class TestDefaults:
    def test_default_accuracy_is_point_five(self):
        assert DEFAULT_ACCURACY == 0.5

    def test_default_congruency_is_point_five(self):
        assert DEFAULT_CONGRUENCY == 0.5

    def test_default_round_confidence_is_point_five(self):
        assert DEFAULT_ROUND_CONFIDENCE == 0.5


class TestPredictionSuccess:
    def test_prediction_is_successful_when_both_edges_are_within_100_sats(self):
        assert is_prediction_successful(99_950, 100_080, 100_000, 100_000) is True

    def test_prediction_fails_when_one_edge_exceeds_100_sats(self):
        assert is_prediction_successful(99_899, 100_050, 100_000, 100_000) is False


class TestPredictionAccuracy:
    def test_exact_range_match_scores_100_percent(self):
        result = compute_prediction_accuracy(100_000, 100_000, 100_000, 100_000)
        assert result == pytest.approx(1.0)

    def test_accuracy_uses_average_normalized_low_high_deviation(self):
        result = compute_prediction_accuracy(99_000, 101_000, 100_000, 100_000)
        assert result == pytest.approx(0.99)

    def test_accuracy_is_floored_at_point_one(self):
        result = compute_prediction_accuracy(10_000, 10_000, 100_000, 100_000)
        assert result == pytest.approx(0.1)


class TestPredictionConfidence:
    def test_minimum_sats_maps_to_10_percent(self):
        result = compute_prediction_confidence(1_000, 1_000, 10_000)
        assert result == pytest.approx(0.1)

    def test_maximum_sats_maps_to_100_percent(self):
        result = compute_prediction_confidence(10_000, 1_000, 10_000)
        assert result == pytest.approx(1.0)

    def test_mid_range_sats_interpolates_linearly(self):
        result = compute_prediction_confidence(3_400, 1_000, 10_000)
        assert result == pytest.approx(0.34)

    def test_below_minimum_is_clamped(self):
        result = compute_prediction_confidence(500, 1_000, 10_000)
        assert result == pytest.approx(0.1)

    def test_above_maximum_is_clamped(self):
        result = compute_prediction_confidence(12_000, 1_000, 10_000)
        assert result == pytest.approx(1.0)


class TestUserScores:
    def test_user_accuracy_is_average_prediction_accuracy(self):
        result = compute_user_accuracy([1.0, 0.8, 0.4])
        assert result == pytest.approx((1.0 + 0.8 + 0.4) / 3)

    def test_user_accuracy_defaults_when_no_history_exists(self):
        assert compute_user_accuracy([]) == pytest.approx(0.5)

    def test_user_congruency_is_high_when_average_confidence_matches_accuracy(self):
        result = compute_user_congruency([0.4, 0.6], [0.45, 0.55])
        assert result == pytest.approx(1.0)

    def test_user_congruency_drops_as_confidence_and_accuracy_diverge(self):
        result = compute_user_congruency([0.9, 0.9], [0.2, 0.2])
        assert result == pytest.approx(0.3)

    def test_user_congruency_defaults_when_no_history_exists(self):
        assert compute_user_congruency([], []) == pytest.approx(0.5)


class TestRoundConfidence:
    def test_real_user_confidence_uses_requested_formula(self):
        result = compute_real_user_confidence(0.34, 0.8, 0.5)
        assert result == pytest.approx(0.544)

    def test_real_user_confidence_is_capped_at_100_percent(self):
        result = compute_real_user_confidence(1.0, 1.0, 0.1)
        assert result == pytest.approx(1.0)

    def test_round_confidence_is_average_of_real_user_confidences(self):
        result = compute_round_confidence([0.408, 0.84])
        assert result == pytest.approx(0.624)

    def test_round_confidence_defaults_to_neutral_without_participants(self):
        assert compute_round_confidence([]) == pytest.approx(0.5)
