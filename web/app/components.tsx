"use client";

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  Boxes,
  EyeOff,
  Activity, AlertTriangle, BarChart3, Bot, Bug, CheckCircle2, ChevronDown, ChevronUp, Clock3, FileText, Globe, History, Lock, Mic,
  MicOff, Radio, RefreshCw, Rocket, Server, ScrollText, ShieldCheck, SlidersHorizontal, Unplug, Wifi, WifiOff, X, XCircle,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { FAULTS, type Fault } from "@/lib/relay";
import type {
  AgentRequest, ApiEvent, FeedItem, Gate, LinkState, LogLine, ModelContext, Phase, Precedent, RecoveryDelta,
  RelayState, Service, Status,
} from "@/lib/relay";

export const BTN =
  "rounded-md bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-[color-mix(in_oklab,var(--color-accent)_88%,white)] disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-transparent disabled:text-muted-2 disabled:hover:bg-transparent";
export const BTN_QUIET =
  "rounded-md border border-line px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-muted-2 disabled:hover:border-line disabled:hover:bg-transparent";

// ITIC 2024: downtime costs over $300,000 an hour for more than 90% of mid-size and large enterprises.
const COST_PER_MIN = 5000;
const COST_SOURCE = "ITIC 2024";

const STATUS: Record<Status, { label: string; dot: string; text: string; bg: string }> = {
  healthy: { label: "Healthy", dot: "bg-healthy", text: "text-healthy", bg: "bg-healthy/10" },
  degraded: { label: "Degraded", dot: "bg-degraded", text: "text-degraded", bg: "bg-degraded/10" },
  down: { label: "Down", dot: "bg-down", text: "text-down", bg: "bg-down/10" },
  remediating: { label: "Remediating", dot: "bg-remediating", text: "text-remediating", bg: "bg-remediating/10" },
};
const ACTION: Record<string, string> = { rollback: "Roll back", restart: "Restart", scale_up: "Scale up" };
const PHASE_LABEL: Record<Phase, string> = {
  starting: "Starting", monitoring: "Monitoring", triage: "Triage", mitigation: "Mitigation", resolved: "Resolved",
};

// F9: confidence badge color thresholds
function confidenceColor(score: number): string {
  if (score >= 0.85) return "text-healthy";
  if (score >= 0.6) return "text-degraded";
  return "text-down";
}
function confidenceLabel(score: number): string {
  if (score >= 0.85) return "High";
  if (score >= 0.6) return "Medium";
  return "Low";
}

const pct = (x?: number) => (x === undefined ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
const clock = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
const hms = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

export function useNow(every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

// A stable incident identifier, derived from detection time -- there's no incident database behind this, one
// incident runs at a time, so the id only needs to be honest about that, not globally unique.
function incidentId(incidentAt?: number) {
  if (!incidentAt) return null;
  const d = new Date(incidentAt);
  return `INC-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

export function StatusPill({ tone, label }: { tone: Status | "info"; label: string }) {
  const st = tone === "info" ? { dot: "bg-accent", text: "text-accent", bg: "bg-accent/10" } : STATUS[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide ${st.bg} ${st.text}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${st.dot}`} />
      {label}
    </span>
  );
}

// No border, no icon-plus-caps-label header -- that pairing is the observability-widget signature (Grafana,
// Datadog). Separation comes from a barely-there ring and a soft shadow for depth instead.
export function Panel({
  title, aside, accent = false, className = "", children,
}: { title: string; aside?: ReactNode; accent?: boolean; className?: string; children: ReactNode }) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg bg-panel/70 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.7)] ring-1 ${
        accent ? "ring-accent/25" : "ring-white/[0.05]"
      } ${className}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-muted">{title}</h2>
        {aside}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

const LINK_TEXT: Record<LinkState, string> = {
  idle: "Offline", connecting: "Connecting", connected: "Voice link live", reconnecting: "Reconnecting",
  resumed: "Voice link live", recovered: "Voice link live", closed: "Disconnected",
};

function LinkPill({ link, mic }: { link: LinkState; mic: RelayState["mic"] }) {
  const live = link === "connected" || link === "resumed" || link === "recovered";
  const Icon = live || link === "reconnecting" ? Wifi : WifiOff;
  return (
    <span className="flex items-center gap-3 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden size={13} className={live ? "text-healthy" : link === "reconnecting" ? "text-degraded" : "text-muted-2"} />
        {LINK_TEXT[link]}
      </span>
      {mic === "blocked" && (
        <span className="flex items-center gap-1 rounded-full bg-degraded/10 px-2 py-0.5 text-degraded">
          <MicOff aria-hidden size={11} /> Mic blocked
        </span>
      )}
      {mic === "off" && (
        <span className="flex items-center gap-1 rounded-full bg-panel-2 px-2 py-0.5 text-muted">
          <MicOff aria-hidden size={11} /> Watch only
        </span>
      )}
      {mic === "on" && (
        <span className="flex items-center gap-1 rounded-full bg-healthy/10 px-2 py-0.5 text-healthy">
          <Mic aria-hidden size={11} /> Mic live
        </span>
      )}
    </span>
  );
}

