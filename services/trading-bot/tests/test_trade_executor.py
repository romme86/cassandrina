"""
Trade executor tests.
"""

import pytest
from unittest.mock import MagicMock

from cassandrina.decision_engine import StrategyDecision
from cassandrina.strategy import Strategy
from cassandrina.trade_executor import TradeExecutor


def make_decision(
    *,
    strategy: Strategy,
    direction: str = "long",
    leverage: int = 30,
    tp_price: float | None = None,
    sl_price: float | None = None,
    grid_lower_price: float | None = None,
    grid_upper_price: float | None = None,
    grid_order_count: int | None = None,
) -> StrategyDecision:
    return StrategyDecision(
        strategy=strategy,
        direction=direction,
        base_direction=direction,
        current_price=90_000,
        interpreted_low=88_000,
        interpreted_high=100_000,
        interpreted_mid=94_000,
        adjusted_low=88_000,
        adjusted_high=100_000,
        adjusted_mid=94_000,
        user_confidence_score=70.0,
        confidence_score=70.0,
        polymarket_influence_pct=0.0,
        leverage=leverage,
        take_profit_price=tp_price,
        stop_loss_price=sl_price,
        grid_lower_price=grid_lower_price,
        grid_upper_price=grid_upper_price,
        grid_order_count=grid_order_count,
        decision_metrics={},
    )


@pytest.fixture
def mock_client():
    client = MagicMock()
    client.futures_order = MagicMock(return_value={"orderId": "futures-1"})
    client.set_futures_take_profit = MagicMock(return_value={"orderId": "tp-1"})
    client.set_stop_loss = MagicMock(return_value={"orderId": "sl-1"})
    client.place_grid_orders = MagicMock(return_value=[{"orderId": "grid-1"}])
    client.cancel_all_orders = MagicMock(return_value=None)
    return client


@pytest.fixture
def executor(mock_client):
    return TradeExecutor(binance_client=mock_client, symbol="BTCUSDT")


class TestFuturesExecution:
    def test_strategy_A_places_futures_long_with_explicit_leverage(self, executor, mock_client):
        decision = make_decision(
            strategy=Strategy.A,
            leverage=30,
            tp_price=97_000,
            sl_price=88_000,
        )
        executor.execute(decision=decision, sats_deployed=200_000)
        mock_client.futures_order.assert_called_once()
        assert mock_client.futures_order.call_args.kwargs["leverage"] == 30
        mock_client.set_futures_take_profit.assert_called_once()
        mock_client.set_stop_loss.assert_called_once()

    def test_strategy_E_uses_futures_not_spot(self, executor, mock_client):
        decision = make_decision(
            strategy=Strategy.E,
            leverage=5,
            tp_price=92_500,
            sl_price=88_500,
        )
        executor.execute(decision=decision, sats_deployed=200_000)
        mock_client.futures_order.assert_called_once()
        assert mock_client.futures_order.call_args.kwargs["leverage"] == 5


class TestGridExecution:
    def test_strategy_C_places_grid_orders_with_decision_bounds(self, executor, mock_client):
        decision = make_decision(
            strategy=Strategy.C,
            leverage=1,
            grid_lower_price=90_000,
            grid_upper_price=100_000,
            grid_order_count=7,
        )
        executor.execute(decision=decision, sats_deployed=200_000)
        mock_client.place_grid_orders.assert_called_once()
        kwargs = mock_client.place_grid_orders.call_args.kwargs
        assert kwargs["lower_price"] == 90_000
        assert kwargs["upper_price"] == 100_000
        assert kwargs["num_grids"] == 7
        assert not mock_client.futures_order.called
