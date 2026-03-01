"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PinGate } from "@/components/pin-gate";
import { Info } from "lucide-react";

interface BotConfig {
  prediction_target_hour: string;
  prediction_open_hour: string;
  prediction_window_hours: string;
  min_sats: string;
  max_sats: string;
  weekly_vote_day: string;
  weekly_vote_hour: string;
  trading_enabled: string;
}

const DEFAULTS: BotConfig = {
  prediction_target_hour: "16",
  prediction_open_hour: "8",
  prediction_window_hours: "6",
  min_sats: "100",
  max_sats: "5000",
  weekly_vote_day: "6",
  weekly_vote_hour: "20",
  trading_enabled: "false",
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const FIELD_TOOLTIPS: Record<string, string> = {
  prediction_open_hour: "UTC hour (0–23) when the daily prediction window opens. Users can submit predictions from this hour.",
  prediction_target_hour: "UTC hour at which the BTC price is evaluated. Predictions are compared against the price at this hour.",
  prediction_window_hours: "How many hours the prediction window stays open. After this window closes, no more predictions are accepted.",
  min_sats: "Minimum satoshi amount required for a valid prediction. Below this, predictions are rejected.",
  max_sats: "Maximum satoshi amount allowed per prediction. Also used as the denominator for congruency scoring.",
  weekly_vote_day: "Day of the week when the weekly vote is triggered (e.g., for reinvestment decisions).",
  weekly_vote_hour: "UTC hour on the vote day when the weekly vote message is sent to the group.",
  trading_enabled: "When enabled, the bot executes real Binance trades. When disabled, it runs in dry-run mode only.",
};

function TooltipField({
  label,
  name,
  tooltip,
  children,
  currentValue,
}: {
  label: string;
  name: string;
  tooltip: string;
  children: React.ReactNode;
  currentValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-56">{tooltip}</TooltipContent>
        </Tooltip>
      </div>
      {children}
      {currentValue != null && (
        <p className="text-xs text-muted-foreground">Current: {currentValue}</p>
      )}
    </div>
  );
}

function ConfigForm({ config, onSaved }: { config: BotConfig; onSaved: (c: BotConfig) => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [current, setCurrent] = useState(config);

  const handleReset = () => {
    setCurrent({ ...DEFAULTS });
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);

    // Cross-field validation
    const minSats = parseInt(formData.get("min_sats") as string, 10);
    const maxSats = parseInt(formData.get("max_sats") as string, 10);
    if (minSats >= maxSats) {
      setMessage({ type: "error", text: "min_sats must be less than max_sats" });
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {};
    Array.from(formData.entries()).forEach(([key, value]) => {
      if (key === "trading_enabled") {
        payload[key] = value === "true";
      } else if (
        [
          "prediction_target_hour",
          "prediction_open_hour",
          "prediction_window_hours",
          "min_sats",
          "max_sats",
          "weekly_vote_day",
          "weekly_vote_hour",
        ].includes(key)
      ) {
        payload[key] = parseInt(value as string, 10);
      }
    });

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Configuration saved!" });
        const updated = await fetch("/api/config").then((r) => r.json());
        setCurrent(updated);
        onSaved(updated);
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: JSON.stringify(err.details ?? err.error) });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {message && (
        <Badge
          variant={message.type === "success" ? "success" : "destructive"}
          className="w-full justify-center py-2 text-sm"
        >
          {message.text}
        </Badge>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <TooltipField
          label="Prediction Open Hour (UTC)"
          name="prediction_open_hour"
          tooltip={FIELD_TOOLTIPS.prediction_open_hour}
          currentValue={`${current.prediction_open_hour}:00 UTC`}
        >
          <Input
            id="prediction_open_hour"
            type="number"
            name="prediction_open_hour"
            min={0}
            max={23}
            defaultValue={current.prediction_open_hour}
            key={`open_hour_${current.prediction_open_hour}`}
          />
        </TooltipField>

        <TooltipField
          label="Target Hour (UTC)"
          name="prediction_target_hour"
          tooltip={FIELD_TOOLTIPS.prediction_target_hour}
          currentValue={`${current.prediction_target_hour}:00 UTC`}
        >
          <Input
            id="prediction_target_hour"
            type="number"
            name="prediction_target_hour"
            min={0}
            max={23}
            defaultValue={current.prediction_target_hour}
            key={`target_hour_${current.prediction_target_hour}`}
          />
        </TooltipField>
      </div>

      <TooltipField
        label="Prediction Window (hours)"
        name="prediction_window_hours"
        tooltip={FIELD_TOOLTIPS.prediction_window_hours}
        currentValue={`${current.prediction_window_hours} hours`}
      >
        <Input
          id="prediction_window_hours"
          type="number"
          name="prediction_window_hours"
          min={1}
          max={12}
          defaultValue={current.prediction_window_hours}
          key={`window_${current.prediction_window_hours}`}
        />
      </TooltipField>

      <Separator />

      <div className="grid md:grid-cols-2 gap-5">
        <TooltipField
          label="Min Sats"
          name="min_sats"
          tooltip={FIELD_TOOLTIPS.min_sats}
          currentValue={`${parseInt(current.min_sats).toLocaleString()} sats`}
        >
          <Input
            id="min_sats"
            type="number"
            name="min_sats"
            min={1}
            defaultValue={current.min_sats}
            key={`min_${current.min_sats}`}
          />
        </TooltipField>

        <TooltipField
          label="Max Sats"
          name="max_sats"
          tooltip={FIELD_TOOLTIPS.max_sats}
          currentValue={`${parseInt(current.max_sats).toLocaleString()} sats`}
        >
          <Input
            id="max_sats"
            type="number"
            name="max_sats"
            min={1}
            defaultValue={current.max_sats}
            key={`max_${current.max_sats}`}
          />
        </TooltipField>
      </div>

      <Separator />

      <div className="grid md:grid-cols-2 gap-5">
        <TooltipField
          label="Weekly Vote Day"
          name="weekly_vote_day"
          tooltip={FIELD_TOOLTIPS.weekly_vote_day}
          currentValue={DAY_NAMES[parseInt(current.weekly_vote_day)]}
        >
          <Select
            id="weekly_vote_day"
            name="weekly_vote_day"
            defaultValue={current.weekly_vote_day}
            key={`vote_day_${current.weekly_vote_day}`}
          >
            {DAY_NAMES.map((day, i) => (
              <option key={i} value={i}>
                {day}
              </option>
            ))}
          </Select>
        </TooltipField>

        <TooltipField
          label="Weekly Vote Hour (UTC)"
          name="weekly_vote_hour"
          tooltip={FIELD_TOOLTIPS.weekly_vote_hour}
          currentValue={`${current.weekly_vote_hour}:00 UTC`}
        >
          <Input
            id="weekly_vote_hour"
            type="number"
            name="weekly_vote_hour"
            min={0}
            max={23}
            defaultValue={current.weekly_vote_hour}
            key={`vote_hour_${current.weekly_vote_hour}`}
          />
        </TooltipField>
      </div>

      <Separator />

      <TooltipField
        label="Trading Enabled"
        name="trading_enabled"
        tooltip={FIELD_TOOLTIPS.trading_enabled}
        currentValue={current.trading_enabled === "true" ? "Yes (live)" : "No (dry run)"}
      >
        <Select
          id="trading_enabled"
          name="trading_enabled"
          defaultValue={current.trading_enabled}
          key={`trading_${current.trading_enabled}`}
        >
          <option value="true">Yes — execute trades</option>
          <option value="false">No — dry run only</option>
        </Select>
      </TooltipField>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
        <Button type="button" variant="outline" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </div>
    </form>
  );
}

export default function ConfigPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [config, setConfig] = useState<BotConfig | null>(null);

  // Check for existing admin cookie by attempting to load config
  useEffect(() => {
    // We check the admin cookie status via a lightweight HEAD or by checking the cookie client-side
    // Since httpOnly cookies can't be read from JS, we attempt to load config optimistically
    // and let the PIN gate show if needed. On first load, check if admin cookie exists
    // by seeing if document.cookie has any matching value (non-httpOnly check would fail,
    // so we use the PIN gate as default and rely on the cookie being set on success).
    const checkAdmin = async () => {
      // Try to probe if we already have the admin cookie (via a simple API call that would work)
      // Since we can't read httpOnly cookies, we store a non-httpOnly marker in sessionStorage
      if (sessionStorage.getItem("cassandrina_admin") === "1") {
        await loadConfig();
        setUnlocked(true);
      }
    };
    checkAdmin();
  }, []);

  const loadConfig = async () => {
    const cfg = await fetch("/api/config").then((r) => r.json());
    setConfig(cfg);
  };

  const handleUnlock = async () => {
    sessionStorage.setItem("cassandrina_admin", "1");
    await loadConfig();
    setUnlocked(true);
  };

  if (!unlocked) {
    return <PinGate onUnlock={handleUnlock} />;
  }

  if (!config) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-primary">Bot Configuration</h1>
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfigForm config={config} onSaved={setConfig} />
        </CardContent>
      </Card>
    </div>
  );
}
