"""
TDD — Binance client tests.
All Binance SDK calls are mocked via pytest-mock.
Run: pytest tests/test_binance_client.py
"""

import pytest
from unittest.mock import MagicMock, patch, call
from cassandrina.binance_client import BinanceClientWrapper, BinanceError


@pytest.fixture
def mock_binance(mocker):
    """Patch the python-binance Client at import time."""
    mock_spot = mocker.patch("cassandrina.binance_client.Client")
    mock_futures = mocker.patch("cassandrina.binance_client.AsyncClient", create=True)
    return mock_spot


@pytest.fixture
def client(mock_binance):
    return BinanceClientWrapper(api_key="test_key", api_secret="test_secret", testnet=True)


# ── Spot orders ──────────────────────────────────────────────

class TestSpotBuy:
    def test_spot_buy_places_market_order(self, client):
        client._client.order_market_buy = MagicMock(return_value={"orderId": "111"})
        result = client.spot_buy(symbol="BTCUSDT", quantity=0.001)
        client._client.order_market_buy.assert_called_once_with(
            symbol="BTCUSDT", quantity=0.001
        )
        assert result["orderId"] == "111"

    def test_spot_buy_raises_on_api_error(self, client):
        from binance.exceptions import BinanceAPIException
        client._client.order_market_buy = MagicMock(
            side_effect=BinanceAPIException(MagicMock(status_code=400), 400, '{"code":-1013,"msg":"Invalid quantity"}')
        )
        with pytest.raises(BinanceError):
            client.spot_buy(symbol="BTCUSDT", quantity=0.0)


# ── Futures orders ───────────────────────────────────────────

class TestFuturesOrder:
    def test_futures_long_sets_leverage_and_places_order(self, client):
        client._client.futures_change_leverage = MagicMock(return_value={})
        client._client.futures_create_order = MagicMock(return_value={"orderId": "222"})

        result = client.futures_order(
            symbol="BTCUSDT",
            side="long",
            quantity=0.001,
            leverage=30,
        )
        client._client.futures_change_leverage.assert_called_once_with(
            symbol="BTCUSDT", leverage=30
        )
        order_call = client._client.futures_create_order.call_args
        assert order_call.kwargs["side"] == "BUY"
        assert result["orderId"] == "222"

    def test_futures_short_uses_sell_side(self, client):
        client._client.futures_change_leverage = MagicMock(return_value={})
        client._client.futures_create_order = MagicMock(return_value={"orderId": "333"})

        client.futures_order(symbol="BTCUSDT", side="short", quantity=0.001, leverage=20)
        order_call = client._client.futures_create_order.call_args
        assert order_call.kwargs["side"] == "SELL"

    def test_futures_order_raises_on_api_error(self, client):
        from binance.exceptions import BinanceAPIException
        client._client.futures_change_leverage = MagicMock(return_value={})
        client._client.futures_create_order = MagicMock(
            side_effect=BinanceAPIException(MagicMock(status_code=400), 400, '{"code":-2019,"msg":"Margin is insufficient"}')
        )
        with pytest.raises(BinanceError):
            client.futures_order(symbol="BTCUSDT", side="long", quantity=0.001, leverage=30)


# ── Take profit ──────────────────────────────────────────────

class TestSetTakeProfit:
    def test_spot_tp_places_limit_sell(self, client):
        client._client.create_order = MagicMock(return_value={"orderId": "444"})
        result = client.set_take_profit(
            symbol="BTCUSDT",
            side="long",
            quantity=0.001,
            tp_price=100_000,
        )
        call_kwargs = client._client.create_order.call_args.kwargs
        assert call_kwargs["side"] == "SELL"
        assert call_kwargs["type"] == "LIMIT"
        assert call_kwargs["price"] == 100_000

    def test_short_tp_places_limit_buy(self, client):
        client._client.create_order = MagicMock(return_value={"orderId": "555"})
        client.set_take_profit(
            symbol="BTCUSDT",
            side="short",
            quantity=0.001,
            tp_price=80_000,
        )
        call_kwargs = client._client.create_order.call_args.kwargs
        assert call_kwargs["side"] == "BUY"


# ── Grid orders ──────────────────────────────────────────────

class TestGridOrders:
    def test_grid_places_multiple_orders(self, client):
        client._client.create_order = MagicMock(return_value={"orderId": "666"})
        results = client.place_grid_orders(
            symbol="BTCUSDT",
            lower_price=90_000,
            upper_price=100_000,
            num_grids=5,
            quantity_per_grid=0.0002,
        )
        assert len(results) == 5
        assert client._client.create_order.call_count == 5

    def test_grid_orders_span_price_range(self, client):
        client._client.create_order = MagicMock(return_value={"orderId": "777"})
        client.place_grid_orders(
            symbol="BTCUSDT",
            lower_price=90_000,
            upper_price=100_000,
            num_grids=3,
            quantity_per_grid=0.0001,
        )
        prices = [c.kwargs["price"] for c in client._client.create_order.call_args_list]
        assert min(prices) >= 90_000
        assert max(prices) <= 100_000


# ── Cancel orders ────────────────────────────────────────────

class TestCancelOrders:
    def test_cancel_all_spot_orders(self, client):
        client._client.get_open_orders = MagicMock(
            return_value=[{"orderId": "1"}, {"orderId": "2"}]
        )
        client._client.cancel_order = MagicMock(return_value={})
        client.cancel_all_orders(symbol="BTCUSDT")
        assert client._client.cancel_order.call_count == 2

    def test_cancel_all_no_open_orders(self, client):
        client._client.get_open_orders = MagicMock(return_value=[])
        client._client.cancel_order = MagicMock()
        client.cancel_all_orders(symbol="BTCUSDT")
        client._client.cancel_order.assert_not_called()
