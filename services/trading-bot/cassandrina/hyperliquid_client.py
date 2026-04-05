"""
Hyperliquid client wrapper for Cassandrina.

Uses public HTTP info endpoints for metadata reads and the official SDK for
signed exchange actions when the optional dependencies are installed.
"""

from __future__ import annotations

from dataclasses import asdict
import importlib
import logging
import os
from functools import lru_cache
from typing import Any

import requests

from cassandrina.exchange import (
    ExchangeClient,
    ExchangeError,
    ExchangePlatform,
    MarketMeta,
    PositionState,
    QuantizedOrderSize,
)

logger = logging.getLogger(__name__)

_SATS_PER_BTC = 100_000_000
_DEFAULT_API_URL = "https://api.hyperliquid.xyz"
_DEFAULT_SLIPPAGE_BPS = 75


class HyperliquidClient(ExchangeClient):
    platform = ExchangePlatform.HYPERLIQUID

    def __init__(
        self,
        *,
        api_url: str | None = None,
        account_address: str | None = None,
        agent_private_key: str | None = None,
        slippage_bps: int | None = None,
        session: requests.Session | None = None,
    ):
        self._api_url = (api_url or os.environ.get("HYPERLIQUID_API_URL") or _DEFAULT_API_URL).rstrip("/")
        self._account_address = account_address or os.environ.get("HYPERLIQUID_MASTER_ADDRESS", "")
        self._agent_private_key = agent_private_key or os.environ.get("HYPERLIQUID_AGENT_PRIVATE_KEY", "")
        self._slippage_bps = slippage_bps or int(os.environ.get("HYPERLIQUID_MAX_SLIPPAGE_BPS", _DEFAULT_SLIPPAGE_BPS))
        self._session = session or requests.Session()
        self._sdk_exchange = None
        self._sdk_info = None

    @property
    def account_address(self) -> str:
        return self._account_address

    @property
    def configured(self) -> bool:
        return bool(self._account_address and self._agent_private_key)

    def get_market_meta(self, symbol: str) -> MarketMeta:
        coin = self._coin(symbol)
        universe, asset_ctxs = self._fetch_meta_and_ctxs()
        for index, entry in enumerate(universe):
            if entry.get("name") == coin:
                size_decimals = int(entry.get("szDecimals", 5))
                ctx = asset_ctxs[index] if index < len(asset_ctxs) else {}
                price_decimals = max(int(ctx.get("priceDecimals", 2)), 0)
                return MarketMeta(
                    symbol=symbol,
                    venue_symbol=coin,
                    min_size_btc=10 ** (-size_decimals),
                    size_decimals=size_decimals,
                    price_decimals=price_decimals or 2,
                    asset_id=index,
                    raw={"universe": entry, "ctx": ctx},
                )
        raise ExchangeError(f"Hyperliquid market metadata not found for {symbol}")

    def quantize_btc_amount(
        self,
        sats: int,
        *,
        symbol: str,
        leverage: int = 1,
        use_quote_minimum: bool = False,
        price_hint: float | None = None,
    ) -> QuantizedOrderSize:
        meta = self.get_market_meta(symbol)
        raw_btc = max(float(sats), 0.0) / _SATS_PER_BTC
        quantity = round(raw_btc, meta.size_decimals)
        if quantity < meta.min_size_btc:
            return QuantizedOrderSize(
                raw_btc=raw_btc,
                quantity_btc=0.0,
                min_size_btc=meta.min_size_btc,
                skipped=True,
                reason="pool too small for Hyperliquid minimum size increment",
            )

        if use_quote_minimum and price_hint and leverage > 0:
            notional = quantity * price_hint
            effective_notional = notional * leverage
            if effective_notional <= 0:
                return QuantizedOrderSize(
                    raw_btc=raw_btc,
                    quantity_btc=0.0,
                    min_size_btc=meta.min_size_btc,
                    skipped=True,
                    reason="invalid quote notional for Hyperliquid order",
                )

        return QuantizedOrderSize(
            raw_btc=raw_btc,
            quantity_btc=quantity,
            min_size_btc=meta.min_size_btc,
        )

    def futures_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        leverage: int,
        *,
        slippage_bps: int = _DEFAULT_SLIPPAGE_BPS,
    ) -> dict[str, Any]:
        coin = self._coin(symbol)
        self._update_leverage(coin, leverage)
        is_buy = side == "long"
        return self._market_open(coin, is_buy, quantity, slippage_bps=slippage_bps)

    def set_stop_loss(self, symbol: str, side: str, quantity: float, sl_price: float) -> dict[str, Any]:
        coin = self._coin(symbol)
        is_buy = side != "long"
        return self._place_trigger_order(coin, is_buy, quantity, sl_price, trigger_kind="sl")

    def set_take_profit(self, symbol: str, side: str, quantity: float, tp_price: float) -> dict[str, Any]:
        coin = self._coin(symbol)
        is_buy = side != "long"
        return self._place_trigger_order(coin, is_buy, quantity, tp_price, trigger_kind="tp")

    def set_spot_stop_loss(self, symbol: str, side: str, quantity: float, sl_price: float) -> dict[str, Any]:
        return self.set_stop_loss(symbol, side, quantity, sl_price)

    def close_futures_position(self, symbol: str, side: str, quantity: float) -> dict[str, Any]:
        coin = self._coin(symbol)
        is_buy = side != "long"
        return self._market_close(coin, is_buy, quantity)

    def cancel_all_futures_orders(self, symbol: str) -> None:
        coin = self._coin(symbol)
        self._cancel_all(coin)

    def place_grid_orders(
        self,
        symbol: str,
        lower_price: float,
        upper_price: float,
        num_grids: int,
        quantity_per_grid: float,
    ) -> list[dict[str, Any]]:
        coin = self._coin(symbol)
        meta = self.get_market_meta(symbol)
        step = (upper_price - lower_price) / max(num_grids - 1, 1)
        midpoint = (lower_price + upper_price) / 2
        orders = []
        for index in range(num_grids):
            price = round(lower_price + (step * index), meta.price_decimals)
            is_buy = price <= midpoint
            orders.append(
                self._place_limit_order(
                    coin,
                    is_buy=is_buy,
                    quantity=round(quantity_per_grid, meta.size_decimals),
                    price=price,
                    reduce_only=False,
                )
            )
        return orders

    def spot_buy(self, symbol: str, quantity: float) -> dict[str, Any]:
        asset = self._spot_asset_id(symbol)
        return self._place_spot_market_order(asset_id=asset, is_buy=True, quantity=quantity)

    def spot_sell(self, symbol: str, quantity: float) -> dict[str, Any]:
        asset = self._spot_asset_id(symbol)
        return self._place_spot_market_order(asset_id=asset, is_buy=False, quantity=quantity)

    def get_futures_position(self, symbol: str) -> PositionState | None:
        coin = self._coin(symbol)
        state = self.user_state()
        positions = state.get("assetPositions", []) if isinstance(state, dict) else []
        for entry in positions:
            position = entry.get("position", entry)
            if position.get("coin") != coin:
                continue
            size = abs(float(position.get("szi", 0.0)))
            if size <= 0:
                continue
            return PositionState(
                symbol=symbol,
                quantity_btc=size,
                entry_price=float(position.get("entryPx", 0.0) or 0.0),
                unrealized_pnl=float(position.get("unrealizedPnl", 0.0) or 0.0),
                leverage=int(float(position.get("leverage", {}).get("value", 1) if isinstance(position.get("leverage"), dict) else position.get("leverage", 1))),
                raw=dict(position),
            )
        return None

    def get_spot_balance(self, asset: str = "BTC") -> float:
        state = self.user_state()
        balances = state.get("spotState", {}).get("balances", []) if isinstance(state, dict) else []
        for balance in balances:
            coin = balance.get("coin") or balance.get("token")
            if coin == asset:
                return float(balance.get("total", balance.get("hold", 0.0)) or 0.0)
        return 0.0

    def cancel_all_orders(self, symbol: str) -> None:
        self._cancel_all(self._coin(symbol))

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
        del strategy, direction, sats_deployed
        fills = self.user_fills()
        realized_usd = 0.0
        for fill in fills:
            if fill.get("coin") != self._coin(symbol):
                continue
            fill_time = int(fill.get("time", 0) or 0)
            if fill_time and fill_time < opened_at_ms:
                continue
            realized_usd += float(fill.get("closedPnl", 0.0) or 0.0)
            realized_usd -= float(fill.get("fee", 0.0) or 0.0)
        if realized_usd == 0.0 or current_btc_price <= 0:
            return None
        return int(round((realized_usd / current_btc_price) * _SATS_PER_BTC))

    def user_state(self) -> dict[str, Any]:
        if not self._account_address:
            return {}
        if self._sdk_info is not None:
            return self._sdk_info.user_state(self._account_address)
        return self._post_info({"type": "clearinghouseState", "user": self._account_address})

    def user_fills(self) -> list[dict[str, Any]]:
        if not self._account_address:
            return []
        if self._sdk_info is not None:
            return self._sdk_info.user_fills(self._account_address)
        return self._post_info({"type": "userFills", "user": self._account_address})

    def approve_agent(self, *, agent_address: str, agent_name: str = "cassandrina") -> dict[str, Any]:
        exchange = self._require_exchange()
        try:
            return exchange.approve_agent(agent_address, agent_name)
        except TypeError:
            return exchange.approve_agent(agent_name, agent_address)

    def is_ready(self) -> bool:
        if not self.configured:
            return False
        try:
            state = self.user_state()
        except Exception:
            logger.exception("Failed to fetch Hyperliquid user state")
            return False
        return isinstance(state, dict) and bool(state)

    def _fetch_meta_and_ctxs(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        payload = self._post_info({"type": "metaAndAssetCtxs"})
        if not isinstance(payload, list) or len(payload) < 2:
            raise ExchangeError("Unexpected Hyperliquid meta response")
        return payload[0].get("universe", []), payload[1]

    @lru_cache(maxsize=16)
    def _spot_meta(self) -> dict[str, Any]:
        payload = self._post_info({"type": "spotMeta"})
        if not isinstance(payload, dict):
            raise ExchangeError("Unexpected Hyperliquid spot metadata response")
        return payload

    def _spot_asset_id(self, symbol: str) -> int:
        spot_meta = self._spot_meta()
        for entry in spot_meta.get("universe", []):
            name = f"{entry.get('base')}/{entry.get('quote')}"
            venue_symbol = symbol.replace("USDC", "/USDC").replace("USDT", "/USDT")
            if name == venue_symbol:
                return 10000 + int(entry["index"])
        raise ExchangeError(f"Hyperliquid spot asset metadata not found for {symbol}")

    def _post_info(self, payload: dict[str, Any]) -> Any:
        response = self._session.post(f"{self._api_url}/info", json=payload, timeout=15)
        if response.status_code >= 400:
            raise ExchangeError(f"Hyperliquid info request failed: {response.status_code} {response.text}")
        return response.json()

    def _require_exchange(self):
        if self._sdk_exchange is not None:
            return self._sdk_exchange

        if not self.configured:
            raise ExchangeError("Hyperliquid is not configured")

        try:
            account_mod = importlib.import_module("eth_account")
            exchange_mod = importlib.import_module("hyperliquid.exchange")
            info_mod = importlib.import_module("hyperliquid.info")
        except ModuleNotFoundError as exc:
            raise ExchangeError("Hyperliquid SDK dependencies are not installed") from exc

        local_account = account_mod.Account.from_key(self._agent_private_key)
        self._sdk_info = info_mod.Info(self._api_url, skip_ws=True)
        try:
            self._sdk_exchange = exchange_mod.Exchange(
                local_account,
                self._api_url,
                account_address=self._account_address,
            )
        except TypeError:
            self._sdk_exchange = exchange_mod.Exchange(local_account, self._api_url, self._account_address)
        return self._sdk_exchange

    def _update_leverage(self, coin: str, leverage: int) -> None:
        exchange = self._require_exchange()
        try:
            exchange.update_leverage(leverage, coin, False)
        except TypeError:
            exchange.update_leverage(leverage=leverage, coin=coin, is_cross=False)

    def _market_open(self, coin: str, is_buy: bool, quantity: float, *, slippage_bps: int) -> dict[str, Any]:
        exchange = self._require_exchange()
        slippage = max(slippage_bps, 1) / 10_000
        try:
            result = exchange.market_open(coin, is_buy, quantity, None, slippage)
        except TypeError:
            result = exchange.market_open(coin=coin, is_buy=is_buy, sz=quantity, px=None, slippage=slippage)
        return self._normalize_result(result, kind="perp_market")

    def _market_close(self, coin: str, is_buy: bool, quantity: float) -> dict[str, Any]:
        exchange = self._require_exchange()
        try:
            result = exchange.market_close(coin, is_buy, quantity)
        except TypeError:
            result = exchange.order(
                coin,
                is_buy,
                quantity,
                0,
                {"limit": {"tif": "Ioc"}},
                reduce_only=True,
            )
        return self._normalize_result(result, kind="perp_close")

    def _place_trigger_order(
        self,
        coin: str,
        is_buy: bool,
        quantity: float,
        trigger_price: float,
        *,
        trigger_kind: str,
    ) -> dict[str, Any]:
        exchange = self._require_exchange()
        order_type = {"trigger": {"triggerPx": trigger_price, "isMarket": True, "tpsl": trigger_kind}}
        try:
            result = exchange.order(coin, is_buy, quantity, trigger_price, order_type, reduce_only=True)
        except TypeError:
            result = exchange.order(
                coin=coin,
                is_buy=is_buy,
                sz=quantity,
                limit_px=trigger_price,
                order_type=order_type,
                reduce_only=True,
            )
        return self._normalize_result(result, kind=f"perp_{trigger_kind}")

    def _place_limit_order(
        self,
        coin: str,
        *,
        is_buy: bool,
        quantity: float,
        price: float,
        reduce_only: bool,
    ) -> dict[str, Any]:
        exchange = self._require_exchange()
        order_type = {"limit": {"tif": "Gtc"}}
        try:
            result = exchange.order(coin, is_buy, quantity, price, order_type, reduce_only=reduce_only)
        except TypeError:
            result = exchange.order(
                coin=coin,
                is_buy=is_buy,
                sz=quantity,
                limit_px=price,
                order_type=order_type,
                reduce_only=reduce_only,
            )
        return self._normalize_result(result, kind="limit")

    def _place_spot_market_order(self, *, asset_id: int, is_buy: bool, quantity: float) -> dict[str, Any]:
        exchange = self._require_exchange()
        order_type = {"limit": {"tif": "Ioc"}}
        try:
            result = exchange.order(asset_id, is_buy, quantity, 0, order_type, reduce_only=False)
        except TypeError:
            result = exchange.order(
                coin=asset_id,
                is_buy=is_buy,
                sz=quantity,
                limit_px=0,
                order_type=order_type,
                reduce_only=False,
            )
        return self._normalize_result(result, kind="spot_market")

    def _cancel_all(self, coin: str) -> None:
        exchange = self._require_exchange()
        open_orders = self._open_orders()
        targets = []
        for order in open_orders:
            if order.get("coin") == coin:
                targets.append({"coin": coin, "oid": order.get("oid")})
        if not targets:
            return
        try:
            exchange.bulk_cancel(targets)
        except TypeError:
            for target in targets:
                exchange.cancel(target["coin"], target["oid"])

    def _open_orders(self) -> list[dict[str, Any]]:
        if self._sdk_info is not None and self._account_address:
            return self._sdk_info.open_orders(self._account_address)
        if not self._account_address:
            return []
        payload = self._post_info({"type": "openOrders", "user": self._account_address})
        return payload if isinstance(payload, list) else []

    @staticmethod
    def _normalize_result(result: Any, *, kind: str) -> dict[str, Any]:
        if isinstance(result, dict):
            data = dict(result)
        else:
            data = {"result": result}
        statuses = data.get("response", {}).get("data", {}).get("statuses") if isinstance(data.get("response"), dict) else None
        if isinstance(statuses, list):
            for status in statuses:
                resting = status.get("resting") if isinstance(status, dict) else None
                filled = status.get("filled") if isinstance(status, dict) else None
                if isinstance(resting, dict):
                    oid = resting.get("oid")
                    if oid is not None:
                        data.setdefault("orderId", str(oid))
                        break
                if isinstance(filled, dict):
                    oid = filled.get("oid")
                    if oid is not None:
                        data.setdefault("orderId", str(oid))
                        break
        data.setdefault("kind", kind)
        return data

    @staticmethod
    def _coin(symbol: str) -> str:
        if symbol.endswith("USDT"):
            return symbol[:-4]
        if symbol.endswith("USDC"):
            return symbol[:-4]
        return symbol
