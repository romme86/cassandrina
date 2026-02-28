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
import numpy as np
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

    # ── Grid ─────────────────────────────────────────────────

    def place_grid_orders(
        self,
        symbol: str,
        lower_price: float,
        upper_price: float,
        num_grids: int,
        quantity_per_grid: float,
    ) -> list[dict]:
        """Place *num_grids* limit buy orders evenly spaced between lower and upper price."""
        prices = np.linspace(lower_price, upper_price, num_grids)
        results = []
        for price in prices:
            result = self._safe_call(
                self._client.create_order,
                symbol=symbol,
                side="BUY",
                type="LIMIT",
                timeInForce="GTC",
                quantity=quantity_per_grid,
                price=round(float(price), 2),
            )
            results.append(result)
        return results

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
