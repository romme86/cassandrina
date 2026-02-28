"""
TDD — Scheduler tests.
Uses freezegun for time control and mocks Redis/APScheduler.
Run: pytest tests/test_scheduler.py
"""

import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime, timezone
from freezegun import freeze_time

from cassandrina.scheduler import (
    PredictionScheduler,
    SchedulerConfig,
    RoundStatus,
)


@pytest.fixture
def config():
    return SchedulerConfig(
        prediction_open_hour=8,
        prediction_target_hour=16,
        prediction_window_hours=6,
        weekly_vote_day=6,       # Sunday
        weekly_vote_hour=20,
        report_hours_before_target=8,
        min_paid_predictions=1,
    )


@pytest.fixture
def mock_redis():
    redis = MagicMock()
    redis.publish = MagicMock(return_value=1)
    return redis


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.get_paid_predictions_count = MagicMock(return_value=0)
    db.get_round_status = MagicMock(return_value=RoundStatus.OPEN)
    db.close_round = MagicMock()
    db.create_round = MagicMock(return_value={"id": 1})
    return db


@pytest.fixture
def scheduler(config, mock_redis, mock_db):
    return PredictionScheduler(config=config, redis_client=mock_redis, db=mock_db)


# ── Prediction window open ───────────────────────────────────

class TestPredictionWindowOpen:
    @freeze_time("2026-03-01 08:00:00 UTC")
    def test_opens_at_configured_hour(self, scheduler, mock_redis, mock_db):
        scheduler.open_prediction_window()
        mock_db.create_round.assert_called_once()
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args.args
        assert "prediction:open" in channel

    @freeze_time("2026-03-01 08:00:00 UTC")
    def test_publish_includes_round_info(self, scheduler, mock_redis, mock_db):
        scheduler.open_prediction_window()
        _, message = mock_redis.publish.call_args.args
        import json
        data = json.loads(message)
        assert "round_id" in data


# ── Prediction window close ──────────────────────────────────

class TestPredictionWindowClose:
    def test_closes_after_6_hours(self, scheduler, mock_redis, mock_db):
        mock_db.get_paid_predictions_count.return_value = 3
        scheduler.try_close_window(round_id=1)
        mock_db.close_round.assert_called_once_with(1)

    def test_does_not_close_without_paid_predictions(self, scheduler, mock_db):
        mock_db.get_paid_predictions_count.return_value = 0
        scheduler.try_close_window(round_id=1)
        mock_db.close_round.assert_not_called()

    def test_close_publishes_event(self, scheduler, mock_redis, mock_db):
        mock_db.get_paid_predictions_count.return_value = 2
        scheduler.try_close_window(round_id=1)
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args.args
        assert "prediction:close" in channel


# ── 8-hour notification trigger ──────────────────────────────

class TestEightHourNotification:
    @freeze_time("2026-03-01 08:00:00 UTC")
    def test_sends_stats_8h_event(self, scheduler, mock_redis):
        scheduler.send_8h_report(round_id=1)
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args.args
        assert "stats:8h" in channel


# ── Weekly vote trigger ───────────────────────────────────────

class TestWeeklyVote:
    @freeze_time("2026-03-01 20:00:00 UTC")   # Sunday 20:00 UTC
    def test_sends_weekly_vote_event(self, scheduler, mock_redis):
        scheduler.send_weekly_vote()
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args.args
        assert "weekly:vote" in channel

    def test_weekly_vote_includes_options(self, scheduler, mock_redis):
        scheduler.send_weekly_vote()
        _, message = mock_redis.publish.call_args.args
        import json
        data = json.loads(message)
        assert "options" in data


# ── Trade trigger after window closes ────────────────────────

class TestTradeTrigger:
    def test_close_triggers_confidence_then_trade(self, scheduler, mock_redis, mock_db):
        mock_db.get_paid_predictions_count.return_value = 1
        scheduler.on_trade_execute = MagicMock()
        scheduler.try_close_window(round_id=1)
        scheduler.on_trade_execute.assert_called_once_with(round_id=1)
