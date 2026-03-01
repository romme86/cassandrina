"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";

interface PnlDataPoint {
  day: string;
  daily_pnl: number;
  cumulative_pnl: number;
}

interface PnlChartProps {
  data: PnlDataPoint[];
}

export function PnlChart({ data }: PnlChartProps) {
  const [mode, setMode] = useState<"cumulative" | "daily">("cumulative");

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No trade data yet — charts will appear once trades are closed.
      </div>
    );
  }

  const formatted = data.map((d) => ({
    ...d,
    day: new Date(d.day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  const tooltipStyle = {
    backgroundColor: "hsl(147 25% 11%)",
    border: "1px solid hsl(148 18% 22%)",
    borderRadius: "0.75rem",
    color: "hsl(210 40% 95%)",
    fontSize: "12px",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "cumulative" ? "default" : "outline"}
          onClick={() => setMode("cumulative")}
        >
          Cumulative
        </Button>
        <Button
          size="sm"
          variant={mode === "daily" ? "default" : "outline"}
          onClick={() => setMode("daily")}
        >
          Daily
        </Button>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        {mode === "cumulative" ? (
          <AreaChart data={formatted}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(150 80% 50%)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="hsl(150 80% 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="hsl(148 18% 22%)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} sats`, "Cumulative P&L"]} />
            <Area
              type="monotone"
              dataKey="cumulative_pnl"
              stroke="hsl(150 80% 50%)"
              fill="url(#pnlGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        ) : (
          <BarChart data={formatted}>
            <CartesianGrid strokeDasharray="4 4" stroke="hsl(148 18% 22%)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(145 13% 66%)" }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} sats`, "Daily P&L"]} />
            <Bar
              dataKey="daily_pnl"
              fill="hsl(150 80% 50%)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
