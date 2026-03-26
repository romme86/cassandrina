import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { createLndInvoice } from "@/lib/lnd";
import { getRedis } from "@/lib/redis";
import { CreatePredictionSchema } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

class DuplicatePredictionError extends Error {
  constructor() {
    super("Duplicate prediction");
  }
}

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

async function checkRateLimit(identity: string): Promise<boolean> {
  const redis = getRedis();
  const key = `cassandrina:ratelimit:prediction:${identity}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  return count <= RATE_LIMIT_MAX;
}

function defaultDisplayName(platform: string, platformUserId: string): string {
  if (platform === "telegram") {
    return `telegram-${platformUserId}`;
  }
  return `${platform}-${platformUserId}`;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreatePredictionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const {
    platform,
    platform_user_id,
    display_name,
    predicted_low_price,
    predicted_high_price,
    sats_amount,
  } = parsed.data;
  const identityKey = `${platform}:${platform_user_id}`;
  const predicted_price = (predicted_low_price + predicted_high_price) / 2;

  if (!(await checkRateLimit(identityKey))) {
    return NextResponse.json(
      { error: "Too many prediction attempts. Wait a few minutes." },
      { status: 429 }
    );
  }

  // Find or create user
  const userRows = await query<{ id: number }>(
    "SELECT id FROM users WHERE platform = $1 AND platform_user_id = $2",
    [platform, platform_user_id]
  );
  let userId: number;
  if (userRows.length === 0) {
    const newUser = await query<{ id: number }>(
      "INSERT INTO users (platform, platform_user_id, display_name) VALUES ($1, $2, $3) RETURNING id",
      [
        platform,
        platform_user_id,
        display_name ?? defaultDisplayName(platform, platform_user_id),
      ]
    );
    userId = newUser[0].id;
  } else {
    userId = userRows[0].id;
  }

  // Find open round
  const roundRows = await query<{ id: number }>(
    "SELECT id FROM prediction_rounds WHERE status = 'open' ORDER BY open_at DESC, id DESC LIMIT 1"
  );
  if (roundRows.length === 0) {
    return NextResponse.json(
      { error: "No open prediction round" },
      { status: 409 }
    );
  }
  const roundId = roundRows[0].id;

  const memo = `Cassandrina prediction - round ${roundId}`;

  let invoice;
  try {
    invoice = await createLndInvoice(sats_amount, memo, 3600);
  } catch (error) {
    console.error("[predictions] failed to create Lightning invoice", error);
    return NextResponse.json(
      { error: "Lightning invoice creation is unavailable right now. Please try again shortly." },
      { status: 503 }
    );
  }

  // Use advisory lock + duplicate check inside transaction to prevent races
  let prediction: { id: number };
  try {
    prediction = await withTransaction(async (client) => {
      // Advisory lock scoped to (roundId, userId) — prevents concurrent inserts
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [roundId, userId]);

      const existing = await client.query(
        "SELECT id FROM predictions WHERE round_id = $1 AND user_id = $2",
        [roundId, userId]
      );
      if (existing.rows.length > 0) {
        throw new DuplicatePredictionError();
      }

      const predictionResult = await client.query<{ id: number }>(
        `INSERT INTO predictions
           (round_id, user_id, predicted_low_price, predicted_high_price, predicted_price, sats_amount, lightning_invoice)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          roundId,
          userId,
          predicted_low_price,
          predicted_high_price,
          predicted_price,
          sats_amount,
          invoice.paymentRequest,
        ]
      );

      const predictionId = predictionResult.rows[0].id;

      await client.query(
        `INSERT INTO lightning_invoices
           (prediction_id, payment_hash, invoice, memo, amount_sats, expires_at)
         VALUES ($1, decode($2, 'hex'), $3, $4, $5, $6)`,
        [
          predictionId,
          invoice.rHashHex,
          invoice.paymentRequest,
          memo,
          sats_amount,
          invoice.expiresAt,
        ]
      );

      return { id: predictionId };
    });
  } catch (error) {
    if (error instanceof DuplicatePredictionError) {
      return NextResponse.json(
        { error: "You already submitted a prediction for this round" },
        { status: 409 }
      );
    }
    throw error;
  }

  return NextResponse.json(
    {
      prediction_id: prediction.id,
      lightning_invoice: invoice.paymentRequest,
      expires_at: invoice.expiresAt,
    },
    { status: 201 }
  );
}
