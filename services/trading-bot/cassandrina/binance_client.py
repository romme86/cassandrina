"""
Binance client wrapper for Cassandrina.

Thin wrapper over python-binance providing spot buy, futures long/short,
take profit, grid orders, and order cancellation.

Required env vars:
    BINANCE_API_KEY
    BINANCE_API_SECRET
    BINANCE_TESTNET   — "true" / "false"
"""

from __future__ import annotations

import os
from binance.client import Client
from binance.exceptions import BinanceAPIException, BinanceRequestException

from cassandrina.exchange import (
    ExchangeError,
    ExchangePlatform,
    MarketMeta,
    PositionState,
    QuantizedOrderSize,
)

_BTC_LOT_SIZE = 0.001
_BTC_PRICE_DECIMALS = 2
_BTC_SIZE_DECIMALS = 3
_SATS_PER_BTC = 100_000_000


class BinanceError(ExchangeError):
    """Raised when the Binance API returns an error."""


class BinanceClientWrapper:
    platform = ExchangePlatform.BINANCE

    def __init__(
        self,
        api_key: str | None = None,
        api_secret: str | None = None,
        testnet: bool | None = None,
    ):
        self._api_key = api_key or os.environ["BINANCE_API_KEY"]
        self._api_secret = api_secret or os.environ["BINANCE_API_SECRET"]

        if testnet is None:
            testnet = os.environ.get("BINANCE_TESTNET", "true").lower() == "true"
        self._testnet = testnet

        self._client = Client(
            api_key=self._api_key,
            api_secret=self._api_secret,
            testnet=self._testnet,
        )

    def get_market_meta(self, symbol: str) -> MarketMeta:
        return MarketMeta(
            symbol=symbol,
            venue_symbol=symbol,
            min_size_btc=_BTC_LOT_SIZE,
            size_decimals=_BTC_SIZE_DECIMALS,
            price_decimals=_BTC_PRICE_DECIMALS,
            raw={"testnet": self._testnet},
        )

    def quantize_btc_amount(
        self,
        sats: int,
        *,
        symbol: str,
        leverage: int = 1,
        use_quote_minimum: bool = False,
        price_hint: float | None = None,
    ) -> QuantizedOrderSize:
        del symbol, leverage, use_quote_minimum, price_hint
        raw_btc = max(float(sats), 0.0) / _SATS_PER_BTC
        quantity = round(raw_btc, _BTC_SIZE_DECIMALS)
        if quantity < _BTC_LOT_SIZE:
            return QuantizedOrderSize(
                raw_btc=raw_btc,
                quantity_btc=0.0,
                min_size_btc=_BTC_LOT_SIZE,
                skipped=True,
                reason="pool too small for Binance minimum lot size",
            )
        return QuantizedOrderSize(
            raw_btc=raw_btc,
            quantity_btc=quantity,
            min_size_btc=_BTC_LOT_SIZE,
        )

    def _safe_call(self, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (BinanceAPIException, BinanceRequestException) as exc:
            raise BinanceError(str(exc)) from exc

    # ── Spot ─────────────────────────────────────────────────

    def spot_buy(self, symbol: str, quantity: float) -> dict:
        """Place a market spot buy order."""
        return self._safe_call(
            self._client.order_market_buy,
            symbol=symbol,
            quantity=quantity,
        )

    def spot_sell(self, symbol: str, quantity: float) -> dict:
        """Place a market spot sell order."""
        return self._safe_call(
            self._client.order_market_sell,
            symbol=symbol,
            quantity=quantity,
        )

    # ── Futures ──────────────────────────────────────────────

    def futures_order(
        self,
        symbol: str,
        side: str,          # "long" | "short"
        quantity: float,
        leverage: int,
    ) -> dict:
        """
        Open a futures position with the given leverage.
        Calls futures_change_leverage before placing the MARKET order.
        """
        self._safe_call(
            self._client.futures_change_leverage,
            symbol=symbol,
            leverage=leverage,
        )
        binance_side = "BUY" if side == "long" else "SELL"
        return self._safe_call(
            self._client.futures_create_order,
            symbol=symbol,
            side=binance_side,
            type="MARKET",
            quantity=quantity,
        )

    # ── Take Profit ──────────────────────────────────────────

    def set_take_profit(
        self,
        symbol: str,
        side: str,          # "long" | "short"
        quantity: float,
        tp_price: float,
    ) -> dict:
        """Place a LIMIT close order at tp_price."""
        close_side = "SELL" if side == "long" else "BUY"
        return self._safe_call(
            self._client.create_order,
            symbol=symbol,
            side=close_side,
            type="LIMIT",
            timeInForce="GTC",
            quantity=quantity,
            price=tp_price,
        )

    # ── Stop Loss ──────────────────────────────────────────────

    def set_stop_loss(
        self,
        symbol: str,
        side: str,          # "long" | "short"
        quantity: float,
        sl_price: float,
    ) -> dict:
        """Place a STOP_MARKET close order at sl_price (futures)."""
        close_side = "SELL" if side == "long" else "BUY"
        return self._safe_call(
            self._client.futures_create_order,
            symbol=symbol,
            side=close_side,
            type="STOP_MARKET",
            stopPrice=round(sl_price, 2),
            quantity=quantity,
            closePosition=False,
        )

    def set_spot_stop_loss(
        self,
        symbol: str,
        side: str,          # "long" | "short"
        quantity: float,
        sl_price: float,
    ) -> dict:
        """Place a STOP_LOSS_LIMIT order for spot positions."""
        close_side = "SELL" if side == "long" else "BUY"
        limit_price = round(sl_price * 0.995, 2) if side == "long" else round(sl_price * 1.005, 2)
        return self._safe_call(
            self._client.create_order,
            symbol=symbol,
            side=close_side,
            type="STOP_LOSS_LIMIT",
            timeInForce="GTC",
            quantity=quantity,
            price=limit_price,
            stopPrice=round(sl_price, 2),
        )

    # ── Close Position ────────────────────────────────────────

    def close_futures_position(self, symbol: str, side: str, quantity: float) -> dict:
        """Close a futures position with a market order."""
        close_side = "SELL" if side == "long" else "BUY"
        return self._safe_call(
            self._client.futures_create_order,
            symbol=symbol,
            side=close_side,
            type="MARKET",
            quantity=quantity,
            reduceOnly=True,
        )

    def cancel_all_futures_orders(self, symbol: str) -> None:
        """Cancel all open futures orders for *symbol*."""
        self._safe_call(
            self._client.futures_cancel_all_open_orders,
            symbol=symbol,
        )

    # ── Grid ─────────────────────────────────────────────────

    def place_grid_orders(
        self,
        symbol: str,
        lower_price: float,
        upper_price: float,
        num_grids: int,
        quantity_per_grid: float,
    ) -> list[dict]:
        """Place *num_grids* buy and sell limit orders evenly spaced between lower and upper price.

        Buy orders are placed below the midpoint, sell orders above.
        """
        step = (upper_price - lower_price) / max(num_grids - 1, 1)
        prices = [lower_price + step * i for i in range(num_grids)]
        midpoint = (lower_price + upper_price) / 2
        results = []
        for price in prices:
            side = "BUY" if price <= midpoint else "SELL"
            result = self._safe_call(
                self._client.create_order,
                symbol=symbol,
                side=side,
                type="LIMIT",
                timeInForce="GTC",
                quantity=quantity_per_grid,
                price=round(float(price), 2),
            )
            results.append(result)
        return results

    # ── Query ─────────────────────────────────────────────────

    def get_futures_income(
        self,
        symbol: str,
        income_type: str = "REALIZED_PNL",
        start_time: int | None = None,
    ) -> list[dict]:
        """Query futures income history (realized PnL, commissions, etc.)."""
        kwargs: dict = {"symbol": symbol, "incomeType": income_type, "limit": 100}
        if start_time is not None:
            kwargs["startTime"] = start_time
        return self._safe_call(self._client.futures_income_history, **kwargs)

    def get_spot_trades(self, symbol: str, start_time: int | None = None) -> list[dict]:
        """Query recent spot trades for *symbol*."""
        kwargs: dict = {"symbol": symbol, "limit": 100}
        if start_time is not None:
            kwargs["startTime"] = start_time
        return self._safe_call(self._client.get_my_trades, **kwargs)

    # ── Position Info ────────────────────────────────────────

    def get_futures_position(self, symbol: str) -> PositionState | None:
        """Get current futures position for *symbol*. Returns None if no open position."""
        positions = self._safe_call(self._client.futures_position_information, symbol=symbol)
        for pos in positions:
            amt = float(pos.get("positionAmt", 0))
            if amt != 0:
                return PositionState(
                    symbol=pos["symbol"],
                    quantity_btc=abs(amt),
                    entry_price=float(pos.get("entryPrice", 0)),
                    unrealized_pnl=float(pos.get("unRealizedProfit", 0)),
                    leverage=int(pos.get("leverage", 1)),
                    raw=dict(pos),
                )
        return None

    def get_spot_balance(self, asset: str = "BTC") -> float:
        """Get free spot balance for *asset*."""
        account = self._safe_call(self._client.get_account)
        for balance in account.get("balances", []):
            if balance["asset"] == asset:
                return float(balance["free"])
        return 0.0

    # ── Cancel ───────────────────────────────────────────────

    def cancel_all_orders(self, symbol: str) -> None:
        """Cancel all open spot orders for *symbol*."""
        open_orders = self._safe_call(self._client.get_open_orders, symbol=symbol)
        for order in open_orders:
            self._safe_call(
                self._client.cancel_order,
                symbol=symbol,
                orderId=order["orderId"],
            )

    def get_realized_pnl(
        self,
        symbol: str,
        *,
        strategy: str,
        direction: str,
        sats_deployed: int,
        opened_at_ms: int,
        current_btc_price: float,
    ) -> int | None:
        del sats_deployed
        try:
            if strategy in {"A", "B", "C", "D", "E"}:
                if strategy in {"A", "B"}:
                    incomes = self.get_futures_income(symbol=symbol, start_time=opened_at_ms)
                    realized = sum(float(item.get("income", 0.0)) for item in incomes)
                    if current_btc_price <= 0:
                        return None
                    return int(round((realized / current_btc_price) * _SATS_PER_BTC))

                trades = self.get_spot_trades(symbol=symbol, start_time=opened_at_ms)
                realized_usdt = 0.0
                close_side = "SELL" if direction == "long" else "BUY"
                for trade in trades:
                    if trade.get("isBuyer") == (close_side == "BUY"):
                        qty = float(trade.get("qty", 0.0))
                        price = float(trade.get("price", 0.0))
                        commission = float(trade.get("commission", 0.0))
                        realized_usdt += qty * price - commission
                if current_btc_price <= 0:
                    return None
                return int(round((realized_usdt / current_btc_price) * _SATS_PER_BTC))
        except BinanceError:
            raise
        except Exception as exc:
            raise BinanceError(str(exc)) from exc
        return None
