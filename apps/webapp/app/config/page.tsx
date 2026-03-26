"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { BotLifecycleBadge } from "@/components/bot-lifecycle-badge";
import { PinGate } from "@/components/pin-gate";
import { withBasePath } from "@/lib/base-path";
import type { BotControlStatus } from "@/lib/bot-control";
import { Info, Settings, Clock, Coins, Calendar, Zap, PauseCircle, Power, RotateCcw } from "lucide-react";

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
  prediction_target_hour: "19",
  prediction_open_hour: "8",
  prediction_window_hours: "11",
  min_sats: "1000",
  max_sats: "10000",
  weekly_vote_day: "6",
  weekly_vote_hour: "20",
  trading_enabled: "false",
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const FIELD_TOOLTIPS: Record<string, string> = {
  prediction_open_hour: "Scheduler-local hour (0–23) when the daily prediction window opens.",
  prediction_target_hour: "Scheduler-local hour at which the BTC trade is settled and the day range is evaluated.",
  prediction_window_hours: "How many hours the prediction window stays open before Cassandrina closes submissions.",
  min_sats: "Minimum satoshi amount required for a valid prediction. Below this, predictions are rejected.",
  max_sats: "Maximum satoshi amount allowed per prediction. Also used as the denominator for congruency scoring.",
  weekly_vote_day: "Day of the week when the weekly vote is triggered (e.g., for reinvestment decisions).",
  weekly_vote_hour: "UTC hour on the vote day when the weekly vote message is sent to the group.",
  trading_enabled: "When enabled, the bot executes real Binance trades. When disabled, the scheduler still runs, but executions stay in dry-run mode.",
};

function formatHeartbeat(heartbeatAt: string | null): string {
  if (!heartbeatAt) {
    return "No heartbeat yet";
  }

  const date = new Date(heartbeatAt);
  if (Number.isNaN(date.getTime())) {
    return "Heartbeat unavailable";
  }

  return date.toLocaleString();
}

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
        <label htmlFor={name} className="text-sm font-medium text-white">
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

function ConfigSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
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
      const res = await fetch(withBasePath("/api/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Configuration saved!" });
        const updated = await fetch(withBasePath("/api/config")).then((r) => r.json());
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {message && (
        <Badge
          variant={message.type === "success" ? "success" : "destructive"}
          className="w-full justify-center py-2 text-sm"
        >
          {message.text}
        </Badge>
      )}

      <ConfigSection title="Prediction Timing" icon={Clock}>
        <div className="grid md:grid-cols-2 gap-4">
          <TooltipField
            label="Open Hour"
            name="prediction_open_hour"
            tooltip={FIELD_TOOLTIPS.prediction_open_hour}
            currentValue={`${current.prediction_open_hour}:00 local`}
          >
            <Input
              id="prediction_open_hour"
              type="number"
              name="prediction_open_hour"
              min={0}
              max={23}
              defaultValue={current.prediction_open_hour}
              key={`open_hour_${current.prediction_open_hour}`}
              className="bg-secondary border-white/10"
            />
          </TooltipField>

          <TooltipField
            label="Target Hour"
            name="prediction_target_hour"
            tooltip={FIELD_TOOLTIPS.prediction_target_hour}
            currentValue={`${current.prediction_target_hour}:00 local`}
          >
            <Input
              id="prediction_target_hour"
              type="number"
              name="prediction_target_hour"
              min={0}
              max={23}
              defaultValue={current.prediction_target_hour}
              key={`target_hour_${current.prediction_target_hour}`}
              className="bg-secondary border-white/10"
            />
          </TooltipField>
        </div>

        <TooltipField
          label="Window Duration (hours)"
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
            className="bg-secondary border-white/10"
          />
        </TooltipField>
      </ConfigSection>

      <ConfigSection title="Sats Limits" icon={Coins}>
        <div className="grid md:grid-cols-2 gap-4">
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
              className="bg-secondary border-white/10"
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
              className="bg-secondary border-white/10"
            />
          </TooltipField>
        </div>
      </ConfigSection>

      <ConfigSection title="Weekly Vote" icon={Calendar}>
        <div className="grid md:grid-cols-2 gap-4">
          <TooltipField
            label="Vote Day"
            name="weekly_vote_day"
            tooltip={FIELD_TOOLTIPS.weekly_vote_day}
            currentValue={DAY_NAMES[parseInt(current.weekly_vote_day)]}
          >
            <Select
              id="weekly_vote_day"
              name="weekly_vote_day"
              defaultValue={current.weekly_vote_day}
              key={`vote_day_${current.weekly_vote_day}`}
              className="bg-secondary border-white/10"
            >
              {DAY_NAMES.map((day, i) => (
                <option key={i} value={i}>
                  {day}
                </option>
              ))}
            </Select>
          </TooltipField>

          <TooltipField
            label="Vote Hour"
            name="weekly_vote_hour"
            tooltip={FIELD_TOOLTIPS.weekly_vote_hour}
            currentValue={`${current.weekly_vote_hour}:00 local`}
          >
            <Input
              id="weekly_vote_hour"
              type="number"
              name="weekly_vote_hour"
              min={0}
              max={23}
              defaultValue={current.weekly_vote_hour}
              key={`vote_hour_${current.weekly_vote_hour}`}
              className="bg-secondary border-white/10"
            />
          </TooltipField>
        </div>
      </ConfigSection>

      <ConfigSection title="Bot Triggers" icon={Zap}>
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
            className="bg-secondary border-white/10"
          >
            <option value="true">Yes — execute trades</option>
            <option value="false">No — dry run only</option>
          </Select>
        </TooltipField>
      </ConfigSection>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={saving} className="bg-primary text-black hover:bg-primary/90 font-semibold">
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
        <Button type="button" variant="outline" onClick={handleReset} className="border-white/10 hover:bg-secondary">
          Reset to Defaults
        </Button>
      </div>
    </form>
  );
}

