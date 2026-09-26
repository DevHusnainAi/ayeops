"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, FileText, Mic, Table2 } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { parsePostmortem, eventTone, eventLabel, type PmParsed } from "@/lib/pm";

type IncidentEntry = {
  service: string;
  action: string;
  root_cause: string;
  mttr_s: number | null;
  resolved_at: string | null;
  session_id: string | null;
  postmortem: string | null;
  recording: string | null;
  timeline: string | null;
};

type Tab = "overview" | "postmortem" | "recovery" | "timeline";

const fmtShort = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  const now = Date.now();
  const diff = Math.round((now - d.getTime()) / 60000);
  const ts = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return diff < 60 ? `${ts} (${diff}m ago)` : ts;
};
const pct = (v: string) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? v : `${n}%`;
};
const badgeClass = (a: string) =>
  a === "rollback" ? "bg-down/15 text-down" : a === "fix_forward" ? "bg-healthy/15 text-healthy" : "bg-muted/10 text-muted";
const dotClass = (t: string) =>
  t === "down" ? "bg-down" : t === "healthy" ? "bg-healthy" : t === "accent" ? "bg-accent" : t === "degraded" ? "bg-degraded" : "bg-muted-2";
const tabClass = (active: boolean) =>
  `px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
    active ? "bg-accent/15 text-accent" : "text-muted hover:text-ink hover:bg-board"
  }`;

/* ── skeleton ── */
function SidebarSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line/50 px-4 py-3">
          <span className="size-2 shrink-0 rounded-full bg-muted/20 animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-24 rounded bg-muted/15 animate-pulse" />
            <div className="h-3 w-40 rounded bg-muted/10 animate-pulse" />
          </div>
          <div className="h-4 w-8 rounded bg-muted/15 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <span className="size-2.5 rounded-full bg-muted/20" />
        <span className="h-4 w-28 rounded bg-muted/15" />
        <span className="h-5 w-16 rounded bg-muted/15" />
        <span className="h-3 w-32 rounded bg-muted/10 ml-auto" />
        <span className="h-5 w-10 rounded bg-muted/15" />
      </div>
      <div className="h-3 w-64 rounded bg-muted/10" />
      <div className="rounded bg-board p-4 space-y-2">
        <span className="h-3 w-20 rounded bg-muted/15 block" />
        <span className="h-3.5 w-full rounded bg-muted/10 block" />
      </div>
      <div className="flex gap-3">
        <span className="h-8 w-28 rounded bg-muted/15" />
        <span className="h-8 w-32 rounded bg-muted/15" />
      </div>
      <div className="rounded border border-line bg-panel p-4 space-y-3">
        <span className="h-3 w-24 rounded bg-muted/15 block" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-3.5 w-full rounded bg-muted/10" style={{ width: `${85 - i * 10}%` }} />
        ))}
      </div>
      <div className="rounded bg-board p-4 space-y-2">
        <span className="h-3 w-20 rounded bg-muted/15 block" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <span className="h-3 w-16 rounded bg-muted/10" />
            <span className="h-3 w-32 rounded bg-muted/10" />
            <span className="h-3 flex-1 rounded bg-muted/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── postmortem report (old style) ── */
function PmReport({ pm }: { pm: PmParsed }) {
  return (
    <div className="rounded bg-board p-4 text-[13px] text-ink leading-relaxed">
      {pm.sessionId && (
        <p className="font-mono text-[13px] text-ink">
          Incident report <span className="text-muted-2">{pm.sessionId}</span>
        </p>
      )}
      {pm.stats && (
        <p className="mt-2">
          <span className="text-muted">Detected</span>{" "}
          <span className="font-mono text-ink">{pm.stats.detected}</span>
          <span className="text-muted">, recovered</span>{" "}
          <span className="font-mono text-ink">{pm.stats.recovered}</span>
          <span className="text-muted">, time to recover</span>{" "}
          <span className="font-mono text-ink">{pm.stats.mttr}s</span>
        </p>
      )}
      {pm.changes.map((c, i) => (
        <p key={i} className="mt-1">
          <span className="text-muted">Voice-authorized change:</span>{" "}
          <span className="text-ink">
            {c.action} {c.service} ({c.change})
          </span>
          <span className="text-muted">
            , authorized by the operator reading code
          </span>{" "}
          <span className="font-mono text-accent">&ldquo;{c.heard}&rdquo;</span>
        </p>
      ))}
      {pm.evidence && <p className="mt-1 text-muted">{pm.evidence}</p>}
    </div>
  );
}

