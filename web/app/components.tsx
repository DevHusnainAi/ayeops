"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { ApiEvent, Gate, Line, LinkState, LogLine, Phase, RelayState, Service, Status } from "@/lib/relay";

export const BTN =
  "rounded-sm bg-ink px-3 py-1.5 text-sm font-semibold text-board transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-35";
export const BTN_QUIET =
  "rounded-sm border border-rule px-3 py-1.5 text-sm text-ink transition-colors hover:border-muted disabled:cursor-not-allowed disabled:opacity-35";

// ITIC 2024: downtime costs over $300,000 an hour for more than 90% of mid-size and large enterprises.
const COST_PER_MIN = 5000;
const COST_NOTE = "At $5,000 a minute: the floor implied by ITIC's 2024 survey (over $300,000 an hour for 90%+ of mid-size and large enterprises).";

const STATUS: Record<Status, { label: string; bar: string; text: string }> = {
  healthy: { label: "Healthy", bar: "bg-healthy", text: "text-healthy" },
  degraded: { label: "Degraded", bar: "bg-degraded", text: "text-degraded" },
  down: { label: "Down", bar: "bg-down", text: "text-down" },
  remediating: { label: "Remediating", bar: "bg-remediating", text: "text-remediating" },
};
const PHASES: [Phase, string][] = [
  ["monitoring", "Monitoring"],
  ["triage", "Triage"],
  ["mitigation", "Mitigation"],
  ["resolved", "Resolved"],
];
const ACTION: Record<string, string> = { rollback: "Roll back", restart: "Restart", scale_up: "Scale up" };
const GATE_TITLE: Record<Gate["state"], string> = {
  awaiting: "Read aloud to authorize",
  approved: "Authorized",
  executing: "Authorized · running",
  done: "Change complete",
  rejected: "Cancelled",
};

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

