"""
Schema tests for Cassandrina TimescaleDB.
Run against a live TimescaleDB instance:
  pytest infrastructure/configs/timescaledb/test_schema.py
Requires: DATABASE_URL env var pointing to a running TimescaleDB.
"""

import os
import pytest
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://cassandrina:changeme@localhost:5432/cassandrina",
)


@pytest.fixture(scope="module")
def conn():
    connection = psycopg2.connect(DATABASE_URL)
    yield connection
    connection.close()


@pytest.fixture(scope="module")
def cur(conn):
    with conn.cursor(cursor_factory=RealDictCursor) as cursor:
        yield cursor


def table_exists(cur, table_name):
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = %s)",
        (table_name,),
    )
    return cur.fetchone()["exists"]


def column_exists(cur, table_name, column_name):
    cur.execute(
        """SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = %s AND column_name = %s
        )""",
        (table_name, column_name),
    )
    return cur.fetchone()["exists"]


def is_hypertable(cur, table_name):
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = %s)",
        (table_name,),
    )
    return cur.fetchone()["exists"]


# ── Table existence ──────────────────────────────────────────

class TestTableExistence:
    def test_users_table_exists(self, cur):
        assert table_exists(cur, "users")

    def test_prediction_rounds_table_exists(self, cur):
        assert table_exists(cur, "prediction_rounds")

    def test_predictions_table_exists(self, cur):
        assert table_exists(cur, "predictions")

    def test_trades_table_exists(self, cur):
        assert table_exists(cur, "trades")

    def test_balance_entries_table_exists(self, cur):
        assert table_exists(cur, "balance_entries")

    def test_bot_config_table_exists(self, cur):
        assert table_exists(cur, "bot_config")


# ── Users columns ────────────────────────────────────────────

class TestUsersColumns:
    def test_has_id(self, cur):
        assert column_exists(cur, "users", "id")

    def test_has_platform(self, cur):
        assert column_exists(cur, "users", "platform")

    def test_has_platform_user_id(self, cur):
        assert column_exists(cur, "users", "platform_user_id")

    def test_has_display_name(self, cur):
        assert column_exists(cur, "users", "display_name")

    def test_has_accuracy_default_point_5(self, cur):
        cur.execute(
            "SELECT column_default FROM information_schema.columns WHERE table_name='users' AND column_name='accuracy'"
        )
        row = cur.fetchone()
        assert row is not None
        assert "0.5" in str(row["column_default"])

    def test_has_congruency_default_point_5(self, cur):
        cur.execute(
            "SELECT column_default FROM information_schema.columns WHERE table_name='users' AND column_name='congruency'"
        )
        row = cur.fetchone()
        assert row is not None
        assert "0.5" in str(row["column_default"])

    def test_has_joined_at(self, cur):
        assert column_exists(cur, "users", "joined_at")


# ── Prediction rounds columns ────────────────────────────────

class TestPredictionRoundsColumns:
    def test_has_question_date(self, cur):
        assert column_exists(cur, "prediction_rounds", "question_date")

    def test_has_target_hour(self, cur):
        assert column_exists(cur, "prediction_rounds", "target_hour")

    def test_has_polymarket_probability(self, cur):
        assert column_exists(cur, "prediction_rounds", "polymarket_probability")

    def test_has_status(self, cur):
        assert column_exists(cur, "prediction_rounds", "status")

    def test_has_btc_target_price(self, cur):
        assert column_exists(cur, "prediction_rounds", "btc_target_price")


# ── Predictions columns & hypertable ────────────────────────

class TestPredictionsTable:
    def test_has_round_id(self, cur):
        assert column_exists(cur, "predictions", "round_id")

    def test_has_user_id(self, cur):
        assert column_exists(cur, "predictions", "user_id")

    def test_has_lightning_invoice(self, cur):
        assert column_exists(cur, "predictions", "lightning_invoice")

    def test_has_paid(self, cur):
        assert column_exists(cur, "predictions", "paid")

    def test_is_hypertable(self, cur):
        assert is_hypertable(cur, "predictions")


# ── Trades columns & hypertable ──────────────────────────────

class TestTradesTable:
    def test_has_strategy(self, cur):
        assert column_exists(cur, "trades", "strategy")

    def test_has_direction(self, cur):
        assert column_exists(cur, "trades", "direction")

    def test_has_leverage(self, cur):
        assert column_exists(cur, "trades", "leverage")

    def test_has_pnl_sats(self, cur):
        assert column_exists(cur, "trades", "pnl_sats")

    def test_is_hypertable(self, cur):
        assert is_hypertable(cur, "trades")


# ── Balance entries hypertable ───────────────────────────────

class TestBalanceEntriesTable:
    def test_has_delta_sats(self, cur):
        assert column_exists(cur, "balance_entries", "delta_sats")

    def test_has_reason(self, cur):
        assert column_exists(cur, "balance_entries", "reason")

    def test_is_hypertable(self, cur):
        assert is_hypertable(cur, "balance_entries")


# ── Bot config defaults ──────────────────────────────────────

class TestBotConfigDefaults:
    def test_default_target_hour(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'prediction_target_hour'")
        assert cur.fetchone()["value"] == "16"

    def test_default_max_sats(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'max_sats'")
        assert cur.fetchone()["value"] == "10000"

    def test_default_pm_conf_weight_min_pct(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'pm_conf_weight_min_pct'")
        assert cur.fetchone()["value"] == "10"

    def test_default_pm_conf_weight_max_pct(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'pm_conf_weight_max_pct'")
        assert cur.fetchone()["value"] == "30"

    def test_default_pm_trade_window_minutes(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'pm_trade_window_minutes'")
        assert cur.fetchone()["value"] == "60"

    def test_default_pm_market_max_distance_pct(self, cur):
        cur.execute("SELECT value FROM bot_config WHERE key = 'pm_market_max_distance_pct'")
        assert cur.fetchone()["value"] == "5"