export default function ConfigPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [botStatus, setBotStatus] = useState<BotControlStatus | null>(null);
  const [botAction, setBotAction] = useState<"restart" | "pause" | "stop" | null>(null);
  const [botMessage, setBotMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      if (sessionStorage.getItem("cassandrina_admin") === "1") {
        const [configOk, statusOk] = await Promise.all([loadConfig(), loadBotStatus()]);
        setUnlocked(configOk && statusOk);
      }
    };
    checkAdmin();
  }, []);

  useEffect(() => {
    if (!unlocked) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadBotStatus();
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [unlocked]);

  const loadConfig = async () => {
    const res = await fetch(withBasePath("/api/config"));
    if (res.status === 401) {
      sessionStorage.removeItem("cassandrina_admin");
      setUnlocked(false);
      setConfig(null);
      return false;
    }
    const cfg = await res.json();
    setConfig(cfg);
    return true;
  };

  const loadBotStatus = async () => {
    const res = await fetch(withBasePath("/api/admin/bot"));
    if (res.status === 401) {
      sessionStorage.removeItem("cassandrina_admin");
      setUnlocked(false);
      setConfig(null);
      setBotStatus(null);
      return false;
    }
    const status = await res.json();
    setBotStatus(status);
    return true;
  };

  const handleBotAction = async (action: "restart" | "pause" | "stop") => {
    setBotAction(action);
    setBotMessage(null);

    try {
      const res = await fetch(withBasePath("/api/admin/bot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const error = await res.json();
        setBotMessage({
          type: "error",
          text: JSON.stringify(error.details ?? error.error),
        });
        return;
      }

      const payload = await res.json();
      setBotStatus(payload.status);
      setBotMessage({
        type: "success",
        text:
          action === "restart"
            ? "Restart requested. If the bot was paused or stopped, this starts it again."
            : action === "pause"
            ? "Pause requested. The scheduler will stop opening and settling rounds until restarted."
            : "Stop requested. The bot will remain stopped until you restart it.",
      });
    } finally {
      setBotAction(null);
    }
  };

  const handleUnlock = async () => {
    sessionStorage.setItem("cassandrina_admin", "1");
    const [configOk, statusOk] = await Promise.all([loadConfig(), loadBotStatus()]);
    setUnlocked(configOk && statusOk);
  };

  if (!unlocked) {
    return <PinGate onUnlock={handleUnlock} />;
  }

  if (!config) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-muted-foreground">Bot configuration</p>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            Bot Lifecycle
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <BotLifecycleBadge state={botStatus?.actualState ?? "offline"} />
              <p className="text-xs text-muted-foreground">
                Last heartbeat: {formatHeartbeat(botStatus?.heartbeatAt ?? null)}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              Trading mode: {config.trading_enabled === "true" ? "Live Trading" : "Dry Run"}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Lifecycle controls manage whether the scheduler is running. Trading mode below only decides whether a running bot sends real Binance orders or stays in dry-run mode.
          </p>

          {botMessage && (
            <Badge
              variant={botMessage.type === "success" ? "success" : "destructive"}
              className="w-full justify-center py-2 text-sm"
            >
              {botMessage.text}
            </Badge>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => handleBotAction("restart")}
              disabled={botAction !== null}
              className="bg-primary text-black hover:bg-primary/90"
            >
              <RotateCcw className="h-4 w-4" />
              Restart
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleBotAction("pause")}
              disabled={botAction !== null || botStatus?.actualState === "paused"}
              className="border-white/10 hover:bg-secondary"
            >
              <PauseCircle className="h-4 w-4" />
              Pause
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => handleBotAction("stop")}
              disabled={botAction !== null || botStatus?.actualState === "stopped"}
            >
              <Power className="h-4 w-4" />
              Stop
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfigForm config={config} onSaved={setConfig} />
    </div>
  );
}
