"""
Scheduler tests for the prediction lifecycle and scoring integration.
"""

from contextlib import nullcontext
from datetime import datetime
from unittest.mock import MagicMock, call

import pytest
from freezegun import freeze_time

from cassandrina.polymarket import PolymarketSignal
from cassandrina.scheduler import PredictionScheduler, RoundStatus, SchedulerConfig


@pytest.fixture
def config():
    return SchedulerConfig(
        scheduler_timezone="Europe/Rome",
        prediction_open_hour=8,
        prediction_target_hour=16,
        prediction_window_hours=6,
        weekly_vote_day=6,
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
    db.get_paid_predictions_count.return_value = 0
    db.get_round_status.return_value = RoundStatus.OPEN
    db.get_open_round.return_value = None
    db.get_rounds_for_settlement.return_value = []
    db.get_round_total_paid_sats.return_value = 0
    db.get_paid_predictions.return_value = []
    db.get_open_trade_for_round.return_value = None
    db.close_round = MagicMock()
    db.create_round.return_value = {
        "id": 1,
        "question_date": "2026-03-01",
        "target_hour": 16,
    }
    db.get_bot_config.return_value = {}
    db.connection.return_value = nullcontext()
    db.get_user_settled_prediction_history.return_value = []
    return db


@pytest.fixture
def scheduler(config, mock_redis, mock_db):
    return PredictionScheduler(config=config, redis_client=mock_redis, db=mock_db)


class TestPredictionWindowOpen:
    @freeze_time("2026-03-01 08:00:00 UTC")
    def test_opens_at_configured_hour(self, scheduler, mock_redis, mock_db):
        scheduler.open_prediction_window()
        mock_db.create_round.assert_called_once()
        mock_redis.publish.assert_called_once()
        channel, _ = mock_redis.publish.call_args.args
        assert "prediction:open" in channel

    def test_does_not_open_second_round_when_one_is_already_open(self, scheduler, mock_db):
        mock_db.get_open_round.return_value = {"id": 7}
        round_data = scheduler.open_prediction_window()
        assert round_data["id"] == 7
        mock_db.create_round.assert_not_called()


class TestPredictionWindowClose:
    def test_closes_after_paid_predictions_exist(self, scheduler, mock_db):
        mock_db.get_paid_predictions_count.return_value = 3
        scheduler.try_close_window(round_id=1)
        mock_db.close_round.assert_called_once_with(1)

    def test_does_not_close_without_paid_predictions(self, scheduler, mock_db):
        mock_db.get_paid_predictions_count.return_value = 0
        scheduler.try_close_window(round_id=1)
        mock_db.close_round.assert_not_called()


class TestWeeklyVote:
    def test_sends_weekly_vote_event(self, scheduler, mock_redis):
        scheduler.send_weekly_vote()
        channel, _ = mock_redis.publish.call_args.args
        assert "weekly:vote" in channel


class TestTradeExecution:
    def test_round_confidence_uses_real_user_confidence_formula(self, config, mock_redis, mock_db):
        market_data = MagicMock()
        market_data.get_btc_price.return_value = 100_000
        scheduler = PredictionScheduler(
            config=config,
            redis_client=mock_redis,
            db=mock_db,
            market_data_client=market_data,
        )
        mock_db.get_bot_config.return_value = {
            "min_sats": "1000",
            "max_sats": "10000",
            "trading_enabled": "false",
        }
        mock_db.get_paid_predictions.return_value = [
            {
                "user_id": 1,
                "predicted_low_price": 109_000,
                "predicted_high_price": 111_000,
                "predicted_price": 110_000,
                "sats_amount": 3400,
                "accuracy": 0.5,
                "congruency": 0.6,
            },
            {
                "user_id": 2,
                "predicted_low_price": 109_000,
                "predicted_high_price": 111_000,
                "predicted_price": 110_000,
                "sats_amount": 7000,
                "accuracy": 0.75,
                "congruency": 0.9,
            },
        ]
        mock_db.create_trade.return_value = {
            "id": 9,
            "strategy": "B",
            "direction": "long",
            "entry_price": 100_000,
            "target_price": 110_000,
            "sats_deployed": 10_400,
        }
        mock_db.get_weekly_vote_results.return_value = {}

        result = scheduler._execute_trade_for_round(1)

        assert result is not None
        assert result["confidence_score"] == pytest.approx(0.624)
        assert result["strategy"] == "B"
        assert result["direction"] == "long"
        mock_db.update_round_analysis.assert_called_once()

    def test_polymarket_signal_modifies_final_round_confidence(self, config, mock_redis, mock_db):
        market_data = MagicMock()
        market_data.get_btc_price.return_value = 100_000
        polymarket = MagicMock()
        polymarket.build_market_signal.return_value = PolymarketSignal(
            available=True,
            aligned_probability=0.2,
            alignment_score=20.0,
            trade_imbalance_score=25.0,
            price_momentum_score=30.0,
        )
        scheduler = PredictionScheduler(
            config=config,
            redis_client=mock_redis,
            db=mock_db,
            polymarket_client=polymarket,
            market_data_client=market_data,
        )
        mock_db.get_bot_config.return_value = {
            "min_sats": "1000",
            "max_sats": "10000",
            "pm_conf_weight_min_pct": "10",
            "pm_conf_weight_max_pct": "30",
            "pm_trade_window_minutes": "60",
            "pm_market_max_distance_pct": "5",
            "trading_enabled": "false",
        }
        mock_db.get_paid_predictions.return_value = [
            {
                "user_id": 1,
                "predicted_low_price": 109_000,
                "predicted_high_price": 111_000,
                "predicted_price": 110_000,
                "sats_amount": 3400,
                "accuracy": 0.5,
                "congruency": 0.6,
            },
            {
                "user_id": 2,
                "predicted_low_price": 109_000,
                "predicted_high_price": 111_000,
                "predicted_price": 110_000,
                "sats_amount": 7000,
                "accuracy": 0.75,
                "congruency": 0.9,
            },
        ]
        mock_db.create_trade.return_value = {
            "id": 11,
            "strategy": "C",
            "direction": "long",
            "entry_price": 100_000,
            "target_price": 110_000,
            "sats_deployed": 10_400,
        }
        mock_db.get_weekly_vote_results.return_value = {}

        result = scheduler._execute_trade_for_round(1)

        assert result is not None
        assert result["confidence_score"] == pytest.approx(0.5497152)
        assert result["strategy"] == "C"
        assert result["polymarket_influence_pct"] == pytest.approx(17.52)
        polymarket.build_market_signal.assert_called_once()
        _, kwargs = mock_db.update_round_analysis.call_args
        assert kwargs["polymarket_probability"] == pytest.approx(0.2)

    @freeze_time("2026-03-02 09:00:00")
    def test_weekly_vote_adjusts_round_confidence_from_weighted_results(self, config, mock_redis, mock_db):
        market_data = MagicMock()
        market_data.get_btc_price.return_value = 100_000
        scheduler = PredictionScheduler(
            config=config,
            redis_client=mock_redis,
            db=mock_db,
            market_data_client=market_data,
        )
        mock_db.get_bot_config.return_value = {
            "min_sats": "1000",
            "max_sats": "10000",
            "trading_enabled": "false",
        }
        mock_db.get_paid_predictions.return_value = [
            {
                "user_id": 1,
                "predicted_low_price": 109_000,
                "predicted_high_price": 111_000,
                "predicted_price": 110_000,
                "sats_amount": 5000,
                "accuracy": 0.5,
                "congruency": 0.5,
            }
        ]
        mock_db.create_trade.return_value = {
            "id": 10,
            "strategy": "B",
            "direction": "long",
            "entry_price": 100_000,
            "target_price": 110_000,
            "sats_deployed": 5000,
        }
        mock_db.get_weekly_vote_results.return_value = {"A": 2, "E": 1}

        result = scheduler._execute_trade_for_round(1)

        assert result is not None
        assert result["confidence_score"] == pytest.approx(0.55)
        assert result["strategy"] == "B"


class TestSettlement:
    def test_settlement_recomputes_user_scores_from_prediction_history(self, config, mock_redis, mock_db):
        market_data = MagicMock()
        market_data.get_btc_price.return_value = 100_500
        market_data.get_btc_day_range.return_value = (99_950, 101_100)
        scheduler = PredictionScheduler(
            config=config,
            redis_client=mock_redis,
            db=mock_db,
            market_data_client=market_data,
        )
        mock_db.get_bot_config.return_value = {
            "min_sats": "1000",
            "max_sats": "10000",
        }
        mock_db.get_rounds_for_settlement.return_value = [{"id": 1, "status": "closed"}]
        mock_db.get_paid_predictions.return_value = [
            {
                "user_id": 1,
                "predicted_low_price": 100_000,
                "predicted_high_price": 101_000,
                "predicted_price": 100_500,
                "sats_amount": 3400,
                "accuracy": 0.5,
                "congruency": 0.5,
            }
        ]
        mock_db.get_user_settled_prediction_history.return_value = [
            {
                "predicted_low_price": 100_000,
                "predicted_high_price": 101_000,
                "sats_amount": 3400,
                "btc_actual_low_price": 99_950,
                "btc_actual_high_price": 101_100,
            },
            {
                "predicted_low_price": 98_000,
                "predicted_high_price": 102_500,
                "sats_amount": 8000,
                "btc_actual_low_price": 98_100,
                "btc_actual_high_price": 102_000,
            },
        ]

        scheduler._job_settle_round()

        mock_db.settle_round_with_extremes.assert_called_once_with(
            1,
            actual_price=100_500,
            actual_low_price=99_950,
            actual_high_price=101_100,
        )
        mock_db.update_user_scores.assert_called_once()
        _, accuracy, congruency = mock_db.update_user_scores.call_args.args
        assert accuracy == pytest.approx(0.9981473253538242)
        assert congruency == pytest.approx(0.5718526746461758)

    def test_settlement_closes_each_round_with_extremes(self, config, mock_redis, mock_db):
        market_data = MagicMock()
        market_data.get_btc_price.return_value = 100_000
        market_data.get_btc_day_range.return_value = (99_000, 101_000)
        scheduler = PredictionScheduler(
            config=config,
            redis_client=mock_redis,
            db=mock_db,
            market_data_client=market_data,
        )
        mock_db.get_rounds_for_settlement.return_value = [
            {"id": 1, "status": "closed"},
            {"id": 2, "status": "closed"},
        ]

        scheduler._job_settle_round()

        assert mock_db.settle_round_with_extremes.call_args_list == [
            call(1, actual_price=100_000, actual_low_price=99_000, actual_high_price=101_000),
            call(2, actual_price=100_000, actual_low_price=99_000, actual_high_price=101_000),
        ]
