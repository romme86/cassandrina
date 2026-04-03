import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin";
import { BotConfigSchema } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM bot_config"
  );
  const config = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  await withTransaction(async (client) => {
    for (const [key, value] of updates) {
      await client.query(
        `INSERT INTO bot_config (key, value, updated_at)
         VALUES ($2, $1, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(value), key]
      );
    }
  });

  return NextResponse.json({ updated: updates.map(([k]) => k) });
}
