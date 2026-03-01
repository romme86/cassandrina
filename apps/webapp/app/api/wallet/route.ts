import { NextResponse } from "next/server";
import { query } from "@/lib/db";

interface LndBalance {
  onchainConfirmed: number;
  onchainUnconfirmed: number;
  channelLocal: number;
  channelRemote: number;
}

async function getLndBalance(): Promise<LndBalance> {
  const host = process.env.LND_HOST;
  const port = process.env.LND_PORT ?? "8080";
  const macaroon = process.env.LND_MACAROON_HEX;

  if (!host || !macaroon) {
    return { onchainConfirmed: 0, onchainUnconfirmed: 0, channelLocal: 0, channelRemote: 0 };
  }

  try {
    const [onchainRes, channelRes] = await Promise.all([
      fetch(`https://${host}:${port}/v1/balance/blockchain`, {
        headers: { "Grpc-Metadata-Macaroon": macaroon },
      }),
      fetch(`https://${host}:${port}/v1/balance/channels`, {
        headers: { "Grpc-Metadata-Macaroon": macaroon },
      }),
    ]);

    const onchain = onchainRes.ok ? await onchainRes.json() : {};
    const channel = channelRes.ok ? await channelRes.json() : {};

    return {
      onchainConfirmed: parseInt(onchain.confirmed_balance ?? "0", 10),
      onchainUnconfirmed: parseInt(onchain.unconfirmed_balance ?? "0", 10),
      channelLocal: parseInt(channel.local_balance?.sat ?? "0", 10),
      channelRemote: parseInt(channel.remote_balance?.sat ?? "0", 10),
    };
  } catch {
    return { onchainConfirmed: 0, onchainUnconfirmed: 0, channelLocal: 0, channelRemote: 0 };
  }
}

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
      r_hash: string;
      memo: string | null;
      sats_amount: number;
      paid: boolean;
      created_at: string;
    }>(
      `SELECT encode(payment_hash, 'hex') AS r_hash,
              memo, sats_amount, paid, created_at
       FROM lightning_invoices
       ORDER BY created_at DESC LIMIT 50`
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
      id: `inv-${inv.r_hash}`,
      type: "invoice" as const,
      description: inv.memo ?? "Lightning invoice",
      amount_sats: inv.sats_amount,
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
