"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

type Analytics = {
  incidents: number;
  mttr_avg: number;
  mttr_trend: { mttr: number; at: number; service: string }[];
  by_service: Record<string, { count: number; total_mttr: number; avg_mttr: number }>;
  by_action: Record<string, number>;
  ratings: { up: number; down: number };
};

const BAR_COLORS: Record<string, string> = {
  rollback: "bg-down",
  restart: "bg-degraded",
  scale_up: "bg-healthy",
};

function BarChart({ data, max }: { data: { label: string; value: number; color?: string }[]; max: number }) {
  if (!data.length) return <p className="text-[13px] text-muted">No data yet.</p>;
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-[12px] text-muted">{d.label}</span>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-board">
            <div
              className={`absolute inset-y-0 left-0 ${d.color ?? "bg-accent"} rounded transition-all duration-500`}
              style={{ width: `${max ? (d.value / max) * 100 : 0}%` }}
            />
            <span className="relative z-10 flex h-full items-center px-2 font-mono text-[11px] text-ink">
              {d.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MttrSparkline({ trend }: { trend: Analytics["mttr_trend"] }) {
  if (!trend.length) return <p className="text-[13px] text-muted">No data yet.</p>;
  const max = Math.max(...trend.map((t) => t.mttr), 1);
  const h = 60;
  const w = 300;
  const points = trend.map((t, i) => {
    const x = (i / Math.max(trend.length - 1, 1)) * w;
    const y = h - (t.mttr / max) * (h - 8);
    return `${x},${y}`;
  });
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-sm" preserveAspectRatio="none">
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {trend.map((t, i) => {
          const x = (i / Math.max(trend.length - 1, 1)) * w;
          const y = h - (t.mttr / max) * (h - 8);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="3"
              fill="var(--color-accent)"
              className="opacity-60"
            >
              <title>{t.service}: {t.mttr}s</title>
            </circle>
          );
        })}
      </svg>
      <p className="mt-1 text-[11px] text-muted-2">
        MTTR trend (last {trend.length} incidents) — avg {Math.round(trend.reduce((a, t) => a + t.mttr, 0) / trend.length)}s
      </p>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className="text-[10.5px] tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-[22px] font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-2">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const svcMax = data ? Math.max(...Object.values(data.by_service).map((v) => v.count), 1) : 1;
  const actMax = data ? Math.max(...Object.values(data.by_action), 1) : 1;
  const ratingTotal = data ? data.ratings.up + data.ratings.down : 0;

  return (
    <main className="flex min-h-dvh flex-col bg-base">
      <header className="flex items-center justify-between border-b border-line bg-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[14px] font-semibold tracking-tight text-ink hover:text-accent transition">
            {BRAND}
          </Link>
          <span className="text-muted-2">·</span>
          <span className="text-[13px] text-muted">Analytics</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/history" className="rounded border border-line px-3 py-1.5 text-[12px] text-muted hover:text-ink transition">
            History
          </Link>
          <Link href="/" className="rounded border border-line px-3 py-1.5 text-[12px] text-muted hover:text-ink transition">
            Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {loading && <p className="text-[13px] text-muted">Loading analytics…</p>}
        {error && <p className="text-[13px] text-down">{error}</p>}
        {data && (
          <div className="space-y-8">
            {/* stat cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total incidents" value={data.incidents} />
              <StatCard label="Avg MTTR" value={`${data.mttr_avg}s`} />
              <StatCard
                label="Operator rating"
                value={ratingTotal > 0 ? `${Math.round((data.ratings.up / ratingTotal) * 100)}%` : "—"}
                sub={ratingTotal > 0 ? `${data.ratings.up} up · ${data.ratings.down} down` : "No ratings yet"}
              />
              <StatCard
                label="Fix rate"
                value={data.by_action.rollback ? `${data.by_action.rollback} rollbacks` : "—"}
                sub={data.by_action.restart ? `${data.by_action.restart} restarts` : undefined}
              />
            </div>

            {/* MTTR trend */}
            <div className="rounded-lg border border-line bg-panel p-5">
              <h2 className="text-[13px] font-semibold text-muted">MTTR Trend</h2>
              <div className="mt-4">
                <MttrSparkline trend={data.mttr_trend} />
              </div>
            </div>

            {/* by service */}
            <div className="rounded-lg border border-line bg-panel p-5">
              <h2 className="text-[13px] font-semibold text-muted">Incidents by Service</h2>
              <div className="mt-4">
                <BarChart
                  data={Object.entries(data.by_service).map(([svc, v]) => ({
                    label: svc,
                    value: v.count,
                    color: "bg-accent",
                  }))}
                  max={svcMax}
                />
              </div>
            </div>

            {/* by action */}
            <div className="rounded-lg border border-line bg-panel p-5">
              <h2 className="text-[13px] font-semibold text-muted">Fixes by Action</h2>
              <div className="mt-4">
                <BarChart
                  data={Object.entries(data.by_action).map(([act, count]) => ({
                    label: act.replace(/_/g, " "),
                    value: count,
                    color: BAR_COLORS[act] ?? "bg-muted",
                  }))}
                  max={actMax}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
