"""
TDD — Profit Distribution tests.
Covers: proportional distribution, weekly reinvestment, liquidation.
Run: pytest tests/test_profit.py
"""

import pytest
from cassandrina.profit import (
    distribute_profit,
    compute_weekly_reinvestment,
    apply_liquidation,
)


# ── distribute_profit ────────────────────────────────────────

class TestDistributeProfit:
    def test_equal_sats_equal_share(self):
        participants = [
            {"user_id": 1, "sats_invested": 1000},
            {"user_id": 2, "sats_invested": 1000},
        ]
        result = distribute_profit(total_pnl_sats=2000, participants=participants)
        assert result[1] == 1000
        assert result[2] == 1000

    def test_proportional_distribution(self):
        participants = [
            {"user_id": 1, "sats_invested": 1000},
            {"user_id": 2, "sats_invested": 3000},
        ]
        result = distribute_profit(total_pnl_sats=4000, participants=participants)
        assert result[1] == 1000   # 25%
        assert result[2] == 3000   # 75%

    def test_zero_gain_gives_zero_shares(self):
        participants = [
            {"user_id": 1, "sats_invested": 1000},
            {"user_id": 2, "sats_invested": 2000},
        ]
        result = distribute_profit(total_pnl_sats=0, participants=participants)
        assert result[1] == 0
        assert result[2] == 0

    def test_single_participant_gets_all(self):
        participants = [{"user_id": 1, "sats_invested": 500}]
        result = distribute_profit(total_pnl_sats=1000, participants=participants)
        assert result[1] == 1000

    def test_total_distributed_equals_total_pnl(self):
        participants = [
            {"user_id": 1, "sats_invested": 333},
            {"user_id": 2, "sats_invested": 333},
            {"user_id": 3, "sats_invested": 334},
        ]
        result = distribute_profit(total_pnl_sats=999, participants=participants)
        assert sum(result.values()) == 999

    def test_empty_participants_returns_empty(self):
        result = distribute_profit(total_pnl_sats=1000, participants=[])
        assert result == {}

    def test_loss_distribution_is_negative(self):
        participants = [
            {"user_id": 1, "sats_invested": 1000},
            {"user_id": 2, "sats_invested": 1000},
        ]
        result = distribute_profit(total_pnl_sats=-2000, participants=participants)
        assert result[1] == -1000
        assert result[2] == -1000


# ── compute_weekly_reinvestment ──────────────────────────────

class TestComputeWeeklyReinvestment:
    def test_weekly_profit_split_across_7_days(self):
        daily = compute_weekly_reinvestment(weekly_profit_sats=7000, days=7)
        assert daily == 1000

    def test_split_across_5_trading_days(self):
        daily = compute_weekly_reinvestment(weekly_profit_sats=5000, days=5)
        assert daily == 1000

    def test_zero_profit_gives_zero_daily(self):
        daily = compute_weekly_reinvestment(weekly_profit_sats=0, days=7)
        assert daily == 0

    def test_result_is_integer(self):
        daily = compute_weekly_reinvestment(weekly_profit_sats=1000, days=3)
        assert isinstance(daily, int)


# ── apply_liquidation ────────────────────────────────────────

class TestApplyLiquidation:
    def test_liquidation_zeroes_all_positions(self):
        positions = {1: 1000, 2: 2000, 3: 500}
        result = apply_liquidation(positions)
        assert all(v == 0 for v in result.values())

    def test_liquidation_preserves_user_ids(self):
        positions = {1: 1000, 2: 2000}
        result = apply_liquidation(positions)
        assert set(result.keys()) == {1, 2}

    def test_empty_positions_returns_empty(self):
        result = apply_liquidation({})
        assert result == {}
