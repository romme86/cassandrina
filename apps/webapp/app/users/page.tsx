import { query } from "@/lib/db";
import type { User } from "@cassandrina/shared";

export const dynamic = "force-dynamic";

async function getUsers(): Promise<User[]> {
  try {
    return await query<User>(
      "SELECT id, whatsapp_jid, display_name, accuracy, congruency, joined_at FROM users ORDER BY accuracy DESC"
    );
  } catch {
    return [];
  }
}

function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-2">
        <div
          className="bg-orange-400 rounded-full h-2 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono w-10 text-right">{value.toFixed(1)}%</span>
    </div>
  );
}

export default async function UsersPage() {
  const users = await getUsers();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-orange-400">Leaderboard</h1>

      <div className="grid gap-4">
        {users.length === 0 ? (
          <p className="text-gray-500">No users yet</p>
        ) : (
          users.map((user, i) => (
            <div
              key={user.id}
              className="bg-gray-900 rounded-xl p-5 border border-gray-800 flex flex-col md:flex-row md:items-center gap-4"
            >
              <div className="text-3xl font-bold text-gray-600 w-8">
                {i + 1}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{user.display_name}</p>
                <p className="text-xs text-gray-500">{user.whatsapp_jid}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 flex-1">
                <div>
                  <p className="text-xs text-gray-400 mb-1">🎯 Accuracy</p>
                  <ScoreBar value={user.accuracy} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">🧠 Congruency</p>
                  <ScoreBar value={user.congruency} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
