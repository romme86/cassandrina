import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const roundId = searchParams.get("round_id");
  const userId = searchParams.get("user_id");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (roundId) {
    params.push(parseInt(roundId, 10));
    conditions.push(`p.round_id = $${params.length}`);
  }
  if (userId) {
    params.push(parseInt(userId, 10));
    conditions.push(`p.user_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  try {
    const predictions = await query<{
      id: number;
      user_id: number;
      display_name: string;
      predicted_price: number;
      sats_amount: number;
      paid: boolean;
      created_at: string;
      round_id: number;
      question_date: string;
      round_status: string;
      btc_actual_price: number | null;
      btc_target_price: number | null;
    }>(
      `SELECT p.id, p.user_id, u.display_name, p.predicted_price, p.sats_amount,
              p.paid, p.created_at, p.round_id,
              r.question_date, r.status AS round_status,
              r.btc_actual_price, r.btc_target_price
       FROM predictions p
       JOIN users u ON u.id = p.user_id
       JOIN prediction_rounds r ON r.id = p.round_id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    return NextResponse.json({ predictions });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
