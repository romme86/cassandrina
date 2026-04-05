from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol


class ExchangePlatform(str, Enum):
    BINANCE = "binance"
    HYPERLIQUID = "hyperliquid"


class ExchangeError(Exception):
    """Raised when an exchange call fails."""


@dataclass(slots=True)
class MarketMeta:
    symbol: str
    venue_symbol: str
    min_size_btc: float
    size_decimals: int
    price_decimals: int
    min_notional_usd: float | None = None
    asset_id: int | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class QuantizedOrderSize:
    raw_btc: float
    quantity_btc: float
    min_size_btc: float
    skipped: bool = False
    reason: str | None = None


@dataclass(slots=True)
class ExecutionOrder:
    order_id: str | None
    kind: str
    side: str | None = None
    quantity_btc: float | None = None
    price: float | None = None
    reduce_only: bool = False
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ExecutionResult:
    platform: ExchangePlatform
    strategy: str
    execution_type: str
    live: bool
    reason: str | None = None
    quantity_btc: float | None = None
    leverage: int | None = None
    orders: list[ExecutionOrder] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def primary_order_id(self) -> str | None:
        for order in self.orders:
            if order.order_id:
                return order.order_id
        return None

    def to_metadata_dict(self) -> dict[str, Any]:
        return {
            "platform": self.platform.value,
            "type": self.execution_type,
            "live": self.live,
            "reason": self.reason,
            "quantity_btc": self.quantity_btc,
            "leverage": self.leverage,
            "orders": [
                {
                    "order_id": order.order_id,
                    "kind": order.kind,
                    "side": order.side,
                    "quantity_btc": order.quantity_btc,
                    "price": order.price,
                    "reduce_only": order.reduce_only,
                    "raw": order.raw,
                }
                for order in self.orders
            ],
            **self.metadata,
        }


@dataclass(slots=True)
class PositionState:
    symbol: str
    quantity_btc: float
    entry_price: float
    unrealized_pnl: float = 0.0
    leverage: int = 1
    raw: dict[str, Any] = field(default_factory=dict)


class ExchangeClient(Protocol):
    platform: ExchangePlatform

    def get_market_meta(self, symbol: str) -> MarketMeta:
        ...

    def quantize_btc_amount(
        self,
        sats: int,
        *,
        symbol: str,
        leverage: int = 1,
        use_quote_minimum: bool = False,
        price_hint: float | None = None,
    ) -> QuantizedOrderSize:
        ...

    def futures_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        leverage: int,
        *,
        slippage_bps: int = 50,
    ) -> dict[str, Any]:
        ...

    def set_stop_loss(
        self,
        symbol: str,
        side: str,
        quantity: float,
        sl_price: float,
    ) -> dict[str, Any]:
        ...

    def set_take_profit(
        self,
        symbol: str,
        side: str,
        quantity: float,
        tp_price: float,
    ) -> dict[str, Any]:
        ...

    def set_spot_stop_loss(
        self,
        symbol: str,
        side: str,
        quantity: float,
        sl_price: float,
    ) -> dict[str, Any]:
        ...

    def close_futures_position(self, symbol: str, side: str, quantity: float) -> dict[str, Any]:
        ...

    def cancel_all_futures_orders(self, symbol: str) -> None:
        ...

    def place_grid_orders(
        self,
        symbol: str,
        lower_price: float,
        upper_price: float,
        num_grids: int,
        quantity_per_grid: float,
    ) -> list[dict[str, Any]]:
        ...

    def spot_buy(self, symbol: str, quantity: float) -> dict[str, Any]:
        ...

    def spot_sell(self, symbol: str, quantity: float) -> dict[str, Any]:
        ...

    def get_futures_position(self, symbol: str) -> PositionState | None:
        ...

    def get_spot_balance(self, asset: str = "BTC") -> float:
        ...

    def cancel_all_orders(self, symbol: str) -> None:
        ...

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
        ...
