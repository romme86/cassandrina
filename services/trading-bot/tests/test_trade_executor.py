"""
Trade executor tests.
"""

from unittest.mock import MagicMock

import pytest

from cassandrina.exchange import ExchangePlatform, QuantizedOrderSize
from cassandrina.strategy import Strategy
from cassandrina.trade_executor import TradeExecutor


@pytest.fixture
def mock_binance_client():
    client = MagicMock()
    client.platform = ExchangePlatform.BINANCE
    client.get_market_meta.return_value = MagicMock(size_decimals=3, min_size_btc=0.001)
    client.quantize_btc_amount.return_value = QuantizedOrderSize(
        raw_btc=0.005,
        quantity_btc=0.005,
        min_size_btc=0.001,
    )
    client.futures_order.return_value = {"orderId": "futures-1"}
    client.set_stop_loss.return_value = {"orderId": "sl-1"}
    client.set_take_profit.return_value = {"orderId": "tp-1"}
    client.place_grid_orders.return_value = [
        {"orderId": "grid-1", "side": "BUY", "price": 91000},
        {"orderId": "grid-2", "side": "BUY", "price": 92000},
        {"orderId": "grid-3", "side": "BUY", "price": 93000},
        {"orderId": "grid-4", "side": "SELL", "price": 94000},
        {"orderId": "grid-5", "side": "SELL", "price": 95000},
    ]
    client.close_futures_position.return_value = {"orderId": "close-1"}
    return client


@pytest.fixture
def mock_hyperliquid_client():
    client = MagicMock()
    client.platform = ExchangePlatform.HYPERLIQUID
    client.get_market_meta.return_value = MagicMock(size_decimals=5, min_size_btc=0.00001)
    client.quantize_btc_amount.return_value = QuantizedOrderSize(
        raw_btc=0.00005,
        quantity_btc=0.00005,
        min_size_btc=0.00001,
    )
    client.futures_order.return_value = {"orderId": "hl-entry"}
    client.set_stop_loss.return_value = {"orderId": "hl-sl"}
    client.set_take_profit.return_value = {"orderId": "hl-tp"}
    client.place_grid_orders.return_value = [{"orderId": "hl-grid", "side": "BUY", "price": 92000}] * 5
    return client


def test_strategy_a_uses_binance_default_leverage(mock_binance_client):
    executor = TradeExecutor(client=mock_binance_client, symbol="BTCUSDT")

    executor.execute(
        strategy=Strategy.A,
        direction="long",
        current_price=90_000,
        target_price=100_000,
        sats_deployed=500_000,
    )

    kwargs = mock_binance_client.futures_order.call_args.kwargs
    assert kwargs["leverage"] == 30
    assert kwargs["side"] == "long"


def test_strategy_a_uses_hyperliquid_lower_leverage(mock_hyperliquid_client):
    executor = TradeExecutor(client=mock_hyperliquid_client, symbol="BTCUSDT")

    executor.execute(
        strategy=Strategy.A,
        direction="short",
        current_price=100_000,
        target_price=90_000,
        sats_deployed=5_000,
    )

    kwargs = mock_hyperliquid_client.futures_order.call_args.kwargs
    assert kwargs["leverage"] == 5
    assert kwargs["side"] == "short"


def test_strategy_c_places_grid_orders(mock_binance_client):
    executor = TradeExecutor(client=mock_binance_client, symbol="BTCUSDT")

    result = executor.execute(
        strategy=Strategy.C,
        direction="long",
        current_price=90_000,
        target_price=100_000,
        sats_deployed=500_000,
    )

    mock_binance_client.place_grid_orders.assert_called_once()
    assert result["type"] == "grid"
    assert len(result["orders"]) == 5


def test_strategy_e_on_hyperliquid_uses_perp_not_spot(mock_hyperliquid_client):
    executor = TradeExecutor(client=mock_hyperliquid_client, symbol="BTCUSDT")

    result = executor.execute(
        strategy=Strategy.E,
        direction="long",
        current_price=90_000,
        target_price=92_000,
        sats_deployed=5_000,
    )

    mock_hyperliquid_client.futures_order.assert_called_once()
    assert not mock_hyperliquid_client.spot_buy.called
    assert result["type"] == "perp"


def test_skips_when_venue_minimum_is_not_met(mock_hyperliquid_client):
    mock_hyperliquid_client.quantize_btc_amount.return_value = QuantizedOrderSize(
        raw_btc=0.0,
        quantity_btc=0.0,
        min_size_btc=0.00001,
        skipped=True,
        reason="pool too small for Hyperliquid minimum size increment",
    )
    executor = TradeExecutor(client=mock_hyperliquid_client, symbol="BTCUSDT")

    result = executor.execute(
        strategy=Strategy.E,
        direction="long",
        current_price=90_000,
        target_price=92_000,
        sats_deployed=100,
    )

    assert result["type"] == "skipped"
    assert "Hyperliquid" in result["reason"]
