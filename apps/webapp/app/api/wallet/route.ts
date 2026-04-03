import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getLndBalance } from "@/lib/lnd";

export const dynamic = "force-dynamic";

interface TxRow {
  id: string;
  type: "invoice" | "trade";
  description: string;
  amount_sats: number;
  settled: boolean;
  created_at: string;
}

async function getTransactions(): Promise<TxRow[]> {
  try {
    const invoices = await query<{
      payment_hash: string;
      memo: string | null;
      amount_sats: number;
      paid: boolean;
      created_at: string;
      invoice: string;
    }>(
      `SELECT encode(li.payment_hash, 'hex') AS payment_hash,
              li.memo, li.amount_sats, li.paid, li.created_at, li.invoice
       FROM lightning_invoices
       ORDER BY li.created_at DESC LIMIT 50`
    );
    const trades = await query<{
      id: number;
      pnl_sats: number | null;
      strategy: string;
      direction: string;
      opened_at: string;
      status: string;
    }>(
      `SELECT id, pnl_sats, strategy, direction, opened_at, status
       FROM trades
       ORDER BY opened_at DESC LIMIT 50`
    );

    const invoiceTxs: TxRow[] = invoices.map((inv) => ({
      id: `inv-${inv.payment_hash}`,
      type: "invoice" as const,
      description: inv.memo ?? "Lightning invoice",
      amount_sats: inv.amount_sats,
      settled: inv.paid,
      created_at: inv.created_at,
    }));

    const tradeTxs: TxRow[] = trades.map((t) => ({
      id: `trade-${t.id}`,
      type: "trade" as const,
      description: `Strategy ${t.strategy} ${t.direction}`,
      amount_sats: t.pnl_sats ?? 0,
      settled: t.status !== "open",
      created_at: t.opened_at,
    }));

    return [...invoiceTxs, ...tradeTxs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  } catch {
    // No lightning_invoices table yet — return just trade activity
    try {
      const trades = await query<{
        id: number;
        pnl_sats: number | null;
        strategy: string;
        direction: string;
        opened_at: string;
        status: string;
      }>(
        `SELECT id, pnl_sats, strategy, direction, opened_at, status
         FROM trades
         ORDER BY opened_at DESC LIMIT 50`
      );
      return trades.map((t) => ({
        id: `trade-${t.id}`,
        type: "trade" as const,
        description: `Strategy ${t.strategy} ${t.direction}`,
        amount_sats: t.pnl_sats ?? 0,
        settled: t.status !== "open",
        created_at: t.opened_at,
      }));
    } catch {
      return [];
    }
  }
}

export async function GET() {
  const [balance, transactions] = await Promise.all([getLndBalance(), getTransactions()]);
  return NextResponse.json({ balance, transactions });
}
