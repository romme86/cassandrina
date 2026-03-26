import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { payLndInvoice } from "@/lib/lnd";
import { WithdrawSchema } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = WithdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { platform, platform_user_id, payment_request, amount_sats } = parsed.data;

  // Look up user
  const userRows = await query<{ id: number }>(
    "SELECT id FROM users WHERE platform = $1 AND platform_user_id = $2",
    [platform, platform_user_id]
  );
  if (userRows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = userRows[0].id;

  // Check balance inside a transaction with advisory lock
  try {
    const paymentResult = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(2147483646, $1)", [userId]);

      const balanceResult = await client.query<{ balance: string }>(
        "SELECT COALESCE(SUM(delta_sats), 0) AS balance FROM balance_entries WHERE user_id = $1",
        [userId]
      );
      const balance = parseInt(balanceResult.rows[0].balance, 10);

      if (balance < amount_sats) {
        throw new InsufficientBalanceError(balance);
      }

      // Attempt Lightning payment
      const result = await payLndInvoice(payment_request);

      // Debit user balance
      await client.query(
        `INSERT INTO balance_entries (user_id, delta_sats, reason)
         VALUES ($1, $2, 'withdrawal')`,
        [userId, -amount_sats]
      );

      return result;
    });

    return NextResponse.json(
      {
        payment_hash: paymentResult.paymentHash,
        fee_sats: paymentResult.feeSats,
        amount_sats,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof InsufficientBalanceError) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: ${error.balance} sats` },
        { status: 400 }
      );
    }
    console.error("[withdraw] payment failed", error);
    return NextResponse.json(
      { error: "Withdrawal failed. Please try again." },
      { status: 503 }
    );
  }
}

class InsufficientBalanceError extends Error {
  constructor(public balance: number) {
    super("Insufficient balance");
  }
}
