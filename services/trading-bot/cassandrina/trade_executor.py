"""
Trade Executor for Cassandrina.

Bridges the strategy selector and Binance client: given a Strategy,
direction, prices and sats_deployed, dispatches the correct orders.
"""

from __future__ import annotations

import logging

from cassandrina.binance_client import BinanceClientWrapper, BinanceError
from cassandrina.strategy import Strategy, get_leverage, get_grid_midpoint, TAKE_PROFIT_PCT, STOP_LOSS_PCT

logger = logging.getLogger(__name__)

# BTC quantity precision on Binance (0.001 minimum lot size)
_BTC_LOT_SIZE = 0.001

# Approximate BTC/USDT conversion factor (updated at runtime via market price)
# For sizing, we use sats_deployed as a fraction of sats per BTC
_SATS_PER_BTC = 100_000_000


def _usdt_to_sats(usdt_amount: float, btc_price: float) -> int:
    """Convert a USDT amount to satoshis using the current BTC price."""
    if btc_price <= 0:
        return 0
    btc_amount = usdt_amount / btc_price
    return int(round(btc_amount * _SATS_PER_BTC))


def _sats_to_btc(sats: int) -> float:
    """Convert sats to BTC, rounded to lot size.

    Returns 0.0 if the pool is too small for the minimum Binance lot size,
    so callers can decide whether to skip the trade.
    """
    btc = sats / _SATS_PER_BTC
    rounded = round(btc, 3)
    if rounded < _BTC_LOT_SIZE:
        return 0.0
    return rounded


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

        if quantity <= 0:
            return {
                "type": "skipped",
                "reason": "pool too small for minimum lot size",
                "strategy": strategy.value,
            }

        if strategy in (Strategy.A, Strategy.B):
            return self._execute_futures(strategy, direction, quantity, current_price)

        if strategy == Strategy.C:
            return self._execute_grid(current_price, target_price, quantity)

        # Strategy D or E — spot with TP
        return self._execute_spot(strategy, direction, current_price, quantity)

    def close_position(
        self,
        strategy: Strategy,
        direction: str,
        quantity_btc: float,
    ) -> dict:
        """Close an open position at settlement time."""
        if strategy in (Strategy.A, Strategy.B):
            self._client.cancel_all_futures_orders(symbol=self.symbol)
            order = self._client.close_futures_position(
                symbol=self.symbol,
                side=direction,
                quantity=quantity_btc,
            )
            return {"type": "futures_close", "order": order}

        if strategy == Strategy.C:
            self._client.cancel_all_orders(symbol=self.symbol)
            return {"type": "grid_cancelled"}

        # Spot D/E — sell remaining position
        self._client.cancel_all_orders(symbol=self.symbol)
        if direction == "long":
            order = self._client.spot_sell(symbol=self.symbol, quantity=quantity_btc)
        else:
            order = self._client.spot_buy(symbol=self.symbol, quantity=quantity_btc)
        return {"type": "spot_close", "order": order}

    def _execute_futures(
        self,
        strategy: Strategy,
        direction: str,
        quantity: float,
        current_price: float,
    ) -> dict:
        leverage = get_leverage(strategy)
        order = self._client.futures_order(
            symbol=self.symbol,
            side=direction,
            quantity=quantity,
            leverage=leverage,
        )

        sl_order = None
        sl_pct = STOP_LOSS_PCT[strategy]
        if sl_pct > 0:
            if direction == "long":
                sl_price = current_price * (1 - sl_pct / 100)
            else:
                sl_price = current_price * (1 + sl_pct / 100)
            sl_order = self._client.set_stop_loss(
                symbol=self.symbol,
                side=direction,
                quantity=quantity,
                sl_price=sl_price,
            )

        return {
            "type": "futures",
            "order": order,
            "sl_order": sl_order,
            "strategy": strategy.value,
        }

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
        if direction == "long":
            order = self._client.spot_buy(symbol=self.symbol, quantity=quantity)
        else:
            order = self._client.spot_sell(symbol=self.symbol, quantity=quantity)

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

        sl_order = None
        sl_pct = STOP_LOSS_PCT[strategy]
        if sl_pct > 0:
            if direction == "long":
                sl_price = current_price * (1 - sl_pct / 100)
            else:
                sl_price = current_price * (1 + sl_pct / 100)
            sl_order = self._client.set_spot_stop_loss(
                symbol=self.symbol,
                side=direction,
                quantity=quantity,
                sl_price=sl_price,
            )

        return {
            "type": "spot",
            "order": order,
            "tp_order": tp_order,
            "sl_order": sl_order,
            "strategy": strategy.value,
        }

    def reconcile_position(self, trade: dict) -> dict:
        """Compare local trade record against actual Binance state.

        Returns a dict with reconciliation results including any discrepancies.
        """
        strategy = Strategy(trade["strategy"])
        expected_qty = _sats_to_btc(int(trade["sats_deployed"]))
        result: dict = {"trade_id": trade["id"], "strategy": strategy.value, "discrepancies": []}

        try:
            if strategy in (Strategy.A, Strategy.B):
                pos = self._client.get_futures_position(self.symbol)
                if pos is None:
                    if trade["status"] == "open":
                        result["discrepancies"].append("DB shows open trade but no futures position on Binance")
                else:
                    actual_qty = abs(pos["position_amt"])
                    if abs(actual_qty - expected_qty) > _BTC_LOT_SIZE:
                        result["discrepancies"].append(
                            f"Position size mismatch: DB={expected_qty} BTC, Binance={actual_qty} BTC"
                        )
                    result["exchange_position"] = pos
            else:
                balance = self._client.get_spot_balance("BTC")
                result["spot_balance_btc"] = balance
        except (BinanceError, Exception):
            logger.exception("Reconciliation failed for trade %s", trade["id"])
            result["discrepancies"].append("Failed to query Binance")

        return result

    def get_realized_pnl(
        self,
        strategy: Strategy,
        direction: str,
        sats_deployed: int,
        opened_at_ms: int,
        current_btc_price: float,
    ) -> int | None:
        """Query Binance for actual realized PnL. Returns sats or None on failure."""
        try:
            if strategy in (Strategy.A, Strategy.B):
                return self._futures_realized_pnl(opened_at_ms, current_btc_price)
            return self._spot_realized_pnl(direction, opened_at_ms, current_btc_price)
        except (BinanceError, Exception):
            logger.exception("Failed to query realized PnL from Binance")
            return None

    def _futures_realized_pnl(self, opened_at_ms: int, btc_price: float) -> int:
        """Sum REALIZED_PNL and COMMISSION income entries since trade open."""
        entries = self._client.get_futures_income(
            symbol=self.symbol,
            income_type="REALIZED_PNL",
            start_time=opened_at_ms,
        )
        total_usdt = sum(float(e.get("income", 0)) for e in entries)
        commissions = self._client.get_futures_income(
            symbol=self.symbol,
            income_type="COMMISSION",
            start_time=opened_at_ms,
        )
        total_usdt += sum(float(e.get("income", 0)) for e in commissions)
        return _usdt_to_sats(total_usdt, btc_price)

    def _spot_realized_pnl(self, direction: str, opened_at_ms: int, btc_price: float) -> int:
        """Compute spot PnL from actual fills."""
        trades = self._client.get_spot_trades(
            symbol=self.symbol,
            start_time=opened_at_ms,
        )
        if not trades:
            return 0
        total_bought_cost = 0.0
        total_sold_revenue = 0.0
        for t in trades:
            quote_qty = float(t["quoteQty"])
            commission = float(t.get("commission", 0))
            if t["isBuyer"]:
                total_bought_cost += quote_qty + commission
            else:
                total_sold_revenue += quote_qty - commission
        if direction == "long":
            pnl_usdt = total_sold_revenue - total_bought_cost
        else:
            pnl_usdt = total_bought_cost - total_sold_revenue
        return _usdt_to_sats(pnl_usdt, btc_price)
