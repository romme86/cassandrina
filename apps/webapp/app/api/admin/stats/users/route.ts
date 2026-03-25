import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query<{
    id: number;
    display_name: string;
    accuracy: number;
    congruency: number;
    balance_sats: number;
    profit_sats: number;
    total_predictions: number;
  }>(
    `SELECT u.id,
            u.display_name,
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
     ORDER BY balance_sats DESC, accuracy DESC, congruency DESC, u.id ASC`
  );

  return NextResponse.json(rows);
}
