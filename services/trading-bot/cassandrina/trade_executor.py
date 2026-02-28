"""
Trade Executor for Cassandrina.

Bridges the strategy selector and Binance client: given a Strategy,
direction, prices and sats_deployed, dispatches the correct orders.
"""

from __future__ import annotations

from cassandrina.binance_client import BinanceClientWrapper
from cassandrina.strategy import Strategy, get_leverage, get_grid_midpoint, TAKE_PROFIT_PCT

# BTC quantity precision on Binance (0.001 minimum lot size)
_BTC_LOT_SIZE = 0.001

# Approximate BTC/USDT conversion factor (updated at runtime via market price)
# For sizing, we use sats_deployed as a fraction of sats per BTC
_SATS_PER_BTC = 100_000_000


def _sats_to_btc(sats: int) -> float:
    """Convert sats to BTC, rounded to lot size."""
    btc = sats / _SATS_PER_BTC
    # Ensure at minimum lot size
    return max(round(btc, 3), _BTC_LOT_SIZE)


class TradeExecutor:
    def __init__(self, binance_client: BinanceClientWrapper, symbol: str = "BTCUSDT"):
        self._client = binance_client
        self.symbol = symbol

    def execute(
        self,
        strategy: Strategy,
        direction: str,
        current_price: float,
        target_price: float,
        sats_deployed: int,
    ) -> dict:
        """
        Execute the appropriate Binance operation for *strategy*.

        Returns a dict with the opened order info and metadata.
        """
        quantity = _sats_to_btc(sats_deployed)

        if strategy in (Strategy.A, Strategy.B):
            return self._execute_futures(strategy, direction, quantity)

        if strategy == Strategy.C:
            return self._execute_grid(current_price, target_price, quantity)

        # Strategy D or E — spot with TP
        return self._execute_spot(strategy, direction, current_price, quantity)

    def _execute_futures(
        self,
        strategy: Strategy,
        direction: str,
        quantity: float,
    ) -> dict:
        leverage = get_leverage(strategy)
        order = self._client.futures_order(
            symbol=self.symbol,
            side=direction,
            quantity=quantity,
            leverage=leverage,
        )
        return {"type": "futures", "order": order, "strategy": strategy.value}

    def _execute_grid(
        self,
        current_price: float,
        target_price: float,
        quantity: float,
    ) -> dict:
        midpoint = get_grid_midpoint(current_price, target_price)
        lower = min(current_price, midpoint)
        upper = max(current_price, midpoint)
        orders = self._client.place_grid_orders(
            symbol=self.symbol,
            lower_price=lower,
            upper_price=upper,
            num_grids=5,
            quantity_per_grid=round(quantity / 5, 3),
        )
        return {"type": "grid", "orders": orders, "strategy": Strategy.C.value}

    def _execute_spot(
        self,
        strategy: Strategy,
        direction: str,
        current_price: float,
        quantity: float,
    ) -> dict:
        order = self._client.spot_buy(symbol=self.symbol, quantity=quantity)

        tp_pct = TAKE_PROFIT_PCT[strategy]
        if tp_pct > 0 and direction == "long":
            tp_price = current_price * (1 + tp_pct / 100)
        elif tp_pct > 0 and direction == "short":
            tp_price = current_price * (1 - tp_pct / 100)
        else:
            tp_price = None

        tp_order = None
        if tp_price is not None:
            tp_order = self._client.set_take_profit(
                symbol=self.symbol,
                side=direction,
                quantity=quantity,
                tp_price=tp_price,
            )

        return {
            "type": "spot",
            "order": order,
            "tp_order": tp_order,
            "strategy": strategy.value,
        }
