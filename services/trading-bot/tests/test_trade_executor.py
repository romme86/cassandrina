"""
TDD — Trade Executor integration tests.
Tests that the correct Binance operations are triggered for each strategy.
Run: pytest tests/test_trade_executor.py
"""

import pytest
from unittest.mock import MagicMock, patch
from cassandrina.strategy import Strategy
from cassandrina.trade_executor import TradeExecutor


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.futures_order = MagicMock(return_value={"orderId": "futures-1"})
    client.spot_buy = MagicMock(return_value={"orderId": "spot-1"})
    client.set_take_profit = MagicMock(return_value={"orderId": "tp-1"})
    client.place_grid_orders = MagicMock(return_value=[{"orderId": "grid-1"}])
    client.cancel_all_orders = MagicMock(return_value=None)
    return client


@pytest.fixture
def executor(mock_client):
    return TradeExecutor(binance_client=mock_client, symbol="BTCUSDT")


class TestStrategyAExecution:
    def test_strategy_A_places_futures_long_30x(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.A,
            direction="long",
            current_price=90_000,
            target_price=100_000,
            sats_deployed=5000,
        )
        mock_client.futures_order.assert_called_once()
        call_kwargs = mock_client.futures_order.call_args.kwargs
        assert call_kwargs["leverage"] == 30
        assert call_kwargs["side"] == "long"

    def test_strategy_A_places_futures_short_30x(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.A,
            direction="short",
            current_price=100_000,
            target_price=90_000,
            sats_deployed=5000,
        )
        mock_client.futures_order.assert_called_once()
        assert mock_client.futures_order.call_args.kwargs["side"] == "short"


class TestStrategyBExecution:
    def test_strategy_B_places_futures_20x(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.B,
            direction="long",
            current_price=90_000,
            target_price=95_000,
            sats_deployed=3000,
        )
        mock_client.futures_order.assert_called_once()
        assert mock_client.futures_order.call_args.kwargs["leverage"] == 20


class TestStrategyCExecution:
    def test_strategy_C_places_grid_orders(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.C,
            direction="long",
            current_price=90_000,
            target_price=100_000,
            sats_deployed=2000,
        )
        mock_client.place_grid_orders.assert_called_once()
        assert not mock_client.futures_order.called


class TestStrategyEExecution:
    def test_strategy_E_places_spot_buy(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.E,
            direction="long",
            current_price=90_000,
            target_price=92_000,
            sats_deployed=1000,
        )
        mock_client.spot_buy.assert_called_once()
        assert not mock_client.futures_order.called

    def test_strategy_E_sets_2pct_take_profit(self, executor, mock_client):
        executor.execute(
            strategy=Strategy.E,
            direction="long",
            current_price=90_000,
            target_price=92_000,
            sats_deployed=1000,
        )
        mock_client.set_take_profit.assert_called_once()
        tp_price = mock_client.set_take_profit.call_args.kwargs["tp_price"]
        # 2% above current
        assert tp_price == pytest.approx(90_000 * 1.02)