/* ── recovery table ── */
function RecoveryTable({ rows }: { rows: PmParsed["recovery"] }) {
  if (rows.length === 0)
    return <p className="text-[13px] text-muted">No recovery data available.</p>;
  return (
    <div className="overflow-x-auto rounded bg-board p-4">
      <table className="w-full text-left text-[12.5px] font-mono">
        <thead>
          <tr className="text-[11px] text-muted uppercase tracking-wide border-b border-line">
            <th className="pb-2 pr-4">Service</th>
            <th className="pb-2 pr-4">Error rate</th>
            <th className="pb-2">p99</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/40">
              <td className="py-2 pr-4 text-ink">{r.service}</td>
              <td className="py-2 pr-4">
                <span className="text-down">{pct(r.errBefore)}</span>
                <span className="mx-1 text-muted-2">→</span>
                <span className="text-healthy">{pct(r.errAfter)}</span>
              </td>
              <td className="py-2">
                <span className="text-degraded">{r.p99Before}</span>
                <span className="mx-1 text-muted-2">→</span>
                <span className="text-healthy">{r.p99After}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── timeline stream (vertical) ── */
function TimelineStream({ rows }: { rows: PmParsed["timeline"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="relative space-y-0">
      {rows.map((r, i) => {
        const tone = eventTone(r.event);
        return (
          <div key={i} className="relative flex items-start gap-3 py-2.5">
            {i < rows.length - 1 && (
              <span className="absolute left-[4px] top-[14px] h-[calc(100%-14px)] w-px bg-line" aria-hidden />
            )}
            <span className={`relative z-10 mt-[3px] size-[9px] shrink-0 rounded-full ${dotClass(tone)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink">
                  {eventLabel(r.event)}
                </span>
                <span className="font-mono text-[11px] text-muted-2">{r.time}</span>
              </div>
              {r.detail && (
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{r.detail}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── sidebar item ── */
function SidebarItem({
  entry,
  active,
  onClick,
}: {
  entry: IncidentEntry;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-line/50 px-4 py-3 text-left transition-colors ${
        active
          ? "bg-accent/12 border-l-2 border-l-accent"
          : "hover:bg-board border-l-2 border-l-transparent"
      }`}
    >
      <span
        className={`mt-0.5 size-2 shrink-0 rounded-full ${
          entry.mttr_s !== null ? "bg-healthy" : "bg-muted-2"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {entry.service}
          </span>
          <span
            className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badgeClass(
              entry.action
            )}`}
          >
            {entry.action.replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-muted">
          {entry.root_cause}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {entry.mttr_s !== null && (
          <span className="inline-block rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
            {entry.mttr_s}s
          </span>
        )}
        <p className="mt-0.5 text-[10.5px] text-muted-2">
          {fmtShort(entry.resolved_at)}
        </p>
      </div>
    </button>
  );
}

/* ── detail panel with tabs ── */
function DetailPanel({ entry }: { entry: IncidentEntry }) {
  const [tab, setTab] = useState<Tab>("overview");
  const pm = entry.postmortem ? parsePostmortem(entry.postmortem) : null;
  const tabs: Tab[] = ["overview", "postmortem", "recovery", "timeline"];

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-center gap-3">
        <span className="size-2.5 shrink-0 rounded-full bg-healthy" />
        <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{entry.service}</span>
        <span
          className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${badgeClass(
            entry.action
          )}`}
        >
          {entry.action.replace("_", " ")}
        </span>
        {entry.mttr_s !== null && (
          <span className="ml-auto inline-block rounded bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent">
            {entry.mttr_s}s
          </span>
        )}
      </div>

      {/* resolved + session */}
      <div className="text-[12.5px] text-muted">
        Resolved{" "}
        <span className="font-medium text-ink">{fmtShort(entry.resolved_at)}</span>
        {entry.session_id && (
          <span className="ml-3">
            Session{" "}
            <span className="font-mono text-muted-2">
              {entry.session_id.slice(0, 20)}…
            </span>
          </span>
        )}
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-board p-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tabClass(tab === t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* tab content */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* root cause */}
          <div className="rounded bg-board p-4">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Root cause
            </h3>
            <p className="mt-1 text-[13px] text-ink">{entry.root_cause}</p>
          </div>

          {/* recording + timeline links */}
          <div className="flex items-center gap-3">
            {entry.recording && (
              <a
                href={entry.recording}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded bg-board px-3 py-1.5 text-[12px] text-muted-2 hover:text-ink transition"
              >
                <Mic aria-hidden size={12} /> Recording
              </a>
            )}
            {entry.timeline && (
              <a
                href={entry.timeline}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded bg-board px-3 py-1.5 text-[12px] text-muted-2 hover:text-ink transition"
              >
                <Table2 aria-hidden size={12} /> Turn timeline
              </a>
            )}
          </div>

          {/* quick recovery summary */}
          {pm && pm.recovery.length > 0 && (
            <div className="rounded bg-board p-4">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                Recovery summary
              </h3>
              <div className="mt-2 flex flex-wrap gap-3">
                {pm.recovery.map((r, i) => (
                  <div key={i} className="rounded bg-panel px-3 py-2">
                    <span className="text-[11px] text-muted">{r.service}</span>
                    <div className="mt-0.5 font-mono text-[12px]">
                      <span className="text-down">{pct(r.errBefore)}</span>
                      <span className="mx-1 text-muted-2">→</span>
                      <span className="text-healthy">{pct(r.errAfter)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* quick timeline preview */}
          {pm && pm.timeline.length > 0 && (
            <div className="rounded bg-board p-4">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                Incident flow
              </h3>
              <div className="mt-2">
                <TimelineStream rows={pm.timeline.slice(0, 6)} />
                {pm.timeline.length > 6 && (
                  <button
                    onClick={() => setTab("timeline")}
                    className="mt-2 text-[12px] text-accent hover:underline"
                  >
                    View all {pm.timeline.length} events →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "postmortem" && pm && (
        <div className="rounded border border-line bg-panel p-5">
          <div className="pm-report text-[13px] text-ink leading-relaxed
            [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-ink [&_h1]:mb-3
            [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-muted [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:mt-5 [&_h2]:mb-2
            [&_p]:mb-2
            [&_strong]:text-ink
            [&_code]:font-mono [&_code]:text-[12px] [&_code]:bg-board [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-accent
            [&_table]:w-full [&_table]:text-left [&_table]:text-[12.5px] [&_table]:font-mono [&_table]:mt-2
            [&_thead]:border-b [&_thead]:border-line/40
            [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-[11px] [&_th]:text-muted [&_th]:uppercase [&_th]:tracking-wide [&_th]:font-medium
            [&_tbody]:border-t [&_tbody]:border-line/40
            [&_td]:py-2 [&_td]:pr-4
            [&_li]:mb-1
            [&_a]:text-accent [&_a]:hover:underline"
          >
            <Markdown remarkPlugins={[remarkGfm]}>{entry.postmortem ?? ""}</Markdown>
          </div>
        </div>
      )}
      {tab === "postmortem" && !entry.postmortem && (
        <p className="text-[13px] text-muted">No postmortem available.</p>
      )}

      {tab === "recovery" && <RecoveryTable rows={pm?.recovery ?? []} />}

      {tab === "timeline" && (
        pm && pm.timeline.length > 0 ? (
          <div className="rounded border border-line bg-panel p-4">
            <TimelineStream rows={pm.timeline} />
          </div>
        ) : (
          <p className="text-[13px] text-muted">No timeline data available.</p>
        )
      )}
    </div>
  );
}

/* ── page ── */
export default function HistoryPage() {
  const [entries, setEntries] = useState<IncidentEntry[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Below lg, the list and detail panes never fit side by side -- show one at a time, like a mobile mail app.
  // Irrelevant at lg+, where both panes are always visible regardless of this.
  const [mobileShowList, setMobileShowList] = useState(true);

  useEffect(() => {
    fetch("/api/incidents")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data: IncidentEntry[]) => {
        setEntries(data);
        if (data.length > 0) setSelected(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const active = selected >= 0 ? entries[selected] ?? null : null;

  return (
    <main className="flex h-dvh flex-col bg-base">
      {/* top bar */}
      <header className="page-x flex items-center justify-between border-b border-line bg-panel py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-[14px] font-semibold tracking-tight text-ink hover:text-accent transition"
          >
            {BRAND}
          </Link>
          <span className="text-muted-2">·</span>
          <span className="text-[13px] text-muted">Incident history</span>
          {!loading && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted/15 text-[11px] font-medium text-muted-2">
              {entries.length}
            </span>
          )}
        </div>
        <Link
          href="/"
          className="rounded border border-line px-3 py-1.5 text-[12px] text-muted hover:text-ink transition"
        >
          Back to dashboard
        </Link>
      </header>

      {/* split layout */}
      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside
          className={`w-full shrink-0 flex-col overflow-y-auto border-r border-line bg-panel lg:flex lg:w-72 ${
            mobileShowList ? "flex" : "hidden"
          }`}
        >
          {loading && <SidebarSkeleton />}
          {error && <p className="px-4 py-6 text-[13px] text-down">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <div className="px-4 py-12 text-center">
              <FileText aria-hidden size={20} className="mx-auto text-muted-2" />
              <p className="mt-2 text-[13px] text-muted">
                No incidents yet. Run a session first.
              </p>
            </div>
          )}
          {!loading &&
            entries.map((e, i) => (
              <SidebarItem
                key={i}
                entry={e}
                active={i === selected}
                onClick={() => {
                  setSelected(i);
                  setMobileShowList(false);
                }}
              />
            ))}
        </aside>

        {/* detail */}
        <div className={`flex-1 overflow-y-auto lg:block ${mobileShowList ? "hidden" : "block"}`}>
          <div className="mx-auto max-w-3xl px-4 py-8 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileShowList(true)}
              className="mb-4 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink transition lg:hidden"
            >
              <ArrowLeft aria-hidden size={12} /> All incidents
            </button>
            {loading && <DetailSkeleton />}
            {!loading && active && <DetailPanel entry={active} />}
            {!loading && !active && !error && entries.length > 0 && (
              <p className="text-[13px] text-muted">Select an incident from the sidebar.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
