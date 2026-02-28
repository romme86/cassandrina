"use client";

import { useState, useEffect } from "react";

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

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function ConfigPage() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      if (key === "trading_enabled") {
        payload[key] = value === "true";
      } else if (["prediction_target_hour", "prediction_open_hour", "prediction_window_hours",
                   "min_sats", "max_sats", "weekly_vote_day", "weekly_vote_hour"].includes(key)) {
        payload[key] = parseInt(value as string, 10);
      }
    }

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Configuration saved!" });
        const updated = await fetch("/api/config").then((r) => r.json());
        setConfig(updated);
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: JSON.stringify(err.details ?? err.error) });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <div className="text-gray-400">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-orange-400">Bot Configuration</h1>

      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-900 text-green-200"
              : "bg-red-900 text-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-5">
        <Field label="Prediction Open Hour (UTC)" name="prediction_open_hour" type="number" min={0} max={23} defaultValue={config.prediction_open_hour} />
        <Field label="Target Hour (UTC)" name="prediction_target_hour" type="number" min={0} max={23} defaultValue={config.prediction_target_hour} />
        <Field label="Prediction Window (hours)" name="prediction_window_hours" type="number" min={1} max={12} defaultValue={config.prediction_window_hours} />
        <Field label="Min Sats" name="min_sats" type="number" min={1} defaultValue={config.min_sats} />
        <Field label="Max Sats" name="max_sats" type="number" min={1} defaultValue={config.max_sats} />

        <div>
          <label className="block text-sm text-gray-400 mb-1">Weekly Vote Day</label>
          <select
            name="weekly_vote_day"
            defaultValue={config.weekly_vote_day}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
          >
            {DAY_NAMES.map((day, i) => (
              <option key={i} value={i}>{day}</option>
            ))}
          </select>
        </div>

        <Field label="Weekly Vote Hour (UTC)" name="weekly_vote_hour" type="number" min={0} max={23} defaultValue={config.weekly_vote_hour} />

        <div>
          <label className="block text-sm text-gray-400 mb-1">Trading Enabled</label>
          <select
            name="trading_enabled"
            defaultValue={config.trading_enabled}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
          >
            <option value="true">Yes — execute trades</option>
            <option value="false">No — dry run only</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label, name, type, min, max, defaultValue,
}: {
  label: string;
  name: string;
  type: string;
  min?: number;
  max?: number;
  defaultValue: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        min={min}
        max={max}
        defaultValue={defaultValue}
        className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full font-mono"
      />
    </div>
  );
}
