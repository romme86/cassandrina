"""
TDD — Strategy Selector tests.
Covers: boundary values, long/short direction, leverage bounds, grid midpoint.
Run: pytest tests/test_strategy.py
"""

import pytest
from cassandrina.strategy import (
    select_strategy,
    get_direction,
    get_leverage,
    get_grid_midpoint,
    Strategy,
)


# ── Strategy selection at exact boundary values ──────────────

class TestStrategySelection:
    def test_confidence_65_selects_A(self):
        assert select_strategy(65.0) == Strategy.A

    def test_confidence_100_selects_A(self):
        assert select_strategy(100.0) == Strategy.A

    def test_confidence_64_selects_B(self):
        assert select_strategy(64.0) == Strategy.B

    def test_confidence_55_selects_B(self):
        assert select_strategy(55.0) == Strategy.B

    def test_confidence_54_selects_C(self):
        assert select_strategy(54.0) == Strategy.C

    def test_confidence_45_selects_C(self):
        assert select_strategy(45.0) == Strategy.C

    def test_confidence_44_selects_D(self):
        assert select_strategy(44.0) == Strategy.D

    def test_confidence_35_selects_D(self):
        assert select_strategy(35.0) == Strategy.D

    def test_confidence_34_selects_E(self):
        assert select_strategy(34.0) == Strategy.E

    def test_confidence_0_selects_E(self):
        assert select_strategy(0.0) == Strategy.E


# ── Direction (long / short) ─────────────────────────────────

class TestGetDirection:
    def test_target_above_current_is_long(self):
        assert get_direction(current_price=90_000, target_price=95_000) == "long"

    def test_target_below_current_is_short(self):
        assert get_direction(current_price=95_000, target_price=90_000) == "short"

    def test_equal_prices_is_long(self):
        # Default to long when equal
        assert get_direction(current_price=90_000, target_price=90_000) == "long"


# ── Leverage bounds ──────────────────────────────────────────

class TestGetLeverage:
    def test_strategy_A_leverage_between_20_and_40(self):
        lev = get_leverage(Strategy.A)
        assert 20 <= lev <= 40

    def test_strategy_A_default_leverage_is_30(self):
        # Midpoint of 20–40
        assert get_leverage(Strategy.A) == 30

    def test_strategy_B_leverage_max_20(self):
        lev = get_leverage(Strategy.B)
        assert lev <= 20
        assert lev >= 1

    def test_strategy_B_default_leverage_is_20(self):
        assert get_leverage(Strategy.B) == 20

    def test_strategy_C_leverage_is_1(self):
        # Grid — no leverage
        assert get_leverage(Strategy.C) == 1

    def test_strategy_D_leverage_is_1(self):
        # Spot — no leverage
        assert get_leverage(Strategy.D) == 1

    def test_strategy_E_leverage_is_1(self):
        # Spot — no leverage
        assert get_leverage(Strategy.E) == 1


# ── Grid midpoint for Strategy C ────────────────────────────

class TestGetGridMidpoint:
    def test_midpoint_20_percent_of_distance(self):
        # |90_000 → 100_000| = 10_000; 20% = 2_000; midpoint = 90_000 + 2_000 = 92_000
        result = get_grid_midpoint(current_price=90_000, target_price=100_000)
        assert result == pytest.approx(92_000.0)

    def test_midpoint_short_direction(self):
        # |100_000 → 90_000| = 10_000; 20% = 2_000; midpoint = 100_000 - 2_000 = 98_000
        result = get_grid_midpoint(current_price=100_000, target_price=90_000)
        assert result == pytest.approx(98_000.0)

    def test_midpoint_zero_distance(self):
        result = get_grid_midpoint(current_price=90_000, target_price=90_000)
        assert result == pytest.approx(90_000.0)
