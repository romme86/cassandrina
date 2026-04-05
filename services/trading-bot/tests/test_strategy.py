"""
Tests for strategy selection helpers.
"""

import pytest

from cassandrina.exchange import ExchangePlatform
from cassandrina.strategy import (
    Strategy,
    get_direction,
    get_exchange_leverage,
    get_grid_midpoint,
    get_leverage,
    select_strategy,
)


class TestStrategySelection:
    def test_confidence_point_65_selects_A(self):
        assert select_strategy(0.65) == Strategy.A

    def test_confidence_one_selects_A(self):
        assert select_strategy(1.0) == Strategy.A

    def test_confidence_point_64_selects_B(self):
        assert select_strategy(0.64) == Strategy.B

    def test_confidence_point_55_selects_B(self):
        assert select_strategy(0.55) == Strategy.B

    def test_confidence_point_54_selects_C(self):
        assert select_strategy(0.54) == Strategy.C

    def test_confidence_point_45_selects_C(self):
        assert select_strategy(0.45) == Strategy.C

    def test_confidence_point_44_selects_D(self):
        assert select_strategy(0.44) == Strategy.D

    def test_confidence_point_35_selects_D(self):
        assert select_strategy(0.35) == Strategy.D

    def test_confidence_point_34_selects_E(self):
        assert select_strategy(0.34) == Strategy.E

    def test_confidence_point_10_selects_E(self):
        assert select_strategy(0.10) == Strategy.E


class TestGetDirection:
    def test_target_above_current_is_long(self):
        assert get_direction(current_price=90_000, target_price=95_000) == "long"

    def test_target_below_current_is_short(self):
        assert get_direction(current_price=95_000, target_price=90_000) == "short"

    def test_equal_prices_defaults_to_long(self):
        assert get_direction(current_price=90_000, target_price=90_000) == "long"


class TestGetLeverage:
    def test_strategy_a_default_leverage_is_30(self):
        assert get_leverage(Strategy.A) == 30

    def test_strategy_b_default_leverage_is_20(self):
        assert get_leverage(Strategy.B) == 20

    def test_non_futures_strategies_use_no_leverage(self):
        assert get_leverage(Strategy.C) == 1
        assert get_leverage(Strategy.D) == 1
        assert get_leverage(Strategy.E) == 1

    def test_hyperliquid_leverage_profile_is_lower(self):
        assert get_exchange_leverage(Strategy.A, ExchangePlatform.HYPERLIQUID) == 5
        assert get_exchange_leverage(Strategy.B, ExchangePlatform.HYPERLIQUID) == 3
        assert get_exchange_leverage(Strategy.E, ExchangePlatform.HYPERLIQUID) == 1


class TestGetGridMidpoint:
    def test_midpoint_is_20_percent_toward_target_for_long(self):
        result = get_grid_midpoint(current_price=90_000, target_price=100_000)
        assert result == pytest.approx(92_000.0)

    def test_midpoint_is_20_percent_toward_target_for_short(self):
        result = get_grid_midpoint(current_price=100_000, target_price=90_000)
        assert result == pytest.approx(98_000.0)
