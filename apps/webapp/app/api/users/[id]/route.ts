import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function isPredictionCorrect(predicted: number, actual: number): boolean {
  if (actual === 0) return false;
  const errorPct = Math.abs(predicted - actual) / actual;
  return errorPct <= 0.02; // within 2%
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const userRows = await query<{
    id: number;
    platform: string;
    platform_user_id: string;
    display_name: string;
    accuracy: number;
    congruency: number;
    joined_at: string;
  }>("SELECT id, platform, platform_user_id, display_name, accuracy, congruency, joined_at FROM users WHERE id = $1", [id]);

  if (userRows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const predictions = await query<{
    id: number;
    predicted_price: number;
    sats_amount: number;
    paid: boolean;
    created_at: string;
    question_date: string;
    btc_actual_price: number | null;
    btc_target_price: number | null;
    round_status: string;
    confidence_score: number | null;
    user_confidence_score: number | null;
    strategy_used: string | null;
    base_direction: "long" | "short" | null;
    polymarket_influence_pct: number | null;
    decision_metrics: Record<string, unknown> | null;
  }>(
    `SELECT p.id, p.predicted_price, p.sats_amount, p.paid, p.created_at,
            r.question_date, r.btc_actual_price, r.btc_target_price,
            r.status AS round_status, r.confidence_score, r.user_confidence_score,
            r.strategy_used, r.base_direction, r.polymarket_influence_pct, r.decision_metrics
     FROM predictions p
     JOIN prediction_rounds r ON r.id = p.round_id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [id]
  );

  const enriched = predictions.map((p) => {
    const correct =
      p.btc_actual_price != null
        ? isPredictionCorrect(p.predicted_price, p.btc_actual_price)
        : null;
    const errorPct =
      p.btc_actual_price != null && p.btc_actual_price > 0
        ? Math.abs(p.predicted_price - p.btc_actual_price) / p.btc_actual_price
        : null;
    return { ...p, correct, error_pct: errorPct };
  });

  const settled = enriched.filter((p) => p.correct !== null);
  const hits = settled.filter((p) => p.correct).length;
  const balanceRows = await query<{ balance: string }>(
    "SELECT COALESCE(SUM(delta_sats), 0) AS balance FROM balance_entries WHERE user_id = $1",
    [id]
  );

  const stats = {
    total_predictions: enriched.length,
    settled_predictions: settled.length,
    hits,
    misses: settled.length - hits,
    hit_rate: settled.length > 0 ? hits / settled.length : 0,
    balance_sats: parseInt(balanceRows[0].balance, 10),
  };

  return NextResponse.json({ user: userRows[0], predictions: enriched, stats });
}
