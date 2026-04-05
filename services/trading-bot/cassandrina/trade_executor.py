"""
Trade executor for Cassandrina.

Bridges strategy selection and venue-specific exchange clients.
"""

from __future__ import annotations

import logging

from cassandrina.exchange import ExchangeClient, ExchangeError, ExchangePlatform, ExecutionOrder, ExecutionResult
from cassandrina.strategy import (
    STOP_LOSS_PCT,
    TAKE_PROFIT_PCT,
    Strategy,
    get_exchange_leverage,
    get_grid_midpoint,
)

logger = logging.getLogger(__name__)

_SATS_PER_BTC = 100_000_000


def _usdt_to_sats(usdt_amount: float, btc_price: float) -> int:
    """Convert a USDT amount to satoshis using the current BTC price."""
    if btc_price <= 0:
        return 0
    btc_amount = usdt_amount / btc_price
    return int(round(btc_amount * _SATS_PER_BTC))


def _sats_to_btc(sats: int, decimals: int = 3, min_size_btc: float = 0.001) -> float:
    btc = sats / _SATS_PER_BTC
    rounded = round(btc, decimals)
    if rounded < min_size_btc:
        return 0.0
    return rounded


class TradeExecutor:
    def __init__(self, client: ExchangeClient, symbol: str = "BTCUSDT"):
        self._client = client
        self.symbol = symbol

    @property
    def platform(self) -> ExchangePlatform:
        return self._client.platform

    def quantize_trade_size(self, sats_deployed: int, *, leverage: int = 1, price_hint: float | None = None):
        return self._client.quantize_btc_amount(
            sats_deployed,
            symbol=self.symbol,
            leverage=leverage,
            use_quote_minimum=self.platform == ExchangePlatform.HYPERLIQUID,
            price_hint=price_hint,
        )

    def execute(
        self,
        strategy: Strategy,
        direction: str,
        current_price: float,
        target_price: float,
        sats_deployed: int,
    ) -> dict:
        leverage = get_exchange_leverage(strategy, self.platform)
        quantity_spec = self.quantize_trade_size(
            sats_deployed,
            leverage=leverage,
            price_hint=current_price,
        )
        if quantity_spec.skipped or quantity_spec.quantity_btc <= 0:
            result = ExecutionResult(
                platform=self.platform,
                strategy=strategy.value,
                execution_type="skipped",
                live=True,
                reason=quantity_spec.reason or "pool too small for venue minimum size",
                quantity_btc=quantity_spec.quantity_btc,
                leverage=leverage,
                metadata={"min_size_btc": quantity_spec.min_size_btc},
            )
            return self._result_to_dict(result)

        if strategy in (Strategy.A, Strategy.B, Strategy.D, Strategy.E):
            result = self._execute_directional(
                strategy=strategy,
                direction=direction,
                current_price=current_price,
                quantity=quantity_spec.quantity_btc,
            )
            return self._result_to_dict(result)

        result = self._execute_grid(current_price, target_price, quantity_spec.quantity_btc)
        return self._result_to_dict(result)

    def close_position(
        self,
        strategy: Strategy,
        direction: str,
        quantity_btc: float,
    ) -> dict:
        orders: list[ExecutionOrder] = []
        if strategy in (Strategy.A, Strategy.B, Strategy.C, Strategy.D, Strategy.E):
            self._client.cancel_all_futures_orders(symbol=self.symbol)
            if strategy == Strategy.C:
                result = ExecutionResult(
                    platform=self.platform,
                    strategy=strategy.value,
                    execution_type="grid_cancelled",
                    live=True,
                    quantity_btc=quantity_btc,
                )
                return self._result_to_dict(result)
            order = self._client.close_futures_position(
                symbol=self.symbol,
                side=direction,
                quantity=quantity_btc,
            )
            orders.append(
                ExecutionOrder(
                    order_id=self._extract_order_id(order),
                    kind="close",
                    side="sell" if direction == "long" else "buy",
                    quantity_btc=quantity_btc,
                    reduce_only=True,
                    raw=order,
                )
            )
            result = ExecutionResult(
                platform=self.platform,
                strategy=strategy.value,
                execution_type="perp_close",
                live=True,
                quantity_btc=quantity_btc,
                orders=orders,
            )
            return self._result_to_dict(result)
        return self._result_to_dict(
            ExecutionResult(
                platform=self.platform,
                strategy=strategy.value,
                execution_type="skipped",
                live=True,
                reason="unsupported strategy close",
            )
        )

    def _execute_directional(
        self,
        *,
        strategy: Strategy,
        direction: str,
        current_price: float,
        quantity: float,
    ) -> ExecutionResult:
        leverage = get_exchange_leverage(strategy, self.platform)
        orders: list[ExecutionOrder] = []
        order = self._client.futures_order(
            symbol=self.symbol,
            side=direction,
            quantity=quantity,
            leverage=leverage,
        )
        orders.append(
            ExecutionOrder(
                order_id=self._extract_order_id(order),
                kind="entry",
                side=direction,
                quantity_btc=quantity,
                raw=order,
            )
        )

        sl_pct = STOP_LOSS_PCT[strategy]
        if sl_pct > 0:
            sl_price = current_price * (1 - sl_pct / 100) if direction == "long" else current_price * (1 + sl_pct / 100)
            sl_order = self._client.set_stop_loss(
                symbol=self.symbol,
                side=direction,
                quantity=quantity,
                sl_price=sl_price,
            )
            orders.append(
                ExecutionOrder(
                    order_id=self._extract_order_id(sl_order),
                    kind="stop_loss",
                    side="sell" if direction == "long" else "buy",
                    quantity_btc=quantity,
                    price=sl_price,
                    reduce_only=True,
                    raw=sl_order,
                )
            )

        tp_pct = TAKE_PROFIT_PCT[strategy]
        if tp_pct > 0:
            tp_price = current_price * (1 + tp_pct / 100) if direction == "long" else current_price * (1 - tp_pct / 100)
            tp_order = self._client.set_take_profit(
                symbol=self.symbol,
                side=direction,
                quantity=quantity,
                tp_price=tp_price,
            )
            orders.append(
                ExecutionOrder(
                    order_id=self._extract_order_id(tp_order),
                    kind="take_profit",
                    side="sell" if direction == "long" else "buy",
                    quantity_btc=quantity,
                    price=tp_price,
                    reduce_only=True,
                    raw=tp_order,
                )
            )

        return ExecutionResult(
            platform=self.platform,
            strategy=strategy.value,
            execution_type="perp",
            live=True,
            quantity_btc=quantity,
            leverage=leverage,
            orders=orders,
        )

    def _execute_grid(
        self,
        current_price: float,
        target_price: float,
        quantity: float,
    ) -> ExecutionResult:
        midpoint = get_grid_midpoint(current_price, target_price)
        lower = min(current_price, midpoint)
        upper = max(current_price, midpoint)
        grid_size = round(quantity / 5, self._client.get_market_meta(self.symbol).size_decimals)
        orders = self._client.place_grid_orders(
            symbol=self.symbol,
            lower_price=lower,
            upper_price=upper,
            num_grids=5,
            quantity_per_grid=grid_size,
        )
        execution_orders = [
            ExecutionOrder(
                order_id=self._extract_order_id(order),
                kind="grid_leg",
                side=order.get("side"),
                quantity_btc=grid_size,
                price=self._extract_price(order),
                raw=order,
            )
            for order in orders
        ]
        return ExecutionResult(
            platform=self.platform,
            strategy=Strategy.C.value,
            execution_type="grid",
            live=True,
            quantity_btc=quantity,
            leverage=1,
            orders=execution_orders,
        )

    def reconcile_position(self, trade: dict) -> dict:
        strategy = Strategy(trade["strategy"])
        leverage = get_exchange_leverage(strategy, self.platform)
        quantity_spec = self.quantize_trade_size(
            int(trade["sats_deployed"]),
            leverage=leverage,
            price_hint=float(trade.get("entry_price", 0.0) or 0.0),
        )
        expected_qty = quantity_spec.quantity_btc
        result: dict = {
            "trade_id": trade["id"],
            "strategy": strategy.value,
            "platform": self.platform.value,
            "discrepancies": [],
        }

        try:
            pos = self._client.get_futures_position(self.symbol)
            if pos is None:
                if trade["status"] == "open":
                    result["discrepancies"].append(
                        f"DB shows open trade but no {self.platform.value} position exists"
                    )
            else:
                actual_qty = abs(pos.quantity_btc)
                tolerance = max(quantity_spec.min_size_btc, 10 ** (-self._client.get_market_meta(self.symbol).size_decimals))
                if abs(actual_qty - expected_qty) > tolerance:
                    result["discrepancies"].append(
                        f"Position size mismatch: DB={expected_qty} BTC, {self.platform.value}={actual_qty} BTC"
                    )
                result["exchange_position"] = {
                    "symbol": pos.symbol,
                    "quantity_btc": pos.quantity_btc,
                    "entry_price": pos.entry_price,
                    "unrealized_pnl": pos.unrealized_pnl,
                    "leverage": pos.leverage,
                    "raw": pos.raw,
                }
        except (ExchangeError, Exception):
            logger.exception("Reconciliation failed for trade %s", trade["id"])
            result["discrepancies"].append(f"Failed to query {self.platform.value}")

        return result

    def get_realized_pnl(
        self,
        strategy: Strategy,
        direction: str,
        sats_deployed: int,
        opened_at_ms: int,
        current_btc_price: float,
    ) -> int | None:
        try:
            return self._client.get_realized_pnl(
                self.symbol,
                strategy=strategy.value,
                direction=direction,
                sats_deployed=sats_deployed,
                opened_at_ms=opened_at_ms,
                current_btc_price=current_btc_price,
            )
        except (ExchangeError, Exception):
            logger.exception("Failed to query realized PnL from %s", self.platform.value)
            return None

    @staticmethod
    def _extract_order_id(order: dict | None) -> str | None:
        if not isinstance(order, dict):
            return None
        value = order.get("orderId") or order.get("oid")
        return str(value) if value is not None else None

    @staticmethod
    def _extract_price(order: dict | None) -> float | None:
        if not isinstance(order, dict):
            return None
        for key in ("price", "limitPx", "px"):
            value = order.get(key)
            if value is not None:
                try:
                    return float(value)
                except (TypeError, ValueError):
                    return None
        return None

    @staticmethod
    def _result_to_dict(result: ExecutionResult) -> dict:
        payload = {
            "platform": result.platform.value,
            "type": result.execution_type,
            "strategy": result.strategy,
            "live": result.live,
            "reason": result.reason,
            "quantity_btc": result.quantity_btc,
            "leverage": result.leverage,
            "orders": [
                {
                    "orderId": order.order_id,
                    "kind": order.kind,
                    "side": order.side,
                    "quantity_btc": order.quantity_btc,
                    "price": order.price,
                    "reduce_only": order.reduce_only,
                    **order.raw,
                }
                for order in result.orders
            ],
            **result.metadata,
        }
        if result.orders:
            first = result.orders[0]
            payload["order"] = {"orderId": first.order_id, **first.raw}
        return payload
