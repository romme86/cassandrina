import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { createLndInvoice } from "@/lib/lnd";
import { CreatePredictionSchema } from "@cassandrina/shared";

// Rate limiting: max 3 prediction attempts per user identity per 10 minutes
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(identity: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(identity);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identity, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
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

  const { platform, platform_user_id, display_name, predicted_price, sats_amount } = parsed.data;
  const identityKey = `${platform}:${platform_user_id}`;

  if (!checkRateLimit(identityKey)) {
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
    "SELECT id FROM prediction_rounds WHERE status = 'open' ORDER BY question_date DESC LIMIT 1"
  );
  if (roundRows.length === 0) {
    return NextResponse.json(
      { error: "No open prediction round" },
      { status: 409 }
    );
  }
  const roundId = roundRows[0].id;

  // Check for existing prediction in this round
  const existing = await query(
    "SELECT id FROM predictions WHERE round_id = $1 AND user_id = $2",
    [roundId, userId]
  );
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "You already submitted a prediction for this round" },
      { status: 409 }
    );
  }

  const memo = `Cassandrina prediction - round ${roundId}`;

  // Create LND invoice
  const invoice = await createLndInvoice(sats_amount, memo, 3600);

  // Store prediction and invoice metadata atomically
  const prediction = await withTransaction(async (client) => {
    const predictionResult = await client.query<{ id: number }>(
      `INSERT INTO predictions
         (round_id, user_id, predicted_price, sats_amount, lightning_invoice)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [roundId, userId, predicted_price, sats_amount, invoice.paymentRequest]
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

  return NextResponse.json(
    {
      prediction_id: prediction.id,
      lightning_invoice: invoice.paymentRequest,
      expires_at: invoice.expiresAt,
    },
    { status: 201 }
  );
}
