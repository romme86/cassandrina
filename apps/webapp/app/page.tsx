import { query } from "@/lib/db";
import type { Trade, PredictionRound } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

async function getOpenTrades(): Promise<Trade[]> {
  try {
    return await query<Trade>(
      "SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC"
    );
  } catch {
    return [];
  }
}

async function getCurrentRound(): Promise<PredictionRound | null> {
  try {
    const rows = await query<PredictionRound>(
      "SELECT * FROM prediction_rounds WHERE status = 'open' ORDER BY question_date DESC LIMIT 1"
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function StrategyBadge({ strategy }: { strategy: string | null }) {
  const colors: Record<string, string> = {
    A: "bg-red-600",
    B: "bg-orange-600",
    C: "bg-yellow-600",
    D: "bg-blue-600",
    E: "bg-green-700",
  };
  if (!strategy) return null;
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${colors[strategy] ?? "bg-gray-600"}`}>
      Strategy {strategy}
    </span>
  );
}

export default async function DashboardPage() {
  const [trades, round] = await Promise.all([getOpenTrades(), getCurrentRound()]);

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl_sats ?? 0), 0);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-orange-400">Dashboard</h1>

      {/* Round Status */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">Current Round</h2>
        {round ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Date</p>
              <p className="font-mono">{round.question_date}</p>
            </div>
            <div>
              <p className="text-gray-400">Target Hour</p>
              <p className="font-mono">{round.target_hour}:00 UTC</p>
            </div>
            <div>
              <p className="text-gray-400">Confidence</p>
              <p className="font-mono">
                {round.confidence_score != null
                  ? `${round.confidence_score.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-gray-400">Strategy</p>
              <StrategyBadge strategy={round.strategy_used} />
            </div>
          </div>
        ) : (
          <p className="text-gray-500">No open round</p>
        )}
      </section>

      {/* Open Positions */}
      <section className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold mb-4">
          Open Positions
          <span className="ml-2 text-sm text-gray-400">
            ({trades.length} active, {totalPnl >= 0 ? "+" : ""}{totalPnl} sats P&L)
          </span>
        </h2>
        {trades.length === 0 ? (
          <p className="text-gray-500">No open positions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="text-left py-2">Strategy</th>
                  <th className="text-left py-2">Direction</th>
                  <th className="text-right py-2">Entry</th>
                  <th className="text-right py-2">Target</th>
                  <th className="text-right py-2">Leverage</th>
                  <th className="text-right py-2">Sats</th>
                  <th className="text-right py-2">P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="py-2">
                      <StrategyBadge strategy={t.strategy} />
                    </td>
                    <td className={`py-2 ${t.direction === "long" ? "text-green-400" : "text-red-400"}`}>
                      {t.direction.toUpperCase()}
                    </td>
                    <td className="py-2 text-right font-mono">${t.entry_price.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">${t.target_price.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">{t.leverage}x</td>
                    <td className="py-2 text-right font-mono">{t.sats_deployed.toLocaleString()}</td>
                    <td className={`py-2 text-right font-mono ${(t.pnl_sats ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {t.pnl_sats != null ? `${t.pnl_sats >= 0 ? "+" : ""}${t.pnl_sats}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
