import Link from "next/link";
import { query } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoreBar } from "@/components/score-bar";
import { AutoRefresh } from "@/components/auto-refresh";
import { Trophy } from "lucide-react";

export const revalidate = 30;

interface UserRow {
  id: number;
  platform: string;
  platform_user_id: string;
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
      `SELECT u.id, u.platform, u.platform_user_id, u.display_name, u.accuracy, u.congruency, u.joined_at,
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

function formatIdentity(user: Pick<UserRow, "platform" | "platform_user_id">): string {
  return `${user.platform} · ${user.platform_user_id}`;
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

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-sm ring-1 ring-yellow-500/30">
        1
      </div>
    );
  if (rank === 2)
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-400/20 text-slate-300 font-bold text-sm ring-1 ring-slate-400/30">
        2
      </div>
    );
  if (rank === 3)
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-700/20 text-orange-400 font-bold text-sm ring-1 ring-orange-700/30">
        3
      </div>
    );
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground font-bold text-sm">
      {rank}
    </div>
  );
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold ring-1 ring-primary/20 shrink-0">
      {initials || "?"}
    </div>
  );
}

function UserCard({
  user,
  rank,
}: {
  user: UserRow;
  rank: number;
}) {
  return (
    <Link href={`/users/${user.id}`}>
      <Card className="hover:border-primary/30 hover:bg-secondary/30 transition-all cursor-pointer">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-4">
            <RankBadge rank={rank} />
            <UserAvatar name={user.display_name} />

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white truncate">{user.display_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatIdentity(user)} · {user.total_predictions} predictions · joined {relativeDate(user.joined_at)}
              </p>
            </div>

            <div className="hidden md:grid grid-cols-2 gap-6 w-56">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Accuracy</p>
                <ScoreBar value={user.accuracy} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Congruency</p>
                <ScoreBar value={user.congruency} />
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">Sats won</p>
              <p className="font-mono font-bold text-primary text-lg">
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

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Trophy className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
          <p className="text-sm text-muted-foreground">{users.length} participants</p>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground">No users yet.</p>
      ) : (
        <Tabs defaultValue="accuracy">
          <TabsList className="bg-secondary border border-border/30">
            <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
            <TabsTrigger value="congruency">Congruency</TabsTrigger>
            <TabsTrigger value="sats">Sats Won</TabsTrigger>
          </TabsList>

          <TabsContent value="accuracy" className="space-y-2 mt-4">
            {byAccuracy.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} />
            ))}
          </TabsContent>

          <TabsContent value="congruency" className="space-y-2 mt-4">
            {byCongruency.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} />
            ))}
          </TabsContent>

          <TabsContent value="sats" className="space-y-2 mt-4">
            {bySats.map((u, i) => (
              <UserCard key={u.id} user={u} rank={i + 1} />
            ))}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
