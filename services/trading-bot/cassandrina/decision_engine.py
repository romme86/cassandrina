"""
Decision engine for Cassandrina.

Builds a user-led market view from paid predictions, applies a minority
Polymarket modulation layer, and returns concrete execution parameters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from cassandrina.strategy import Strategy, get_leverage, select_strategy


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _as_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _as_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


@dataclass(slots=True)
class DecisionConfig:
    pm_conf_weight_min_pct: float = 10.0
    pm_conf_weight_max_pct: float = 30.0
    pm_range_weight_min_pct: float = 3.0
    pm_range_weight_max_pct: float = 8.0
    pm_trade_window_minutes: int = 60
    pm_market_max_distance_pct: float = 5.0
    grid_min_width_pct: float = 1.5
    grid_extra_orders_width_pct: float = 3.0
    grid_balance_ratio_max: float = 1.25

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any] | None) -> "DecisionConfig":
        values = values or {}
        return cls(
            pm_conf_weight_min_pct=_as_float(values.get("pm_conf_weight_min_pct"), 10.0),
            pm_conf_weight_max_pct=_as_float(values.get("pm_conf_weight_max_pct"), 30.0),
            pm_range_weight_min_pct=_as_float(values.get("pm_range_weight_min_pct"), 3.0),
            pm_range_weight_max_pct=_as_float(values.get("pm_range_weight_max_pct"), 8.0),
            pm_trade_window_minutes=_as_int(values.get("pm_trade_window_minutes"), 60),
            pm_market_max_distance_pct=_as_float(values.get("pm_market_max_distance_pct"), 5.0),
            grid_min_width_pct=_as_float(values.get("grid_min_width_pct"), 1.5),
            grid_extra_orders_width_pct=_as_float(values.get("grid_extra_orders_width_pct"), 3.0),
            grid_balance_ratio_max=_as_float(values.get("grid_balance_ratio_max"), 1.25),
        )


@dataclass(slots=True)
class PolymarketSignal:
    available: bool = False
    aligned_probability: float = 0.5
    alignment_score: float = 50.0
    trade_imbalance_score: float = 50.0
    price_momentum_score: float = 50.0
    question: str | None = None
    condition_id: str | None = None
    matched_price: float | None = None
    favored_outcome: str | None = None


@dataclass(slots=True)
class UserMarketView:
    low: float
    high: float
    mid: float
    direction: str
    upside_room: float
    downside_room: float
    range_width: float
    user_confidence: float
    grid_eligible: bool
    grid_order_count: int
    metrics: dict[str, Any]


@dataclass(slots=True)
class StrategyDecision:
    strategy: Strategy
    direction: str
    base_direction: str
    current_price: float
    interpreted_low: float
    interpreted_high: float
    interpreted_mid: float
    adjusted_low: float
    adjusted_high: float
    adjusted_mid: float
    user_confidence_score: float
    confidence_score: float
    polymarket_influence_pct: float
    leverage: int
    take_profit_price: float | None
    stop_loss_price: float | None
    grid_lower_price: float | None
    grid_upper_price: float | None
    grid_order_count: int | None
    decision_metrics: dict[str, Any]

    def snapshot(self) -> dict[str, Any]:
        return {
            "strategy": self.strategy.value,
            "direction": self.direction,
            "base_direction": self.base_direction,
            "current_price": self.current_price,
            "interpreted_low": self.interpreted_low,
            "interpreted_high": self.interpreted_high,
            "interpreted_mid": self.interpreted_mid,
            "adjusted_low": self.adjusted_low,
            "adjusted_high": self.adjusted_high,
            "adjusted_mid": self.adjusted_mid,
            "user_confidence_score": self.user_confidence_score,
            "confidence_score": self.confidence_score,
            "polymarket_influence_pct": self.polymarket_influence_pct,
            "leverage": self.leverage,
            "take_profit_price": self.take_profit_price,
            "stop_loss_price": self.stop_loss_price,
            "grid_lower_price": self.grid_lower_price,
            "grid_upper_price": self.grid_upper_price,
            "grid_order_count": self.grid_order_count,
            "decision_metrics": self.decision_metrics,
        }


_DIRECTIONAL_TP_CAPTURE: dict[Strategy, float] = {
    Strategy.A: 0.90,
    Strategy.B: 0.80,
    Strategy.D: 0.65,
    Strategy.E: 0.50,
}

_DIRECTIONAL_SL_CAP_PCT: dict[Strategy, float] = {
    Strategy.A: 2.5,
    Strategy.B: 4.0,
    Strategy.D: 6.0,
    Strategy.E: 8.0,
}


def build_user_market_view(
    participants: list[dict],
    current_price: float,
    config: DecisionConfig | None = None,
) -> UserMarketView:
    cfg = config or DecisionConfig()
    interpreted_low, interpreted_high, interpreted_mid, fallback_used, total_abs_influence = _interpret_range(
        participants,
        current_price,
    )
    direction, upside_room, downside_room = _derive_direction(
        current_price,
        interpreted_low,
        interpreted_high,
        interpreted_mid,
    )
    range_width = max(interpreted_high - interpreted_low, 0.0)
    width_pct = (range_width / current_price) * 100.0 if current_price > 0 else 0.0
    grid_eligible = _is_grid_eligible(
        current_price=current_price,
        low=interpreted_low,
        high=interpreted_high,
        upside_room=upside_room,
        downside_room=downside_room,
        width_pct=width_pct,
        max_balance_ratio=cfg.grid_balance_ratio_max,
        min_width_pct=cfg.grid_min_width_pct,
    )
    grid_order_count = 7 if width_pct >= cfg.grid_extra_orders_width_pct else 5
    user_confidence, confidence_metrics = _compute_user_confidence(
        participants,
        current_price=current_price,
        interpreted_mid=interpreted_mid,
    )
    metrics = {
        "fallback_to_sats_weighted": fallback_used,
        "total_absolute_signed_influence": total_abs_influence,
        "interpreted_range_width": range_width,
        "interpreted_range_width_pct": width_pct,
        "upside_room": upside_room,
        "downside_room": downside_room,
        "grid_eligible": grid_eligible,
        "grid_order_count": grid_order_count,
        **confidence_metrics,
    }
    return UserMarketView(
        low=interpreted_low,
        high=interpreted_high,
        mid=interpreted_mid,
        direction=direction,
        upside_room=upside_room,
        downside_room=downside_room,
        range_width=range_width,
        user_confidence=user_confidence,
        grid_eligible=grid_eligible,
        grid_order_count=grid_order_count,
        metrics=metrics,
    )


def build_strategy_decision(
    user_view: UserMarketView,
    *,
    current_price: float,
    config: DecisionConfig | None = None,
    polymarket_signal: PolymarketSignal | None = None,
) -> StrategyDecision:
    cfg = config or DecisionConfig()
    pm_signal = polymarket_signal or PolymarketSignal()
    adjusted_low = user_view.low
    adjusted_high = user_view.high
    adjusted_mid = user_view.mid
    pm_conf_weight_pct = 0.0
    pm_range_weight_pct = 0.0
    pm_bias = 0.0
    final_confidence = user_view.user_confidence

    if pm_signal.available:
        pm_conf_weight_pct = _dynamic_weight(
            user_view.user_confidence,
            cfg.pm_conf_weight_min_pct,
            cfg.pm_conf_weight_max_pct,
        )
        pm_range_weight_pct = _dynamic_weight(
            user_view.user_confidence,
            cfg.pm_range_weight_min_pct,
            cfg.pm_range_weight_max_pct,
        )
        final_confidence = (
            user_view.user_confidence * (1 - pm_conf_weight_pct / 100.0)
            + pm_signal.alignment_score * (pm_conf_weight_pct / 100.0)
        )
        pm_bias = _clamp((pm_signal.alignment_score - 50.0) / 50.0, -1.0, 1.0)
        direction_sign = 1.0 if user_view.direction == "long" else -1.0
        midpoint_shift = direction_sign * pm_bias * (pm_range_weight_pct / 100.0) * user_view.range_width / 2.0
        adjusted_mid = user_view.mid + midpoint_shift
        adjusted_low = max(0.01, adjusted_mid - user_view.range_width / 2.0)
        adjusted_high = max(adjusted_low, adjusted_mid + user_view.range_width / 2.0)

    if user_view.grid_eligible:
        strategy = Strategy.C
        leverage = get_leverage(strategy)
        tp_price = None
        sl_price = None
        grid_lower_price = user_view.low
        grid_upper_price = user_view.high
        grid_order_count = user_view.grid_order_count
    else:
        strategy = select_strategy(final_confidence)
        leverage = get_leverage(strategy)
        tp_price, sl_price = _directional_targets(
            strategy=strategy,
            direction=user_view.direction,
            current_price=current_price,
            adjusted_low=adjusted_low,
            adjusted_high=adjusted_high,
        )
        grid_lower_price = None
        grid_upper_price = None
        grid_order_count = None

    decision_metrics = {
        **user_view.metrics,
        "aligned_polymarket_probability": pm_signal.aligned_probability,
        "polymarket_alignment_score": pm_signal.alignment_score,
        "polymarket_trade_imbalance_score": pm_signal.trade_imbalance_score,
        "polymarket_price_momentum_score": pm_signal.price_momentum_score,
        "polymarket_question": pm_signal.question,
        "polymarket_condition_id": pm_signal.condition_id,
        "polymarket_matched_price": pm_signal.matched_price,
        "polymarket_favored_outcome": pm_signal.favored_outcome,
        "polymarket_conf_weight_pct": pm_conf_weight_pct,
        "polymarket_range_weight_pct": pm_range_weight_pct,
        "polymarket_range_bias": pm_bias,
        "adjusted_low": adjusted_low,
        "adjusted_high": adjusted_high,
        "adjusted_mid": adjusted_mid,
    }

    return StrategyDecision(
        strategy=strategy,
        direction=user_view.direction,
        base_direction=user_view.direction,
        current_price=current_price,
        interpreted_low=user_view.low,
        interpreted_high=user_view.high,
        interpreted_mid=user_view.mid,
        adjusted_low=adjusted_low,
        adjusted_high=adjusted_high,
        adjusted_mid=adjusted_mid,
        user_confidence_score=user_view.user_confidence,
        confidence_score=_clamp(final_confidence, 0.0, 100.0),
        polymarket_influence_pct=pm_conf_weight_pct,
        leverage=leverage,
        take_profit_price=tp_price,
        stop_loss_price=sl_price,
        grid_lower_price=grid_lower_price,
        grid_upper_price=grid_upper_price,
        grid_order_count=grid_order_count,
        decision_metrics=decision_metrics,
    )


def override_strategy(decision: StrategyDecision, strategy: Strategy) -> StrategyDecision:
    if strategy == decision.strategy:
        return decision

    leverage = get_leverage(strategy)
    if strategy == Strategy.C:
        take_profit_price = None
        stop_loss_price = None
        grid_lower_price = decision.interpreted_low
        grid_upper_price = decision.interpreted_high
        grid_order_count = int(decision.decision_metrics.get("grid_order_count", 5))
    else:
        take_profit_price, stop_loss_price = _directional_targets(
            strategy=strategy,
            direction=decision.direction,
            current_price=decision.current_price,
            adjusted_low=decision.adjusted_low,
            adjusted_high=decision.adjusted_high,
        )
        grid_lower_price = None
        grid_upper_price = None
        grid_order_count = None

    decision_metrics = {
        **decision.decision_metrics,
        "strategy_overridden": True,
        "strategy_override_value": strategy.value,
    }
    return StrategyDecision(
        strategy=strategy,
        direction=decision.direction,
        base_direction=decision.base_direction,
        current_price=decision.current_price,
        interpreted_low=decision.interpreted_low,
        interpreted_high=decision.interpreted_high,
        interpreted_mid=decision.interpreted_mid,
        adjusted_low=decision.adjusted_low,
        adjusted_high=decision.adjusted_high,
        adjusted_mid=decision.adjusted_mid,
        user_confidence_score=decision.user_confidence_score,
        confidence_score=decision.confidence_score,
        polymarket_influence_pct=decision.polymarket_influence_pct,
        leverage=leverage,
        take_profit_price=take_profit_price,
        stop_loss_price=stop_loss_price,
        grid_lower_price=grid_lower_price,
        grid_upper_price=grid_upper_price,
        grid_order_count=grid_order_count,
        decision_metrics=decision_metrics,
    )


def _interpret_range(
    participants: list[dict],
    current_price: float,
) -> tuple[float, float, float, bool, float]:
    total_abs_influence = 0.0
    weighted_low_dev = 0.0
    weighted_high_dev = 0.0
    weighted_mid_dev = 0.0

    for participant in participants:
        accuracy = _as_float(participant.get("accuracy"), 50.0)
        sats_amount = _as_float(participant.get("sats_amount"), 0.0)
        signed_influence = sats_amount * (accuracy - 50.0)
        if signed_influence == 0:
            continue
        total_abs_influence += abs(signed_influence)
        weighted_low_dev += (_as_float(participant.get("predicted_low_price")) - current_price) * signed_influence
        weighted_high_dev += (_as_float(participant.get("predicted_high_price")) - current_price) * signed_influence
        weighted_mid_dev += (_as_float(participant.get("predicted_price")) - current_price) * signed_influence

    if total_abs_influence == 0:
        low, high, mid = _plain_sats_weighted_range(participants)
        return low, high, mid, True, 0.0

    low = current_price + (weighted_low_dev / total_abs_influence)
    high = current_price + (weighted_high_dev / total_abs_influence)
    mid = current_price + (weighted_mid_dev / total_abs_influence)
    low, high, mid = _normalize_range(low, high, mid, current_price)
    return low, high, mid, False, total_abs_influence


def _plain_sats_weighted_range(participants: list[dict]) -> tuple[float, float, float]:
    total_sats = sum(_as_int(p.get("sats_amount"), 0) for p in participants)
    if total_sats <= 0:
        first = participants[0]
        return (
            _as_float(first.get("predicted_low_price")),
            _as_float(first.get("predicted_high_price")),
            _as_float(first.get("predicted_price")),
        )
    low = sum(_as_float(p.get("predicted_low_price")) * _as_int(p.get("sats_amount"), 0) for p in participants) / total_sats
    high = sum(_as_float(p.get("predicted_high_price")) * _as_int(p.get("sats_amount"), 0) for p in participants) / total_sats
    mid = sum(_as_float(p.get("predicted_price")) * _as_int(p.get("sats_amount"), 0) for p in participants) / total_sats
    return _normalize_range(low, high, mid, mid)


def _normalize_range(low: float, high: float, mid: float, reference_price: float) -> tuple[float, float, float]:
    low = max(low, 0.01)
    high = max(high, 0.01)
    if low > high:
        low, high = high, low
    if low == high:
        half_step = max(reference_price * 0.0025, 1.0)
        low = max(0.01, low - half_step)
        high = high + half_step
    mid = _clamp(mid, low, high)
    return low, high, mid


def _derive_direction(
    current_price: float,
    low: float,
    high: float,
    mid: float,
) -> tuple[str, float, float]:
    upside_room = max(high - current_price, 0.0)
    downside_room = max(current_price - low, 0.0)
    if upside_room > downside_room:
        return "long", upside_room, downside_room
    if downside_room > upside_room:
        return "short", upside_room, downside_room
    return ("long" if mid >= current_price else "short"), upside_room, downside_room


def _is_grid_eligible(
    *,
    current_price: float,
    low: float,
    high: float,
    upside_room: float,
    downside_room: float,
    width_pct: float,
    max_balance_ratio: float,
    min_width_pct: float,
) -> bool:
    if not (low < current_price < high):
        return False
    if upside_room <= 0 or downside_room <= 0:
        return False
    if width_pct < min_width_pct:
        return False
    balance_ratio = max(upside_room, downside_room) / max(min(upside_room, downside_room), 1e-9)
    return balance_ratio <= max_balance_ratio


def _compute_user_confidence(
    participants: list[dict],
    *,
    current_price: float,
    interpreted_mid: float,
) -> tuple[float, dict[str, Any]]:
    total_sats = sum(_as_float(p.get("sats_amount"), 0.0) for p in participants)
    if total_sats <= 0:
        return 0.0, {
            "congruency_score": 0.0,
            "consensus_tightness_confidence": 0.0,
            "participant_count_score": 0.0,
            "breadth_score": 0.0,
            "largest_sats_share_pct": 0.0,
        }

    congruency_score = (
        sum(_as_float(p.get("congruency"), 50.0) * _as_float(p.get("sats_amount"), 0.0) for p in participants)
        / total_sats
    )
    participant_count_score = _clamp((len(participants) / 8.0) * 100.0, 0.0, 100.0)
    largest_sats = max(_as_float(p.get("sats_amount"), 0.0) for p in participants)
    largest_share_pct = (largest_sats / total_sats) * 100.0 if total_sats > 0 else 0.0
    breadth_score = _clamp(100.0 - largest_share_pct, 0.0, 100.0)

    tightness_weight_total = 0.0
    weighted_mad = 0.0
    for participant in participants:
        positive_skill = max(_as_float(participant.get("accuracy"), 50.0) - 50.0, 0.0)
        sats_amount = _as_float(participant.get("sats_amount"), 0.0)
        weight = positive_skill * sats_amount
        if weight <= 0:
            continue
        weighted_mad += abs(_as_float(participant.get("predicted_price")) - interpreted_mid) * weight
        tightness_weight_total += weight

    if tightness_weight_total > 0 and current_price > 0:
        mad = weighted_mad / tightness_weight_total
        mad_pct = (mad / current_price) * 100.0
        consensus_tightness_confidence = _clamp(100.0 * (1.0 - (mad_pct / 6.0)), 0.0, 100.0)
    else:
        mad_pct = 0.0
        consensus_tightness_confidence = 0.0

    user_confidence = (
        0.40 * congruency_score
        + 0.30 * consensus_tightness_confidence
        + 0.20 * participant_count_score
        + 0.10 * breadth_score
    )

    return _clamp(user_confidence, 0.0, 100.0), {
        "congruency_score": congruency_score,
        "consensus_tightness_confidence": consensus_tightness_confidence,
        "consensus_midpoint_mad_pct": mad_pct,
        "participant_count_score": participant_count_score,
        "breadth_score": breadth_score,
        "largest_sats_share_pct": largest_share_pct,
        "participant_count": len(participants),
    }


def _dynamic_weight(user_confidence: float, minimum_pct: float, maximum_pct: float) -> float:
    confidence_factor = 1.0 - (_clamp(user_confidence, 0.0, 100.0) / 100.0)
    return minimum_pct + confidence_factor * max(maximum_pct - minimum_pct, 0.0)


def _directional_targets(
    *,
    strategy: Strategy,
    direction: str,
    current_price: float,
    adjusted_low: float,
    adjusted_high: float,
) -> tuple[float | None, float | None]:
    favorable_room = max(adjusted_high - current_price, 0.0) if direction == "long" else max(current_price - adjusted_low, 0.0)
    adverse_room_pct = max(current_price - adjusted_low, 0.0) / current_price * 100.0 if direction == "long" else max(adjusted_high - current_price, 0.0) / current_price * 100.0
    capture_ratio = _DIRECTIONAL_TP_CAPTURE[strategy]
    max_sl_pct = _DIRECTIONAL_SL_CAP_PCT[strategy]

    tp_distance = favorable_room * capture_ratio
    tp_price = current_price + tp_distance if direction == "long" else current_price - tp_distance

    sl_pct = _clamp(adverse_room_pct if adverse_room_pct > 0 else max_sl_pct / 2.0, 0.5, max_sl_pct)
    sl_price = current_price * (1 - sl_pct / 100.0) if direction == "long" else current_price * (1 + sl_pct / 100.0)
    return tp_price, sl_price