export function Panel({ title, aside, className = "", children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`flex min-h-0 flex-col rounded-md border border-rule bg-panel/60 ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">{title}</h2>
        {aside}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function Readout({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} className="leading-tight">
      <p className="text-[10px] tracking-[0.16em] text-muted uppercase">{label}</p>
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

const LINK_TEXT: Record<LinkState, string> = {
  idle: "Offline",
  connecting: "Connecting",
  connected: "Voice link live",
  reconnecting: "Reconnecting",
  resumed: "Voice link live",
  recovered: "Voice link live",
  closed: "Disconnected",
};

function LinkPill({ link, mic }: { link: LinkState; mic: RelayState["mic"] }) {
  const live = link === "connected" || link === "resumed" || link === "recovered";
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden className={`size-2 rounded-full ${live ? "bg-healthy" : link === "reconnecting" ? "bg-degraded" : "bg-muted"}`} />
      {LINK_TEXT[link]}
      {mic === "blocked" && <span className="rounded-sm border border-degraded/50 px-1.5 py-0.5 text-degraded">Mic blocked</span>}
      {mic === "off" && <span className="rounded-sm border border-rule px-1.5 py-0.5">Watch only</span>}
    </span>
  );
}

function Stepper({ phase }: { phase: Phase }) {
  const at = PHASES.findIndex(([p]) => p === phase);
  return (
    <ol className="flex items-center text-[11px]" aria-label="Incident phase">
      {PHASES.map(([p, label], i) => (
        <li key={p} aria-current={i === at ? "step" : undefined} className="flex items-center">
          {i > 0 && <span aria-hidden className="mx-1.5 h-px w-4 bg-rule" />}
          <span
            className={`rounded-sm px-2 py-1 tracking-[0.14em] uppercase ${
              i === at ? "bg-panel text-ink ring-1 ring-rule" : i < at ? "text-muted" : "text-muted/50"
            }`}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TopBar({ s, onFault, onCut }: { s: RelayState; onFault: () => void; onCut: () => void }) {
  const now = useNow();
  const secs = s.incidentAt ? Math.max(0, Math.floor(((s.resolvedAt ?? now) - s.incidentAt) / 1000)) : 0;
  const live = s.link === "connected" || s.link === "resumed" || s.link === "recovered";
  const active = s.phase === "triage" || s.phase === "mitigation";
  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-rule px-5 py-3">
      <div className="flex items-center gap-4">
        <span className="font-display text-2xl font-extrabold tracking-wide uppercase">{BRAND}</span>
        <LinkPill link={s.link} mic={s.mic} />
      </div>
      <Stepper phase={s.phase} />
      <div className="ml-auto flex flex-wrap items-center gap-6">
        <Readout label="Incident clock" value={s.incidentAt ? `T+${clock(secs)}` : "—"} />
        <Readout label="Est. cost at risk" value={s.incidentAt ? `$${Math.round((secs / 60) * COST_PER_MIN).toLocaleString("en-US")}` : "—"} title={COST_NOTE} />
        <Readout label="Turn latency" value={s.latency ? `${(s.latency / 1000).toFixed(2)} s` : "—"} />
        <div className="flex gap-2" role="group" aria-label="Demo controls">
          <button type="button" className={BTN} disabled={!(s.phase === "monitoring" && live)} onClick={onFault}>
            Ship a bad deploy
          </button>
          <button type="button" className={BTN_QUIET} disabled={!(active && live)} onClick={onCut}>
            Cut voice link
          </button>
        </div>
      </div>
    </header>
  );
}

export function LinkBanner({ s }: { s: RelayState }) {
  const now = useNow(500);
  let tone = "", text = "";
  if (s.error) {
    tone = "border-down/40 bg-down/10 text-down";
    text = `The session stopped: ${s.error}. Reload the page to start a new one.`;
  } else if (s.link === "reconnecting") {
    tone = "border-degraded/40 bg-degraded/10 text-degraded";
    text = "Voice link lost. Reconnecting…";
  } else if (s.recovery && now - s.recovery.at < 10000) {
    tone = "border-healthy/40 bg-healthy/10 text-healthy";
    const how = s.recovery.kind === "resumed" ? "same session" : "new session briefed from the incident record";
    text = `Voice link restored in ${(s.recovery.ms / 1000).toFixed(1)} s (${how}). Any pending authorization still works.`;
  } else if (s.link === "closed") {
    tone = "border-rule bg-panel text-muted";
    text = "Session ended. Reload the page to start a new one.";
  }
  if (!text) return null;
  return (
    <p role="status" className={`border-b px-5 py-2 text-sm ${tone}`}>
      {text}
    </p>
  );
}

export function Strips({ services }: { services: Record<string, Service> }) {
  const names = Object.keys(services);
  if (!names.length) return <p className="px-4 py-6 text-sm text-muted">Waiting for the first health check…</p>;
  return (
    <ul className="space-y-2 p-3">
      {names.map((name) => {
        const svc = services[name];
        const st = STATUS[svc.status] ?? STATUS.degraded;
        return (
          <li key={name} className="grid grid-cols-[6px_1fr] overflow-hidden rounded-sm bg-board/70 ring-1 ring-rule">
            <span aria-hidden className={`${st.bar} transition-colors duration-700`} />
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[15px] text-ink">{name}</span>
                <span key={svc.status} className={`animate-flash rounded-sm px-1.5 text-sm font-semibold tracking-[0.12em] uppercase ${st.text}`}>
                  {st.label}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 divide-x divide-rule font-mono text-xs">
                {[
                  ["version", svc.version],
                  ["errors", pct(svc.error_rate)],
                  ["p99", svc.p99_ms === undefined ? "—" : `${svc.p99_ms} ms`],
                ].map(([k, v]) => (
                  <div key={k} className="px-2 first:pl-0">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-ink tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 truncate text-xs text-muted">
                Deployed {svc.last_deploy}
                {svc.queue_depth ? ` · queue ${svc.queue_depth.toLocaleString("en-US")}` : ""}
                {svc.container ? ` · ${svc.container}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function LogTape({ logs }: { logs: LogLine[] }) {
  const ref = useStickToBottom(logs);
  return (
    <div ref={ref} role="log" aria-label="Service logs" className="h-full max-h-[60vh] overflow-y-auto py-2 font-mono text-[12px] leading-5 lg:max-h-none">
      {!logs.length && <p className="px-4 text-muted">Logs from all three services stream here.</p>}
      {logs.map((l) => (
        <p key={l.id} className="grid grid-cols-[7.5rem_1fr] gap-3 px-4">
          <span className="truncate text-muted">{l.service}</span>
          <span className={l.level === "error" ? "text-down" : "text-ink/70"}>{l.line}</span>
        </p>
      ))}
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
    const agColor = css.getPropertyValue("--color-agent").trim();
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
      // One channel, two voices: the operator above the line, the agent below.
      for (let i = 0; i < op.length; i++) {
        const o = Math.min(1, op[i] * 1.8) * (mid - 3);
        const a = Math.min(1, ag[i] * 1.8) * (mid - 3);
        g.fillStyle = opColor;
        g.fillRect(i * bw, mid - o - 1, Math.max(1, bw - 2), o + 1);
        g.fillStyle = agColor;
        g.fillRect(i * bw, mid + 1, Math.max(1, bw - 2), a + 1);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levels]);
  return <canvas ref={ref} role="img" aria-label="Voice activity: you above the line, the agent below" className="h-20 w-full" />;
}

export function Speaking({ s }: { s: RelayState }) {
  const dot = (on: boolean, color: string) => <span aria-hidden className={`size-1.5 rounded-full ${on ? color : "bg-rule"}`} />;
  return (
    <span className="flex items-center gap-4 text-[11px] tracking-[0.14em] text-muted uppercase">
      <span className="flex items-center gap-1.5">{dot(s.operatorSpeaking, "bg-ink")}You</span>
      <span className="flex items-center gap-1.5">{dot(s.agentSpeaking, "bg-agent")}Agent</span>
    </span>
  );
}

export function Transcript({ lines, live }: { lines: Line[]; live: RelayState["live"] }) {
  const ref = useStickToBottom([lines, live]);
  const who = (w: "operator" | "agent") => (w === "agent" ? "Agent" : "You");
  return (
    <div ref={ref} role="log" aria-label="Conversation" className="h-full max-h-[50vh] space-y-2.5 overflow-y-auto px-4 py-3 lg:max-h-none">
      {!lines.length && !live && (
        <p className="text-sm text-muted">The agent greets you in a moment. Speak normally; it listens the whole time.</p>
      )}
      {lines.map((l) =>
        l.who === "tool" ? (
          <p key={l.id} className="pl-[5.25rem] font-mono text-xs text-muted">
            ↳ {l.text}
          </p>
        ) : (
          <p key={l.id} className="grid grid-cols-[4.5rem_1fr] gap-3 text-[15px] leading-snug">
            <span className={`pt-0.5 text-[11px] font-semibold tracking-[0.16em] uppercase ${l.who === "agent" ? "text-agent" : "text-ink"}`}>
              {who(l.who)}
            </span>
            <span className={l.who === "agent" ? "text-ink" : "text-ink/85"}>
              {l.text}
              {l.interrupted ? " —" : ""}
            </span>
          </p>
        ),
      )}
      {live && (
        <p className="grid grid-cols-[4.5rem_1fr] gap-3 text-[15px] leading-snug text-muted">
          <span className="pt-0.5 text-[11px] tracking-[0.16em] uppercase">{who(live.who)}</span>
          <span>
            {live.text}
            <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-muted" />
          </span>
        </p>
      )}
    </div>
  );
}

function Stamp({ heard, at, cancelled }: { heard?: string; at?: number; cancelled?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute top-12 right-6 animate-stamp rounded-md border-[3px] px-4 py-2 text-center mix-blend-multiply ${
        cancelled ? "border-void text-void" : "border-stamp text-stamp"
      }`}
    >
      <p className="font-display text-3xl font-extrabold tracking-[0.12em] uppercase">{cancelled ? "Cancelled" : "Authorized"}</p>
      {!cancelled && heard && (
        <p className="max-w-[15rem] text-xs">
          “{heard}”{at ? ` · ${hms(at)}` : ""}
        </p>
      )}
    </div>
  );
}

// The signature element: a clearance slip. The code is only ever sent to this screen, never to the model.
export function Slip({ gate, progress, mic }: { gate: Gate | null; progress?: string; mic: RelayState["mic"] }) {
  const now = useNow(200);
  if (!gate) {
    return (
      <div className="grid min-h-44 place-content-center gap-2 rounded-md border border-dashed border-rule px-6 py-8 text-center">
        <p className="font-display text-3xl font-bold tracking-wide text-ink/80 uppercase">No change pending</p>
        <p className="mx-auto max-w-md text-sm text-muted">
          The agent investigates on its own. Any change to production stops here until you authorize it by voice.
        </p>
      </div>
    );
  }
  const [w1 = "", w2 = ""] = (gate.code ?? "").toUpperCase().split(" ");
  const left = gate.expiresAt ? Math.max(0, gate.expiresAt - now) : 0;
  const awaiting = gate.state === "awaiting";
  const expired = awaiting && left === 0;
  const stamped = gate.state === "approved" || gate.state === "executing" || gate.state === "done";
  return (
    <section
      key={gate.code}
      aria-live="polite"
      aria-label="Change authorization"
      className="relative animate-slip-in overflow-hidden rounded-[3px] bg-paper px-7 py-6 text-paper-ink shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)]"
    >
      <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.22em] uppercase">
        <span>{expired ? "Code expired" : GATE_TITLE[gate.state]}</span>
        {awaiting && !expired && <span className="font-mono tabular-nums">{Math.ceil(left / 1000)} s left</span>}
      </div>
      <p className={`mt-3 font-display text-[clamp(3.5rem,7.5vw,6.75rem)] leading-[0.9] font-extrabold tracking-tight uppercase ${expired ? "opacity-30" : ""}`}>
        {w1} <span aria-hidden className="text-paper-ink/35">·</span> {w2}
      </p>
      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t border-paper-ink/20 pt-4 text-[15px]">
        <dt className="text-paper-ink/60">Change</dt>
        <dd className="font-semibold">
          {ACTION[gate.action] ?? gate.action} {gate.service}
          {gate.change?.includes(" to ") ? ` · ${gate.change.replace(" to ", " → ")}` : ""}
        </dd>
        <dt className="text-paper-ink/60">Affects</dt>
        <dd>{gate.affected?.length ? gate.affected.join(", ") : "No dependent services"}</dd>
        {progress && !awaiting && (
          <>
            <dt className="text-paper-ink/60">Status</dt>
            <dd>{progress}</dd>
          </>
        )}
      </dl>
      {awaiting && !expired && (
        <div aria-hidden className="mt-5 h-1.5 bg-paper-ink/15">
          <div className="h-full bg-paper-ink transition-[width] duration-200 ease-linear" style={{ width: `${(left / 120000) * 100}%` }} />
        </div>
      )}
      <p className="mt-4 text-sm text-paper-ink/75">
        {expired
          ? "Nothing was changed. Ask the agent to propose the fix again for a new code."
          : mic === "blocked"
            ? "Your microphone is blocked. Allow it in the browser to authorize by voice."
            : mic === "off"
              ? "You’re watching without a microphone, so nobody can authorize this change. The agent cannot see this code."
              : "The agent cannot see this code. It is shown only on your screen."}
      </p>
      {stamped && <Stamp heard={gate.heard} at={gate.approvedAt} />}
      {gate.state === "rejected" && <Stamp cancelled />}
    </section>
  );
}

export function Resolution({ ttr, onOpen }: { ttr: number; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-healthy/40 bg-healthy/10 px-5 py-4">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-healthy uppercase">Incident resolved</p>
        <p className="font-display text-4xl font-extrabold">Recovered in {ttr} s</p>
      </div>
      <button type="button" className={BTN} onClick={onOpen}>
        View incident report
      </button>
    </div>
  );
}

export function ReportDialog({ report, dialog }: { report?: string; dialog: React.RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog
      ref={dialog}
      className="m-auto w-[min(56rem,92vw)] rounded-md border border-rule bg-panel p-0 text-ink backdrop:bg-black/70"
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">Incident report</h2>
        <button type="button" className={BTN_QUIET} onClick={() => dialog.current?.close()}>
          Close
        </button>
      </div>
      <pre className="max-h-[75vh] overflow-auto px-5 py-4 font-mono text-xs leading-5 whitespace-pre-wrap">{report}</pre>
    </dialog>
  );
}

export function ApiPanel({ events }: { events: ApiEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-rule">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-2 text-left text-[11px] font-semibold tracking-[0.18em] text-muted uppercase hover:text-ink"
      >
        <span>AssemblyAI Voice Agent API · {events.length} events</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="max-h-56 overflow-y-auto px-5 pb-3 font-mono text-xs">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="grid grid-cols-[5.5rem_1.25rem_13rem_1fr] gap-2 py-0.5">
              <span className="text-muted tabular-nums">{hms(e.at)}</span>
              <span className={e.dir === "out" ? "text-paper" : "text-agent"} title={e.dir === "out" ? "Sent by the relay" : "Received"}>
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