// F9: confidence badge — shows readback confidence during authorization.
export function ConfidenceBadge({ score }: { score: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${confidenceColor(score)}`}>
      <span aria-hidden className="size-1 rounded-full bg-current" />
      {confidenceLabel(score)} confidence · {(score * 100).toFixed(0)}%
    </span>
  );
}

// The persistent shell header: wordmark, link status, and the two things that open on top of everything else
// (the report, once one exists, and the demo/testing controls) -- neither hides state, they float above it.
export function AppHeader({
  s, onOpenReport, onToggleTools, toolsOpen,
}: { s: RelayState; onOpenReport?: () => void; onToggleTools: () => void; toolsOpen: boolean }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-board/80 px-5 py-3 backdrop-blur">
      <span className="font-mono text-[15px] font-semibold tracking-[0.02em] uppercase">
        {BRAND}<span className="text-accent">.</span>
      </span>
      {/* Constant, not just shown during a pending gate -- the trust claim should be visible whether or not
          anything is currently awaiting authorization. */}
      <span className="hidden text-[12px] text-muted-2 lg:inline">Writes need a live voice readback the model never sees</span>
      <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
      <LinkPill link={s.link} mic={s.mic} />
      {/* Proof of work, not just a status word: a running count of what AssemblyAI has actually transcribed. */}
      <span className="hidden items-center gap-1 font-mono text-[11px] text-muted-2 sm:flex" title="Characters transcribed this session">
        STT {s.sttChars > 0 ? s.sttChars.toLocaleString("en-US") : "–"}
      </span>
      {/* flex-wrap on the header lets this group drop to its own line instead of overflowing at narrow
          widths (390px overflowed horizontally before this -- Report/History/tools had nowhere to go). */}
      <div className="ml-auto flex items-center gap-2">
        <a href="/history/" className={BTN_QUIET}>
          <span className="flex items-center gap-1.5"><History aria-hidden size={13} /> <span className="hidden sm:inline">History</span></span>
        </a>
        <a href="/analytics/" className={BTN_QUIET}>
          <span className="flex items-center gap-1.5"><BarChart3 aria-hidden size={13} /> <span className="hidden sm:inline">Analytics</span></span>
        </a>
        {s.report && (
          <button type="button" onClick={onOpenReport} className={BTN_QUIET}>
            <span className="flex items-center gap-1.5"><FileText aria-hidden size={13} /> <span className="hidden sm:inline">Report</span></span>
          </button>
        )}
        <button
          type="button"
          aria-pressed={toolsOpen}
          onClick={onToggleTools}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-[12px] font-medium transition-colors ${
            toolsOpen ? "border-line-strong bg-panel-2 text-ink" : "border-line text-muted-2 hover:border-line-strong hover:text-muted"
          }`}
          title="Demo and testing controls"
        >
          <SlidersHorizontal aria-hidden size={13} />
        </button>
      </div>
    </header>
  );
}

const PHASE_STEPS: Phase[] = ["triage", "mitigation", "resolved"];

