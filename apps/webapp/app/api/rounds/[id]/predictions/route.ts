import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid round id" }, { status: 400 });
  }

  const rows = await query<{
    id: number;
    predicted_price: number;
    sats_amount: number;
    paid: boolean;
    created_at: string;
    display_name: string;
    user_accuracy: number;
  }>(
    `SELECT p.id, p.predicted_price, p.sats_amount, p.paid, p.created_at,
            u.display_name, u.accuracy AS user_accuracy
     FROM predictions p
     JOIN users u ON u.id = p.user_id
     WHERE p.round_id = $1
     ORDER BY p.sats_amount DESC`,
    [id]
  );

  return NextResponse.json(rows);
}
