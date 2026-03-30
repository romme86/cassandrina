"""
Strategy selector tests.
"""

from cassandrina.strategy import Strategy, get_direction, get_leverage, select_strategy


class TestStrategySelection:
    def test_confidence_80_selects_A(self):
        assert select_strategy(80.0) == Strategy.A

    def test_confidence_65_selects_B(self):
        assert select_strategy(65.0) == Strategy.B

    def test_confidence_64_selects_D(self):
        assert select_strategy(64.0) == Strategy.D

    def test_confidence_35_selects_D(self):
        assert select_strategy(35.0) == Strategy.D

    def test_confidence_34_selects_E(self):
        assert select_strategy(34.0) == Strategy.E


class TestGetDirection:
    def test_target_above_current_is_long(self):
        assert get_direction(current_price=90_000, target_price=95_000) == "long"

    def test_target_below_current_is_short(self):
        assert get_direction(current_price=95_000, target_price=90_000) == "short"

    def test_equal_prices_is_long(self):
        assert get_direction(current_price=90_000, target_price=90_000) == "long"


class TestGetLeverage:
    def test_strategy_A_leverage_is_30(self):
        assert get_leverage(Strategy.A) == 30

    def test_strategy_B_leverage_is_20(self):
        assert get_leverage(Strategy.B) == 20

    def test_strategy_C_leverage_is_1(self):
        assert get_leverage(Strategy.C) == 1

    def test_strategy_D_leverage_is_10(self):
        assert get_leverage(Strategy.D) == 10

    def test_strategy_E_leverage_is_5(self):
        assert get_leverage(Strategy.E) == 5