// Vercel's "Production Checklist" pattern, adapted: a step is either behind us (checked, struck through), the
// one we're in (an outlined dot), or ahead (dim outline). Replaces a single color-coded pill with the actual
// sequence, so progress reads at a glance instead of requiring the label to be parsed.
function PhaseSteps({ phase }: { phase: Phase }) {
  const idx = PHASE_STEPS.indexOf(phase);
  return (
    <div className="flex items-center" aria-label="Incident phase">
      {PHASE_STEPS.map((step, i) => {
        const state = i < idx || (i === idx && phase === "resolved") ? "done" : i === idx ? "current" : "pending";
        return (
          <span key={step} className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-1.5 h-px w-3 bg-line-strong" />}
            <span className="flex items-center gap-1.5">
              {state === "done" ? (
                <CheckCircle2 aria-hidden size={14} className="text-healthy" />
              ) : state === "current" ? (
                <span aria-hidden className="grid size-3.5 shrink-0 place-items-center rounded-full border-2 border-accent">
                  <span className="size-1.5 rounded-full bg-accent" />
                </span>
              ) : (
                <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-line-strong" />
              )}
              <span
                className={`text-[12.5px] ${
                  state === "done" ? "text-muted line-through decoration-muted-2/70"
                  : state === "current" ? "font-medium text-ink" : "text-muted-2"
                }`}
              >
                {PHASE_LABEL[step]}
              </span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

// The incident identity bar: id, title, phase, the clock, and the (sourced, secondary) cost estimate. Shown
// whenever there's something to report; collapses to a quiet "systems normal" line otherwise.
// Says plainly what the operator is looking at. Real containers are the claim that separates this from a
// dashboard of invented numbers, so it is worth stating -- which only works if "simulation" is stated as loudly.
function InfraChip({ infra, count }: { infra?: RelayState["infra"]; count: number }) {
  if (!infra) return null;
  const real = infra.real;
  return (
    <span
      className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 ${
        real ? "bg-healthy/10 text-healthy ring-healthy/30" : "bg-panel-2 text-muted ring-line"
      }`}
      title={real
        ? `Real Docker containers in their own compose project${infra.project ? ` (${infra.project})` : ""} — they really crash and really recover.`
        : "In-memory simulation: no containers are running. Set INFRA=docker for the real cluster."}
    >
      <Boxes aria-hidden size={12} />
      {real ? `${count} real containers` : "simulation"}
      {infra.fell_back ? <span className="text-muted-2">· docker busy</span> : null}
    </span>
  );
}

export function IncidentBar({ s }: { s: RelayState }) {
  const now = useNow();
  const id = incidentId(s.incidentAt);
  if (!id) {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-panel/40 px-5 py-2 text-[13px] text-muted">
        <span aria-hidden className="size-1.5 rounded-full bg-healthy" />
        All services normal — watching for the next incident
        <span className="ml-auto"><InfraChip infra={s.infra} count={Object.keys(s.services).length} /></span>
      </div>
    );
  }
  const secs = Math.max(0, Math.floor(((s.resolvedAt ?? now) - s.incidentAt!) / 1000));
  const cost = Math.round((secs / 60) * COST_PER_MIN);
  const lead = Object.entries(s.services).find(([, v]) => v.status === "down")?.[0]
    ?? Object.entries(s.services).find(([, v]) => v.status !== "healthy")?.[0];
  const names = Object.keys(s.services);
  const healthy = names.filter((n) => s.services[n].status === "healthy").length;
  const broken = names.length - healthy;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel/40 px-5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[13px] font-semibold text-ink">{id}</span>
        <span className="text-[13px] text-muted">{lead ? `${lead} incident` : "Incident"}</span>
      </div>
      {names.length > 0 && (
        <span className="flex items-center gap-3 font-mono text-[12px] text-muted" title="Services needing attention, out of every service watched">
          <span className={broken ? "text-degraded" : "text-healthy"}>{broken} needs attention</span>
          <span className="text-muted-2">·</span>
          <span>{healthy}/{names.length} healthy</span>
        </span>
      )}
      <InfraChip infra={s.infra} count={names.length} />
      <PhaseSteps phase={s.phase} />
      <span className="flex items-center gap-1.5 font-mono text-[13px] text-ink" title="Time since detection">
        <Clock3 aria-hidden size={13} className="text-muted" />
        T+{clock(secs)}
      </span>
      <span className="font-mono text-[12px] text-muted-2" title={`Illustrative only: ${COST_SOURCE}'s downtime-cost floor for 90%+ of mid/large firms, linearly applied.`}>
        ~${cost.toLocaleString("en-US")} at risk <span className="opacity-70">· ${COST_PER_MIN.toLocaleString("en-US")}/min, {COST_SOURCE}</span>
      </span>
    </div>
  );
}

// Demo & testing controls: a floating panel that drops down from the header trigger, never a banner competing
// with the product for space. Styled like an internal dev tool, not a feature.
export function DemoControls({
  s, open, onClose, onFault, onCut, onInject,
}: { s: RelayState; open: boolean; onClose: () => void; onFault: (f: Fault) => void; onCut: () => void; onInject: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, ref);
  if (!open) return null;
  const live = s.link === "connected" || s.link === "resumed" || s.link === "recovered";
  const active = s.phase === "triage" || s.phase === "mitigation";
  return (
    <div ref={ref} className="animate-rise absolute top-14 right-5 z-20 w-72 rounded-lg border border-line-strong bg-panel-2 p-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.65)]">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-degraded uppercase">
        <Bug aria-hidden size={12} /> Demo &amp; testing controls
      </p>
      <div className="flex flex-col gap-1.5">
        {FAULTS.map((f) => (
          <button key={f.id} type="button" className={`${BTN_QUIET} justify-start`} disabled={!((s.phase === "monitoring" || s.phase === "resolved") && live)} onClick={() => onFault(f.id)}>
            <span className="flex items-center gap-2"><Rocket aria-hidden size={13} /> {f.action}</span>
          </button>
        ))}
        <button type="button" className={`${BTN_QUIET} justify-start`} disabled={!(active && live)} onClick={onCut}>
          <span className="flex items-center gap-2"><Unplug aria-hidden size={13} /> Cut voice link</span>
        </button>
        <button type="button" className={`${BTN_QUIET} justify-start`} disabled={!(active && live)} onClick={onInject}>
          <span className="flex items-center gap-2"><Bug aria-hidden size={13} /> Poison a log line</span>
        </button>
      </div>
    </div>
  );
}

// The at-rest state: no bordered widgets waiting for data, one calm focal point instead. Services demote to a
// quiet inline strip -- confirmation, not a report -- and logs don't get a panel until there's something in it.
export function WatchingHero({ services }: { services: Record<string, Service> }) {
  const names = Object.keys(services);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="relative flex size-8 items-center justify-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-accent/15" style={{ animation: "pulse-ring 2.6s cubic-bezier(0.4,0,0.6,1) infinite" }} />
        <span aria-hidden className="relative size-2.5 rounded-full bg-accent" />
      </div>
      <h1 className="mt-8 text-[1.65rem] font-semibold tracking-tight text-ink">Watching production</h1>
      <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-muted">
        Nothing to report. The agent pages you the instant anything breaks, and starts triage on its own.
      </p>
      {names.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {names.map((name) => {
            const st = STATUS[services[name].status] ?? STATUS.degraded;
            return (
              <span key={name} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[12px] ${st.bg} ${st.text}`}>
                <span aria-hidden className={`size-1.5 rounded-full ${st.dot}`} />
                {name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A status glyph in the corner, not a colored pill -- the pattern real ops dashboards (Vercel's project cards)
// actually use. A pill announces; an icon lets you scan a whole list at a glance.
const STATUS_ICON: Record<Status, typeof CheckCircle2> = {
  healthy: CheckCircle2, degraded: AlertTriangle, down: AlertTriangle, remediating: RefreshCw,
};

export function Strips({ services }: { services: Record<string, Service> }) {
  const names = Object.keys(services);
  if (!names.length) return <p className="grid h-full min-h-32 place-content-center px-4 text-center text-sm text-muted">Waiting for the first health check…</p>;
  return (
    <ul className="space-y-2 p-3">
      {names.map((name) => {
        const svc = services[name];
        const st = STATUS[svc.status] ?? STATUS.degraded;
        const StatusIcon = STATUS_ICON[svc.status] ?? AlertTriangle;
        return (
          <li key={name} className="rounded-lg bg-panel-2 p-3.5 ring-1 ring-line">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={`grid size-7 shrink-0 place-items-center rounded-md ${st.bg}`}>
                  <Server aria-hidden size={14} className={st.text} />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-ink">{name}</p>
                  <p className="text-[12px] text-muted">
                    <span className="font-mono">{svc.version}</span> · deployed {svc.last_deploy}
                  </p>
                </div>
              </div>
              <StatusIcon
                aria-label={st.label}
                size={16}
                className={`mt-0.5 shrink-0 ${st.text} ${svc.status === "remediating" ? "animate-spin" : ""}`}
              />
            </div>
            <div className="mt-3 flex items-center gap-4 border-t border-line pt-2.5 font-mono text-[11px] text-muted">
              <span>err <span className="text-ink/80">{pct(svc.error_rate)}</span></span>
              <span>p99 <span className="text-ink/80">{svc.p99_ms === undefined ? "—" : `${svc.p99_ms}ms`}</span></span>
              {svc.queue_depth ? <span>queue <span className="text-ink/80">{svc.queue_depth.toLocaleString("en-US")}</span></span> : null}
            </div>
            {/* Docker's own words about the container -- "Restarting (2) 4 seconds ago" is the crash loop, not a
                number we made up. Absent in sim mode, where there is nothing real to quote. */}
            {svc.container && (
              <p className="mt-2 truncate font-mono text-[10.5px] text-muted-2" title={svc.container_name ?? undefined}>
                <span className="text-muted">container</span> {svc.container}
                {svc.port ? <span className="text-muted"> · :{svc.port}</span> : null}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// F10e: Escape closes any dismissible overlay; an optional ref also closes it on an outside click (the
// ReportDrawer's own backdrop button already covers that case, so it only needs the Escape half).
function useDismiss(open: boolean, onClose: () => void, ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref?.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    if (ref) document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (ref) document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose, ref]);
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function LogTape({ logs, highlight }: { logs: LogLine[]; highlight?: string }) {
  const ref = useStickToBottom(logs);
  return (
    <div ref={ref} role="log" aria-label="Service logs" className="h-full max-h-[50vh] overflow-y-auto py-2 font-mono text-[12px] leading-5 lg:max-h-none">
      {!logs.length && <p className="grid h-full min-h-32 place-content-center px-4 text-center text-muted">Logs from all three services stream here.</p>}
      {logs.map((l) => {
        const matched = !!highlight && l.line.includes(highlight);
        return (
          <p key={l.id} className={`grid grid-cols-[7.5rem_1fr] gap-3 px-4 ${matched ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : ""}`}>
            <span className="truncate text-muted-2">{l.service}</span>
            <span className={matched ? "text-accent" : l.level === "error" ? "text-down" : "text-ink/70"}>{l.line}</span>
          </p>
        );
      })}
    </div>
  );
}

export function Waveform({ levels }: { levels: () => { operator: number; agent: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const css = getComputedStyle(document.documentElement);
    const opColor = css.getPropertyValue("--color-ink").trim();
    const agColor = css.getPropertyValue("--color-accent").trim();
    const op = new Array(96).fill(0);
    const ag = new Array(96).fill(0);
    let raf = 0;
    let lastT = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - lastT < 50) return;
      lastT = t;
      const l = levels();
      op.push(l.operator);
      op.shift();
      ag.push(l.agent);
      ag.shift();
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const bw = w / op.length;
      const mid = h / 2;
      g.fillStyle = `color-mix(in oklab, ${opColor} 14%, transparent)`;
      g.fillRect(0, mid - 0.5, w, 1);
      for (let i = 0; i < op.length; i++) {
        const o = Math.min(1, op[i] * 1.8) * (mid - 3);
        const a = Math.min(1, ag[i] * 1.8) * (mid - 3);
        if (o > 0.6) {
          g.fillStyle = opColor;
          g.fillRect(i * bw, mid - o - 1, Math.max(1, bw - 2), o + 1);
        }
        if (a > 0.6) {
          g.fillStyle = agColor;
          g.fillRect(i * bw, mid + 1, Math.max(1, bw - 2), a + 1);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levels]);
  return <canvas ref={ref} role="img" aria-label="Voice activity: you above the line, the agent below" className="h-10 w-full" />;
}

export function Speaking({ s }: { s: RelayState }) {
  const dot = (on: boolean, color: string) => <span aria-hidden className={`size-1.5 rounded-full ${on ? color : "bg-line"}`} />;
  return (
    <span className="flex items-center gap-4 font-mono text-[10.5px] tracking-[0.08em] text-muted uppercase">
      <span className="flex items-center gap-1.5">{dot(s.operatorSpeaking, "bg-ink")}You</span>
      <span className="flex items-center gap-1.5">{dot(s.agentSpeaking, "bg-accent")}Agent</span>
    </span>
  );
}

// ---- the clearance code, rendered the same way live (large) or in history (compact) ----

export function CodeWords({ words, size = "lg" }: { words: string[]; size?: "lg" | "sm" }) {
  const cls = size === "lg"
    ? "rounded-lg border-2 border-accent/50 bg-accent/[0.07] px-4 py-2 font-mono text-[1.5rem] leading-none font-bold tracking-[0.04em] text-accent uppercase sm:text-[1.9rem]"
    : "rounded border border-line-strong bg-panel px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide text-ink uppercase";
  return (
    <div className={`flex flex-wrap ${size === "lg" ? "gap-2.5" : "gap-1.5"}`}>
      {words.map((w, i) => <span key={i} className={cls}>{w}</span>)}
    </div>
  );
}

// F10d: the diff has no line numbers, so it can't point at crash_line word-for-word -- that string only ever
// matches a log line (see LogTape's highlight). Naming it directly under the diff is the honest version of
// "annotate the exact line": it connects the change to the crash without pretending to find it inside the diff.
function DiffBlock({ diff, crashLine }: { diff: string; crashLine?: string }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md bg-board px-3 py-2.5 font-mono text-[11.5px] leading-[1.65]">
      {diff.split("\n").map((line, i) => (
        <div key={i} className={line.startsWith("+") ? "text-healthy" : line.startsWith("-") ? "text-down" : "text-muted"}>
          {line || " "}
        </div>
      ))}
      {crashLine && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-line-strong pt-2 text-down">
          <span aria-hidden className="rounded bg-down/15 px-1 text-[10px] font-semibold">E1</span>
          crashes at {crashLine}
        </div>
      )}
    </div>
  );
}

const GATE_TITLE: Record<Gate["state"], string> = {
  awaiting: "Awaiting voice authorization", approved: "Authorized", executing: "Executing", done: "Complete", rejected: "Cancelled",
};

// F10a: institutional memory, made visible -- not just a line in the page. Distinct from the clearance card
// (this is what the agent remembers, not what it's waiting on) so the two are never mistaken for each other.
export function PrecedentCard({ precedent }: { precedent: Precedent }) {
  return (
    <div className="animate-rise flex items-start gap-3 rounded-lg bg-panel/70 px-4 py-3.5 ring-1 ring-line">
      <History aria-hidden size={16} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-accent uppercase">Seen this before</p>
        <p className="mt-1 text-[13.5px] text-ink">
          {precedent.service} failed the same way before, at {hms(precedent.resolved_at * 1000)}
          {" — "}
          a {precedent.action.replace("_", " ")} fixed it in {precedent.mttr_s}s.
        </p>
      </div>
    </div>
  );
}

// The signature moment, always docked at the top of the command column -- never inside a scrolling feed, never
// behind navigation. This is what the whole product is for; it doesn't get to be optional to find.
export function LiveClearance({ gate, mic }: { gate: Gate; mic: RelayState["mic"] }) {
  const now = useNow(200);
  const [expanded, setExpanded] = useState(true); // F10d: root cause is default-visible, not a footnote
  const words = (gate.code ?? "").toUpperCase().split(" ");
  const left = gate.expiresAt ? Math.max(0, gate.expiresAt - now) : 0;
  const awaiting = gate.state === "awaiting";
  const expired = awaiting && left === 0;
  const changeText = `${ACTION[gate.action] ?? gate.action} ${gate.service}${gate.change?.includes(" to ") ? ` · ${gate.change.replace(" to ", " → ")}` : ""}`;
  return (
    <div
      key={gate.code}
      className={`animate-rise relative overflow-hidden rounded-lg border p-5 ${
        awaiting && !expired ? "border-accent/50 bg-panel" : "border-line bg-panel"
      }`}
    >
      {awaiting && !expired && (
        <span aria-hidden className="absolute top-5 right-5 size-2 rounded-full bg-accent" />
      )}
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <Lock aria-hidden size={13} className={awaiting && !expired ? "text-accent" : "text-muted"} />
        <span>{expired ? "Code expired" : GATE_TITLE[gate.state]}</span>
        {awaiting && !expired && <span className="ml-auto font-mono tabular-nums normal-case">{Math.ceil(left / 1000)}s left</span>}
      </div>
      <p className="mt-3 text-[17px] font-semibold text-ink">{changeText}</p>
      {gate.affected?.length ? <p className="mt-0.5 text-[13px] text-muted">Affects {gate.affected.join(", ")}</p> : null}
      {awaiting && !expired && (
        <>
          <div className="mt-4">
            <CodeWords words={words} />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Say: <span className="font-mono text-ink">&ldquo;{ACTION[gate.action] ?? gate.action} {gate.service}, {words.join(" ")}.&rdquo;</span>
          </p>
          <div aria-hidden className="mt-4 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${(left / 120000) * 100}%` }} />
          </div>
        </>
      )}
      {gate.evidence && (
        <div className="mt-4 border-t border-line pt-3">
          <button type="button" onClick={() => setExpanded((e) => !e)} className="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase hover:text-ink">
            {expanded ? <ChevronUp aria-hidden size={13} /> : <ChevronDown aria-hidden size={13} />}
            Root cause
          </button>
          {expanded && (
            <div className="mt-2.5">
              <p className="text-[13.5px] text-ink">
                <span className="font-mono text-muted">{gate.evidence.commit}</span> <span className="text-muted">·</span> {gate.evidence.message}
              </p>
              <p className="mt-1 font-mono text-xs text-muted">{gate.evidence.files.join(", ")}</p>
              <DiffBlock diff={gate.evidence.diff} crashLine={gate.evidence.crash_line} />
            </div>
          )}
        </div>
      )}
      <p className="mt-4 text-[13px] text-muted">
        {expired
          ? "Nothing was changed. Ask the agent to propose the fix again for a new code."
          : mic === "blocked"
            ? "Your microphone is blocked — allow it in the browser to authorize by voice."
            : mic === "off"
              ? "Watching without a microphone: nobody can authorize this. The agent cannot see this code."
              : "The agent cannot see this code. It is shown only on your screen."}
        {gate.state === "approved" || gate.state === "executing" || gate.state === "done" ? ` Authorized: “${gate.heard}”.` : null}
      </p>
      {/* F9: show confidence badge when the readback has been scored */}
      {gate.confidence && (gate.state === "approved" || gate.state === "executing" || gate.state === "done") && (
        <div className="mt-2">
          <ConfidenceBadge score={gate.confidence.code_score} />
        </div>
      )}
    </div>
  );
}

const AGENT_REQUEST_TITLE: Record<AgentRequest["state"], string> = {
  pending: "External agent request", approved: "Allowed", denied: "Denied", expired: "Expired, unanswered",
};

// F4: any coding agent, not just this one, can ask AyeOps to gate a production action -- the same code, the
// same voice decision, the same full-width treatment as a rollback proposal.
export function LiveAgentRequest({ req }: { req: AgentRequest }) {
  const now = useNow(200);
  const words = (req.code ?? "").toUpperCase().split(" ");
  const pending = req.state === "pending";
  const left = req.expiresAt ? Math.max(0, req.expiresAt - now) : 0;
  return (
    <div className={`animate-rise rounded-lg border p-5 ${pending ? "border-down/50 bg-panel" : "border-line bg-panel"}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
        <Bot aria-hidden size={13} className={pending ? "text-down" : "text-muted"} />
        <span>{AGENT_REQUEST_TITLE[req.state]}</span>
        {pending && <span className="ml-auto font-mono tabular-nums normal-case">{Math.ceil(left / 1000)}s left</span>}
      </div>
      <p className="mt-3 text-[17px] font-semibold text-ink">
        {req.agent} wants to run <span className="font-mono">{req.command}</span>
      </p>
      <p className="mt-0.5 text-[13px] text-muted">on {req.target} — &ldquo;{req.reason}&rdquo;</p>
      {pending && req.code && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <CodeWords words={words} />
          <p className="text-[13px] text-muted">Read the code aloud to allow it, or just say no.</p>
        </div>
      )}
    </div>
  );
}

// Compact history rows for entries in the feed that already had their moment above.
function AuthorizationRow({ gate }: { gate: Gate }) {
  const Icon = gate.state === "rejected" ? XCircle : CheckCircle2;
  const changeText = `${ACTION[gate.action] ?? gate.action} ${gate.service}${gate.change?.includes(" to ") ? ` · ${gate.change.replace(" to ", " → ")}` : ""}`;
  return (
    <div className="flex items-center gap-2 py-1 pl-9 text-[13px] text-muted">
      <Icon aria-hidden size={14} className={gate.state === "rejected" ? "text-down" : "text-healthy"} />
      <span>{changeText} — {GATE_TITLE[gate.state].toLowerCase()}</span>
    </div>
  );
}

function AgentRequestRow({ req }: { req: AgentRequest }) {
  const Icon = req.state === "approved" ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-center gap-2 py-1 pl-9 text-[13px] text-muted">
      <Icon aria-hidden size={14} className={req.state === "approved" ? "text-healthy" : "text-down"} />
      <span>{req.agent} requested {req.command} — {AGENT_REQUEST_TITLE[req.state].toLowerCase()}</span>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  switch (item.kind) {
    case "speech": {
      const who = item.who === "agent" ? "Agent" : "You";
      return (
        <div className="grid grid-cols-[4.5rem_1fr] gap-3 py-1.5 text-[14px] leading-snug">
          <span className={`pt-0.5 text-[11px] font-semibold tracking-wide uppercase ${item.who === "agent" ? "text-accent" : "text-ink"}`}>{who}</span>
          <span className={item.who === "agent" ? "text-ink" : "text-ink/85"}>
            {item.text}
            {item.interrupted ? " —" : ""}
          </span>
        </div>
      );
    }
    case "tool":
      return (
        <div className="py-1 pl-9 font-mono text-[12px] text-muted">
          <ScrollText aria-hidden size={11} className="mr-1.5 inline -translate-y-px" />
          {item.text}
        </div>
      );
    case "phase":
      return (
        <div className="flex items-center gap-3 py-2.5">
          <span aria-hidden className="h-px flex-1 bg-line" />
          <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            {item.phase === "resolved" ? "Resolved" : `${PHASE_LABEL[item.phase]} started`}
          </span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      );
    case "gate":
      return <AuthorizationRow gate={item.gate} />;
    case "agent_request":
      return <AgentRequestRow req={item.req} />;
    case "flag":
      return (
        <div className="flex items-start gap-2 rounded-md bg-degraded/10 px-3 py-2 text-[12.5px] text-degraded">
          <AlertTriangle aria-hidden size={14} className="mt-0.5 shrink-0" />
          <span>
            Instruction-shaped log line from <span className="font-mono">{item.service}</span>, treated as data:{" "}
            <span className="font-mono opacity-80">“{item.line}”</span>
          </span>
        </div>
      );
    case "precedent":
      return (
        <div className="flex items-start gap-2 rounded-md bg-accent/10 px-3 py-2 text-[12.5px] text-accent">
          <History aria-hidden size={14} className="mt-0.5 shrink-0" />
          <span>
            Matches a prior {item.precedent.service} incident — a {item.precedent.action.replace("_", " ")} fixed it
            in {item.precedent.mttr_s}s
          </span>
        </div>
      );
    case "refusal":
      return (
        <div className="flex items-start gap-2 rounded-md bg-healthy/10 px-3 py-2 text-[12.5px] text-healthy">
          <ShieldCheck aria-hidden size={14} className="mt-0.5 shrink-0" />
          <span>
            Declined a {item.requested.replace("_", " ")} on <span className="font-mono">{item.service}</span> — {item.reason};
            proposed a {item.proposed.replace("_", " ")} instead
          </span>
        </div>
      );
    case "link": {
      const tone = item.tone === "ok" ? "text-healthy" : item.tone === "error" ? "text-down" : "text-degraded";
      const Icon = item.tone === "ok" ? Wifi : WifiOff;
      return (
        <div className={`flex items-center gap-2 py-1 text-[12.5px] ${tone}`}>
          <Icon aria-hidden size={13} />
          {item.text}
        </div>
      );
    }
  }
}

export function ActivityFeed({ s }: { s: RelayState }) {
  const ref = useStickToBottom([s.feed.length, s.live]);
  const who = (w: "operator" | "agent") => (w === "agent" ? "Agent" : "You");
  return (
    <div ref={ref} role="log" aria-label="Activity" className="h-full space-y-1 overflow-y-auto px-4 py-3">
      {!s.feed.length && !s.live && (
        <div className="grid h-full min-h-40 place-content-center text-center">
          <p className="text-sm text-muted">The agent greets you in a moment.</p>
          <p className="mt-1 text-sm text-muted-2">Speak normally — it listens the whole time.</p>
        </div>
      )}
      {s.feed.map((item) => <FeedRow key={item.id} item={item} />)}
      {s.live && (
        <div className="grid grid-cols-[4.5rem_1fr] gap-3 py-1.5 text-[14px] leading-snug text-muted">
          <span className="pt-0.5 text-[11px] tracking-wide uppercase">{who(s.live.who)}</span>
          <span>
            {s.live.text}
            <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-muted" />
          </span>
        </div>
      )}
    </div>
  );
}

// The receipt that a fix actually worked, not just that it ran -- error rate and p99 before the incident opened
// versus after it resolved, per service. Deliberately not a colored diff bar: the number is the point.
function RecoveryRow({ service, delta }: { service: string; delta: RecoveryDelta }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-ink">{service}</span>
      <span className="flex items-center gap-4 font-mono text-[12px] text-muted">
        <span>
          err {pct(delta.error_rate_before)} <span className="text-muted-2">→</span>{" "}
          <span className={delta.error_rate_after > 0 ? "text-degraded" : "text-healthy"}>{pct(delta.error_rate_after)}</span>
        </span>
        <span>
          p99 {delta.p99_before}ms <span className="text-muted-2">→</span> <span className="text-ink/80">{delta.p99_after}ms</span>
        </span>
      </span>
    </div>
  );
}

// The report: a slide-over, not a tab -- it never has to compete with a live incident for the same screen.
export function ReportDrawer({ s, open, onClose }: { s: RelayState; open: boolean; onClose: () => void }) {
  useDismiss(open, onClose); // the backdrop button already covers an outside click; this adds Escape
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button type="button" aria-label="Close report" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="animate-rise relative flex h-full w-full max-w-2xl flex-col border-l border-line bg-board shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            <FileText aria-hidden size={13} /> Incident report
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink">
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!s.report ? (
            <div className="grid h-full min-h-64 place-content-center text-center">
              <FileText aria-hidden size={22} className="mx-auto text-muted-2" />
              <p className="mt-2 text-sm text-muted">The report is filed automatically once an incident resolves.</p>
            </div>
          ) : (
            <div className="space-y-6 px-5 py-6">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                  <p className="text-[10.5px] tracking-wide text-muted uppercase">Detected</p>
                  <p className="mt-1 font-mono text-sm text-ink">{s.incidentAt ? hms(s.incidentAt) : "—"}</p>
                </div>
                <div className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                  <p className="text-[10.5px] tracking-wide text-muted uppercase">Recovered</p>
                  <p className="mt-1 font-mono text-sm text-ink">{s.resolvedAt ? hms(s.resolvedAt) : "—"}</p>
                </div>
                <div className="rounded-lg border border-line bg-panel-2 px-4 py-3">
                  <p className="text-[10.5px] tracking-wide text-accent uppercase">Time to recover</p>
                  <p className="mt-1 font-mono text-sm text-ink">{s.ttr}s</p>
                </div>
              </div>
              {s.feed.filter((f): f is FeedItem & { kind: "gate" } => f.kind === "gate" && f.gate.state === "approved").map((g) => (
                <div key={g.id} className="rounded-lg border border-line bg-panel-2 px-4 py-3.5">
                  <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">Voice-authorized change</p>
                  <p className="mt-1.5 text-[14px] text-ink">
                    {ACTION[g.gate.action] ?? g.gate.action} {g.gate.service}
                    {g.gate.change?.includes(" to ") ? ` · ${g.gate.change.replace(" to ", " → ")}` : ""}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">Authorized: &ldquo;{g.gate.heard}&rdquo;</p>
                </div>
              ))}
              {s.deltas && Object.keys(s.deltas).length > 0 && (
                <div className="rounded-lg border border-line bg-panel-2 px-4 py-3.5">
                  <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Recovery</p>
                  <div className="space-y-2">
                    {Object.entries(s.deltas).map(([svc, d]) => <RecoveryRow key={svc} service={svc} delta={d} />)}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Timeline</p>
                <div className="rounded-lg border border-line bg-panel-2 px-4 py-2">
                  {s.feed.map((item) => (
                    <div key={item.id} className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-line py-2 text-[13px] last:border-0">
                      <span className="font-mono text-muted-2">{hms(item.at)}</span>
                      <FeedRow item={item} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// The whole product in one picture: the operator's screen holds a code, and the payload the model received
// does not. Rendered from the exact bytes sent as the tool result, so if a code ever leaked into the model's
// context this panel is where it would show up -- it is a check, not an illustration.
export function ModelContextCard({ ctx, codeWords }: { ctx: ModelContext | null | undefined; codeWords: number }) {
  if (!ctx) return null;
  const lines = JSON.stringify(ctx.payload, null, 2).split("\n");
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <EyeOff aria-hidden size={13} className="text-muted-2" />
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">Model context</span>
        <span className="ml-auto font-mono text-[10.5px] text-muted-2">tool.result · {ctx.call}</span>
      </div>

      {/* Where the code would be, if the model were told it. */}
      <div className="border-b border-line bg-panel-2/60 px-4 py-3">
        <p className="mb-2 font-mono text-[10.5px] tracking-wide text-muted-2 uppercase">authorization code</p>
        <div className="flex items-center gap-2" aria-label={`${codeWords} words withheld from the model`}>
          {Array.from({ length: codeWords }).map((_, i) => (
            <span key={i} className="h-[3.25rem] flex-1 rounded-md bg-line/80 ring-1 ring-line" />
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-muted">
          Withheld. The agent cannot say this, and cannot act without it.
        </p>
      </div>

      <pre className="max-h-72 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
        {lines.map((l, i) => (
          <div key={i} className="break-words whitespace-pre-wrap">{l}</div>
        ))}
      </pre>
    </div>
  );
}

export function ApiPanel({ events }: { events: ApiEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase transition-colors hover:text-ink"
      >
        <span className="flex items-center gap-2">
          <Activity aria-hidden size={12} className="text-accent" />
          AssemblyAI Voice Agent API · {events.length} events
        </span>
        <span className="flex items-center gap-1 text-[10px]">
          {open ? <ChevronUp aria-hidden size={12} /> : <ChevronDown aria-hidden size={12} />}
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <ol className="max-h-56 overflow-x-auto overflow-y-auto border-t border-line px-5 py-2 font-mono text-xs">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="grid w-max min-w-full grid-cols-[5.5rem_1.25rem_13rem_1fr] gap-2 py-1">
              <span className="text-muted-2 tabular-nums">{hms(e.at)}</span>
              <span className={e.dir === "out" ? "text-accent" : "text-ink/70"} title={e.dir === "out" ? "Sent by the relay" : "Received"}>
                {e.dir === "out" ? "→" : "←"}
              </span>
              <span className="truncate text-ink">{e.type}</span>
              <span className="truncate text-muted">{e.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Post-execution rating: operator rates whether the fix actually worked. Shows after resolution.
export function RatingPanel({
  s, onRate,
}: { s: RelayState; onRate: (sessionId: string, rating: "up" | "down") => void }) {
  if (s.phase !== "resolved" || s.rating || !s.report) return null;
  // Extract session ID from the postmortem header (first line: "# Incident report {session_id}")
  const match = s.report.match(/^# Incident report (.+)/m);
  const sessionId = match?.[1]?.trim();
  if (!sessionId) return null;
  return (
    <div className="animate-rise flex items-center gap-4 rounded-lg border border-line bg-panel px-4 py-3">
      <span className="text-[12px] text-muted">Did the fix work?</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRate(sessionId, "up")}
          className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[12px] font-medium text-healthy transition-colors hover:border-healthy/40 hover:bg-healthy/10"
        >
          👍 Yes
        </button>
        <button
          type="button"
          onClick={() => onRate(sessionId, "down")}
          className="rounded-md border border-line bg-panel-2 px-3 py-1.5 text-[12px] font-medium text-down transition-colors hover:border-down/40 hover:bg-down/10"
        >
          👎 No
        </button>
      </div>
    </div>
  );
}

export function LinkToast({ s }: { s: RelayState }) {
  const now = useNow(500);
  if (s.error) return <Toast tone="error">The session stopped: {s.error}. Reload the page to start a new one.</Toast>;
  if (s.link === "reconnecting") return <Toast tone="warn">Voice link lost. Reconnecting…</Toast>;
  if (s.recovery && now - s.recovery.at < 6000) {
    const how = s.recovery.kind === "resumed" ? "same session" : "new session, briefed from the record";
    return <Toast tone="ok">Voice link restored in {(s.recovery.ms / 1000).toFixed(1)}s ({how}).</Toast>;
  }
  return null;
}

function Toast({ tone, children }: { tone: "warn" | "ok" | "error"; children: ReactNode }) {
  const cls = tone === "ok" ? "border-healthy/40 bg-healthy/10 text-healthy" : tone === "error" ? "border-down/40 bg-down/10 text-down" : "border-degraded/40 bg-degraded/10 text-degraded";
  return <p role="status" className={`border-b px-5 py-2 text-[13px] ${cls}`}>{children}</p>;
}

export { Server, ScrollText, Radio };
