"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface AccuracyPoint {
  question_date: string;
  correct: boolean;
  predicted_price: number;
  btc_actual_price: number | null;
}

interface AccuracyChartProps {
  data: AccuracyPoint[];
}

export function AccuracyChart({ data }: AccuracyChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        No prediction history yet.
      </div>
    );
  }

  const formatted = data
    .slice(0, 15)
    .reverse()
    .map((d, i) => ({
      round: i + 1,
      date: new Date(d.question_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      delta:
        d.btc_actual_price != null
          ? Math.abs((d.predicted_price - d.btc_actual_price) / d.predicted_price) * 100
          : null,
      correct: d.correct,
    }));

  const tooltipStyle = {
    backgroundColor: "hsl(222 47% 8%)",
    border: "1px solid hsl(217 33% 17%)",
    borderRadius: "0.5rem",
    color: "hsl(210 40% 95%)",
    fontSize: "12px",
  };

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={formatted}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} />
        <YAxis
          tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }}
          tickFormatter={(v) => `${v.toFixed(1)}%`}
          reversed
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number) => [`${v.toFixed(2)}% off`, "Δ from actual"]}
        />
        <ReferenceLine y={2} stroke="hsl(24 95% 53%)" strokeDasharray="4 4" label={{ value: "±2%", fill: "hsl(215 20% 55%)", fontSize: 10 }} />
        <Line
          type="monotone"
          dataKey="delta"
          stroke="hsl(24 95% 53%)"
          strokeWidth={2}
          dot={(props) => {
            const { cx, cy, payload } = props;
            return (
              <circle
                key={payload.date}
                cx={cx}
                cy={cy}
                r={4}
                fill={payload.correct ? "#16a34a" : "#dc2626"}
                stroke="none"
              />
            );
          }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
