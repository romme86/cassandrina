import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { BotConfigSchema } from "@cassandrina/shared";

export async function GET() {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM bot_config"
  );
  const config = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BotConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const updates = Object.entries(parsed.data).filter(
    ([, v]) => v !== undefined
  );

  for (const [key, value] of updates) {
    await query(
      "UPDATE bot_config SET value = $1, updated_at = NOW() WHERE key = $2",
      [String(value), key]
    );
  }

  return NextResponse.json({ updated: updates.map(([k]) => k) });
}
