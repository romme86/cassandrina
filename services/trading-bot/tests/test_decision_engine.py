"""
Decision engine tests.
"""

import pytest

from cassandrina.decision_engine import (
    DecisionConfig,
    PolymarketSignal,
    build_strategy_decision,
    build_user_market_view,
)
from cassandrina.strategy import Strategy


def participant(
    *,
    low: float,
    high: float,
    mid: float,
    sats: int,
    accuracy: float,
    congruency: float = 50.0,
) -> dict:
    return {
        "predicted_low_price": low,
        "predicted_high_price": high,
        "predicted_price": mid,
        "sats_amount": sats,
        "accuracy": accuracy,
        "congruency": congruency,
    }


class TestUserMarketView:
    def test_bad_predictors_pull_interpreted_range_away_from_their_range(self):
        participants = [
            participant(low=90_000, high=110_000, mid=100_000, sats=2000, accuracy=80),
            participant(low=120_000, high=130_000, mid=125_000, sats=2000, accuracy=20),
        ]
        view = build_user_market_view(participants, current_price=100_000)
        assert view.low < 90_000
        assert view.high < 110_000
        assert view.mid < 100_000

    def test_neutral_accuracy_falls_back_to_plain_sats_weighting(self):
        participants = [
            participant(low=90_000, high=100_000, mid=95_000, sats=1000, accuracy=50),
            participant(low=100_000, high=110_000, mid=105_000, sats=3000, accuracy=50),
        ]
        view = build_user_market_view(participants, current_price=102_000)
        assert view.low == pytest.approx(97_500.0)
        assert view.high == pytest.approx(107_500.0)
        assert view.mid == pytest.approx(102_500.0)
        assert view.metrics["fallback_to_sats_weighted"] is True

    def test_good_predictors_dominate_when_outnumbered(self):
        participants = [
            participant(low=94_000, high=108_000, mid=101_000, sats=3000, accuracy=88),
            participant(low=80_000, high=85_000, mid=82_500, sats=1000, accuracy=15),
            participant(low=82_000, high=87_000, mid=84_500, sats=1000, accuracy=10),
        ]
        view = build_user_market_view(participants, current_price=100_000)
        assert view.mid > 100_000
        assert view.direction == "long"

    def test_grid_eligible_balanced_range(self):
        participants = [
            participant(low=95_000, high=105_000, mid=100_000, sats=4000, accuracy=90, congruency=70),
            participant(low=96_000, high=104_000, mid=100_000, sats=2000, accuracy=75, congruency=60),
        ]
        view = build_user_market_view(participants, current_price=100_000, config=DecisionConfig())
        assert view.grid_eligible is True
        assert view.grid_order_count == 7


class TestStrategyDecision:
    def test_polymarket_modulates_confidence_but_not_direction(self):
        participants = [
            participant(low=95_000, high=112_000, mid=104_000, sats=4000, accuracy=82, congruency=80),
            participant(low=96_000, high=110_000, mid=103_000, sats=2000, accuracy=78, congruency=75),
        ]
        view = build_user_market_view(participants, current_price=100_000)
        pm_signal = PolymarketSignal(
            available=True,
            aligned_probability=0.20,
            alignment_score=20.0,
            trade_imbalance_score=25.0,
            price_momentum_score=30.0,
        )
        decision = build_strategy_decision(view, current_price=100_000, polymarket_signal=pm_signal)
        assert decision.direction == "long"
        assert decision.confidence_score < decision.user_confidence_score
        assert decision.polymarket_influence_pct > 0

    def test_grid_strategy_uses_interpreted_bounds(self):
        participants = [
            participant(low=98_000, high=102_000, mid=100_000, sats=4000, accuracy=85, congruency=65),
            participant(low=97_500, high=102_500, mid=100_000, sats=3000, accuracy=75, congruency=60),
        ]
        view = build_user_market_view(participants, current_price=100_000, config=DecisionConfig())
        decision = build_strategy_decision(view, current_price=100_000)
        assert decision.strategy == Strategy.C
        assert decision.grid_lower_price == pytest.approx(view.low)
        assert decision.grid_upper_price == pytest.approx(view.high)
        assert decision.take_profit_price is None
        assert decision.stop_loss_price is None

    def test_directional_strategy_uses_directional_futures_tiers(self):
        participants = [
            participant(low=94_000, high=120_000, mid=110_000, sats=5000, accuracy=92, congruency=90),
            participant(low=95_000, high=118_000, mid=108_000, sats=3000, accuracy=86, congruency=80),
        ]
        view = build_user_market_view(participants, current_price=100_000)
        decision = build_strategy_decision(view, current_price=100_000)
        assert decision.strategy in {Strategy.A, Strategy.B, Strategy.D, Strategy.E}
        assert decision.strategy != Strategy.C
        assert decision.leverage >= 5
        assert decision.take_profit_price is not None
        assert decision.stop_loss_price is not None
