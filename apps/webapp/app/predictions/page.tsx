import { query } from "@/lib/db";
import type { PredictionRound } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

async function getRounds(): Promise<PredictionRound[]> {
  try {
    return await query<PredictionRound>(
      "SELECT * FROM prediction_rounds ORDER BY question_date DESC LIMIT 30"
    );
  } catch {
    return [];
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-green-800 text-green-200",
    closed: "bg-gray-700 text-gray-300",
    settled: "bg-blue-800 text-blue-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${colors[status] ?? "bg-gray-700"}`}>
      {status}
    </span>
  );
}

export default async function PredictionsPage() {
  const rounds = await getRounds();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-orange-400">Prediction History</h1>

      <div className="overflow-x-auto bg-gray-900 rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="text-gray-400 border-b border-gray-800">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Polymarket</th>
              <th className="text-right px-4 py-3">Confidence</th>
              <th className="text-left px-4 py-3">Strategy</th>
              <th className="text-right px-4 py-3">Target Price</th>
              <th className="text-right px-4 py-3">Actual Price</th>
            </tr>
          </thead>
          <tbody>
            {rounds.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No rounds yet
                </td>
              </tr>
            ) : (
              rounds.map((r) => (
                <tr key={r.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-mono">{r.question_date}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.polymarket_probability != null
                      ? `${(r.polymarket_probability * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.confidence_score != null
                      ? `${r.confidence_score.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.strategy_used ? (
                      <span className="font-bold text-orange-400">
                        Strategy {r.strategy_used}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.btc_target_price != null
                      ? `$${r.btc_target_price.toLocaleString()}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.btc_actual_price != null
                      ? `$${r.btc_actual_price.toLocaleString()}`
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
