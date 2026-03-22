import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

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
    strategy_used: string | null;
  }>(
    `SELECT p.id, p.predicted_price, p.sats_amount, p.paid, p.created_at,
            r.question_date, r.btc_actual_price, r.btc_target_price,
            r.status AS round_status, r.confidence_score, r.strategy_used
     FROM predictions p
     JOIN prediction_rounds r ON r.id = p.round_id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT 30`,
    [id]
  );

  return NextResponse.json({ user: userRows[0], predictions });
}
