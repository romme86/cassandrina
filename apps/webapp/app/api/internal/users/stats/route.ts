import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const platformUserId = searchParams.get("platform_user_id");

  if (!platform || !platformUserId) {
    return NextResponse.json(
      { error: "platform and platform_user_id are required." },
      { status: 400 }
    );
  }

  const rows = await query<{
    user_id: number;
    display_name: string;
    platform_user_id: string;
    accuracy: number;
    congruency: number;
    balance_sats: number;
    profit_sats: number;
    total_predictions: number;
  }>(
    `SELECT u.id AS user_id,
            u.display_name,
            u.platform_user_id,
            u.accuracy,
            u.congruency,
            COALESCE(p.total_predictions, 0)::int AS total_predictions,
            COALESCE(b.balance_sats, 0)::int AS balance_sats,
            COALESCE(b.profit_sats, 0)::int AS profit_sats
     FROM users u
     LEFT JOIN (
       SELECT user_id, COUNT(*)::int AS total_predictions
       FROM predictions
       GROUP BY user_id
     ) p ON p.user_id = u.id
     LEFT JOIN (
       SELECT user_id,
              COALESCE(SUM(delta_sats), 0)::int AS balance_sats,
              COALESCE(SUM(CASE WHEN reason <> 'invoice_paid' THEN delta_sats ELSE 0 END), 0)::int AS profit_sats
       FROM balance_entries
       GROUP BY user_id
     ) b ON b.user_id = u.id
     WHERE u.platform = $1 AND u.platform_user_id = $2
     LIMIT 1`,
    [platform, platformUserId]
  );

  if (rows.length === 0) {
    return NextResponse.json({
      user_id: null,
      display_name: `${platform}-${platformUserId}`,
      platform_user_id: platformUserId,
      accuracy: 0.5,
      congruency: 0.5,
      balance_sats: 0,
      profit_sats: 0,
      total_predictions: 0,
    });
  }

  return NextResponse.json(rows[0]);
}
