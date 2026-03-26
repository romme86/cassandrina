import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/admin";
import { query, withTransaction } from "@/lib/db";
import { deriveBotControlStatus } from "@/lib/bot-control";

export const dynamic = "force-dynamic";

const BotActionSchema = z.object({
  action: z.enum(["restart", "pause", "stop"]),
});

async function loadBotConfig(): Promise<Record<string, string>> {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM bot_config"
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function upsertBotConfig(entries: Record<string, string>) {
  await withTransaction(async (client) => {
    for (const [key, value] of Object.entries(entries)) {
      await client.query(
        `INSERT INTO bot_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }
  });
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await loadBotConfig();
  return NextResponse.json(deriveBotControlStatus(config));
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

  const parsed = BotActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const action = parsed.data.action;
  const updates: Record<string, string> = {
    bot_desired_state: action === "restart" ? "running" : action,
  };

  if (action === "restart") {
    updates.bot_restart_token = new Date().toISOString();
  }

  await upsertBotConfig(updates);

  const config = await loadBotConfig();
  return NextResponse.json({
    requestedAction: action,
    status: deriveBotControlStatus(config),
  });
}
