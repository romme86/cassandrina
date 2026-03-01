import Link from "next/link";
import { query } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreBar } from "@/components/score-bar";
import { AutoRefresh } from "@/components/auto-refresh";

export const revalidate = 30;

interface UserRow {
  id: number;
  whatsapp_jid: string;
  display_name: string;
  accuracy: number;
  congruency: number;
  joined_at: string;
  total_predictions: number;
  paid_predictions: number;
  total_sats_won: number;
}

async function getUsers(): Promise<UserRow[]> {
  try {
    return await query<UserRow>(
      `SELECT u.id, u.whatsapp_jid, u.display_name, u.accuracy, u.congruency, u.joined_at,
              COUNT(DISTINCT p.id)::int AS total_predictions,
              SUM(CASE WHEN p.paid THEN 1 ELSE 0 END)::int AS paid_predictions,
              COALESCE(SUM(be.delta_sats) FILTER (WHERE be.delta_sats > 0), 0)::int AS total_sats_won
       FROM users u
       LEFT JOIN predictions p ON p.user_id = u.id
       LEFT JOIN balance_entries be ON be.user_id = u.id
       GROUP BY u.id
       ORDER BY u.accuracy DESC`
    );
  } catch {
    return [];
  }
}

function relativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function UserCard({
  user,
  rank,
  sortKey,
}: {
  user: UserRow;
  rank: number;
  sortKey: "accuracy" | "congruency" | "sats_won";
}) {
  return (
    <Link href={`/users/${user.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="text-2xl font-bold text-muted-foreground w-8 shrink-0">
              {rank <= 3 ? MEDALS[rank - 1] : rank}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{user.display_name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.whatsapp_jid}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Joined {relativeDate(user.joined_at)} · {user.total_predictions} predictions
                ({user.paid_predictions} paid)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 flex-1">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Accuracy</p>
                <ScoreBar value={user.accuracy} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Congruency</p>
                <ScoreBar value={user.congruency} />
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">Sats won</p>
              <p className="font-mono font-semibold text-primary">
                {user.total_sats_won.toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function UsersPage() {
  const users = await getUsers();

  const byAccuracy = [...users].sort((a, b) => b.accuracy - a.accuracy);
  const byCongruency = [...users].sort((a, b) => b.congruency - a.congruency);
  const bySats = [...users].sort((a, b) => b.total_sats_won - a.total_sats_won);

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <h1 className="text-2xl font-bold text-primary">Leaderboard</h1>

      {users.length === 0 ? (
        <p className="text-muted-foreground">No users yet.</p>
      ) : (
        <Tabs defaultValue="accuracy">
          <TabsList>
            <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
            <TabsTrigger value="congruency">Congruency</TabsTrigger>
            <TabsTrigger value="sats">Sats Won</TabsTrigger>
          </TabsList>

          <TabsContent value="accuracy" className="space-y-3 mt-4">
            {byAccuracy.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} sortKey="accuracy" />
            ))}
          </TabsContent>

          <TabsContent value="congruency" className="space-y-3 mt-4">
            {byCongruency.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} sortKey="congruency" />
            ))}
          </TabsContent>

          <TabsContent value="sats" className="space-y-3 mt-4">
            {bySats.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} sortKey="sats_won" />
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
