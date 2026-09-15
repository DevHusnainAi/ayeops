"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FileAudio, FileClock, History as HistoryIcon } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { apiOrigin, fetchIncidents, type IncidentEntry } from "@/lib/api";
import { BTN_QUIET } from "../components";

const ACTION: Record<string, string> = { rollback: "Roll back", restart: "Restart", scale_up: "Scale up" };

function fmtDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function Row({ entry }: { entry: IncidentEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl bg-panel/70 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.05]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 text-left"
      >
        <span className="font-mono text-[13px] font-semibold text-ink">{entry.service}</span>
        <span className="text-[13px] text-muted">{ACTION[entry.action] ?? entry.action}</span>
        <span className="font-mono text-[12px] text-muted-2">{fmtDate(entry.resolved_at)}</span>
        <span className="rounded-full bg-healthy/10 px-2.5 py-1 font-mono text-[11px] text-healthy">
          recovered in {entry.mttr_s}s
        </span>
        <span className="ml-auto text-muted-2">{open ? <ChevronUp aria-hidden size={16} /> : <ChevronDown aria-hidden size={16} />}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-4">
          <p className="text-[13px] text-muted">
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-2 uppercase">Root cause</span>
            <br />
            {entry.root_cause}
          </p>
          {(entry.recording || entry.timeline) && (
            <div className="mt-3 flex flex-wrap gap-3">
              {entry.recording && (
                <a href={`${apiOrigin()}${entry.recording}`} className="flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
                  <FileAudio aria-hidden size={13} /> Recording
                </a>
              )}
              {entry.timeline && (
                <a href={`${apiOrigin()}${entry.timeline}`} className="flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
                  <FileClock aria-hidden size={13} /> Turn timeline
                </a>
              )}
            </div>
          )}
          {entry.postmortem && (
            <pre className="mt-4 overflow-x-auto rounded-lg bg-board px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink/80">
              {entry.postmortem}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export default function HistoryPage() {
  const [state, setState] = useState<{ loading: boolean; error?: string; incidents: IncidentEntry[] }>({
    loading: true, incidents: [],
  });

  useEffect(() => {
    fetchIncidents()
      .then((incidents) => setState({ loading: false, incidents }))
      .catch((e) => setState({ loading: false, error: String(e), incidents: [] }));
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-8 lg:px-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[15px] font-semibold tracking-[0.02em] uppercase">
            {BRAND}<span className="text-accent">.</span>
          </span>
          <span aria-hidden className="h-5 w-px bg-line" />
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <HistoryIcon aria-hidden size={14} /> Incident history
          </span>
        </div>
        <a href="/" className={BTN_QUIET}>
          Back to dashboard
        </a>
      </header>

      <div className="mt-8">
        {state.loading && <p className="text-[14px] text-muted">Loading…</p>}
        {state.error && (
          <p className="rounded-lg border border-down/40 bg-down/10 px-4 py-3 text-[13.5px] text-down">
            Couldn&rsquo;t reach the relay: {state.error}
          </p>
        )}
        {!state.loading && !state.error && !state.incidents.length && (
          <div className="grid min-h-40 place-content-center text-center">
            <p className="text-[14px] text-muted">No incidents yet.</p>
            <p className="mt-1 text-[13px] text-muted-2">Every resolved incident, on any service, shows up here.</p>
          </div>
        )}
        <ul className="space-y-3">
          {state.incidents.map((entry) => (
            <Row key={`${entry.session_id}-${entry.resolved_at}`} entry={entry} />
          ))}
        </ul>
      </div>
    </main>
  );
}
