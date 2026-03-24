import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { PredictionRound } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid round id" }, { status: 400 });
  }

  const rows = await query<PredictionRound>(
    "SELECT * FROM prediction_rounds WHERE id = $1",
    [id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Round not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
