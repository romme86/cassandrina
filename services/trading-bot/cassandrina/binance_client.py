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


class BinanceError(Exception):
    """Raised when the Binance API returns an error."""


class BinanceClientWrapper:
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

    def get_futures_position(self, symbol: str) -> dict | None:
        """Get current futures position for *symbol*. Returns None if no open position."""
        positions = self._safe_call(self._client.futures_position_information, symbol=symbol)
        for pos in positions:
            amt = float(pos.get("positionAmt", 0))
            if amt != 0:
                return {
                    "symbol": pos["symbol"],
                    "position_amt": amt,
                    "entry_price": float(pos.get("entryPrice", 0)),
                    "unrealized_pnl": float(pos.get("unRealizedProfit", 0)),
                    "leverage": int(pos.get("leverage", 1)),
                }
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
