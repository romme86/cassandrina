"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface StrategyData {
  strategy: string;
  total_trades: number;
  wins: number;
  avg_pnl_sats: number;
  total_pnl_sats: number;
}

interface StrategyChartProps {
  data: StrategyData[];
}

const STRATEGY_COLORS: Record<string, string> = {
  A: "#34d399",
  B: "#22c55e",
  C: "#10b981",
  D: "#059669",
  E: "#6ee7b7",
};

export function StrategyChart({ data }: StrategyChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No strategy data yet.
      </div>
    );
  }

  const formatted = data.map((d) => ({
    ...d,
    win_rate: d.total_trades > 0 ? Math.round((d.wins / d.total_trades) * 100) : 0,
  }));

  const tooltipStyle = {
    backgroundColor: "hsl(147 25% 11%)",
    border: "1px solid hsl(148 18% 22%)",
    borderRadius: "0.75rem",
    color: "hsl(210 40% 95%)",
    fontSize: "12px",
  };

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} layout="vertical">
        <CartesianGrid strokeDasharray="4 4" stroke="hsl(148 18% 22%)" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }}
        />
        <YAxis
          type="category"
          dataKey="strategy"
          tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }}
          width={70}
          tickFormatter={(v) => `Strategy ${v}`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, _name: string, props) => [
            `${v}% (${props.payload.wins}/${props.payload.total_trades})`,
            "Win Rate",
          ]}
        />
        <Bar dataKey="win_rate" radius={[0, 4, 4, 0]}>
          {formatted.map((d) => (
            <Cell key={d.strategy} fill={STRATEGY_COLORS[d.strategy] ?? "#6b7280"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
