"""
Profit distribution engine for Cassandrina.

Distributes PnL proportionally by sats invested, handles weekly
reinvestment splits, and zeroes positions on liquidation.
"""

from __future__ import annotations


def distribute_profit(
    total_pnl_sats: int,
    participants: list[dict],
) -> dict[int, int]:
    """
    Distribute *total_pnl_sats* (may be negative) among *participants*
    proportionally by their ``sats_invested``.

    Returns a dict mapping user_id → sats delta.
    Rounding is resolved by assigning the remainder to the last participant.
    """
    if not participants:
        return {}

    total_invested = sum(p["sats_invested"] for p in participants)
    if total_invested == 0:
        return {p["user_id"]: 0 for p in participants}

    result: dict[int, int] = {}
    allocated = 0

    for i, participant in enumerate(participants):
        user_id = participant["user_id"]
        sats = participant["sats_invested"]

        if i == len(participants) - 1:
            # Last participant absorbs rounding remainder
            result[user_id] = total_pnl_sats - allocated
        else:
            share = int(total_pnl_sats * sats / total_invested)
            result[user_id] = share
            allocated += share

    return result


def compute_weekly_reinvestment(weekly_profit_sats: int, days: int) -> int:
    """Return the daily reinvestment amount (integer sats) from weekly profit."""
    if days <= 0:
        return 0
    return weekly_profit_sats // days


def apply_liquidation(positions: dict[int, int]) -> dict[int, int]:
    """Zero all user positions following a liquidation event."""
    return {user_id: 0 for user_id in positions}
