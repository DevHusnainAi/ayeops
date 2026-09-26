"use client";

// One hook owns the relay connection: the WebSocket, mic capture, agent playback, and the dashboard state that the
// relay's events drive.
import { useCallback, useEffect, useReducer, useRef } from "react";

export type Status = "healthy" | "degraded" | "down" | "remediating";
export type Service = {
  status: Status;
  version: string;
  previous_version?: string | null;
  last_deploy?: string;
  error_rate?: number;
  p99_ms?: number;
  queue_depth?: number;
  container?: string;        // docker's own status line, e.g. "Up 2 minutes" / "Restarting (2) 4 seconds ago"
  container_name?: string;
  image?: string;
  port?: number | null;
};

// What the services actually are. The dashboard says this out loud either way: claiming real containers only
// means something if the simulated case is labelled just as plainly.
export type Infra = { mode: "sim" | "docker"; real: boolean; label: string; project?: string; fell_back?: boolean };
export type Phase = "starting" | "monitoring" | "triage" | "mitigation" | "resolved";
export type LinkState = "idle" | "connecting" | "connected" | "reconnecting" | "resumed" | "recovered" | "closed";
export type Evidence = { commit: string; message: string; files: string[]; diff: string; crash_line?: string };
export type Gate = {
  state: "awaiting" | "approved" | "rejected" | "executing" | "done";
  service: string;
  action: string;
  change?: string;
  affected?: string[];
  code?: string;
  evidence?: Evidence | null;
  heard?: string;
  expiresAt?: number;
  approvedAt?: number;
  result?: { status?: string };
  confidence?: { code_score: number; action_found: boolean; service_found: boolean; best_word_scores: Record<string, number> };
};
export type AgentRequest = {
  state: "pending" | "approved" | "denied" | "expired";
  agent: string;
  action: string;
  target: string;
  command: string;
  reason: string;
  code?: string;
  expiresAt?: number;
};
// The exact tool-result payload handed to the model for the pending proposal. Shown beside the operator's
// screen so the missing code is something a viewer reads, not something we assert.
export type ModelContext = { call: string; payload: Record<string, unknown>; code_words: number };
export type ApiEvent = { id: number; at: number; dir: "in" | "out"; type: string; detail: string };
export type LogLine = { id: number; service: string; line: string; level: string };
// F10a: the most recent past incident on a service, surfaced when a new one opens on the same service.
export type Precedent = { service: string; action: string; root_cause: string; mttr_s: number; resolved_at: number };
// Before/after health for each service the incident touched -- the receipt that the fix actually worked, not
// just that it ran.
export type RecoveryDelta = { error_rate_before: number; error_rate_after: number; p99_before: number; p99_after: number };
// Bring your own incident: a custom service name and error line the user provides before the session starts.
// null means "use the default scenario."
export type Fault = "deploy" | "wedge" | "spike";
// The three ways the demo cluster can fail. The right fix differs in each -- that is the point of having three.
export const FAULTS: { id: Fault; label: string; action: string; blurb: string }[] = [
  { id: "deploy", label: "Bad deploy", action: "Ship a bad deploy", blurb: "A release crash-loops auth-service. The fix is a rollback." },
  { id: "wedge", label: "Hung process", action: "Wedge auth-service", blurb: "auth-service hangs with nothing deployed. A rollback has nothing to undo; the fix is a restart." },
  { id: "spike", label: "Traffic spike", action: "Spike billing load", blurb: "billing-worker can't drain a surge. Restarting refills it; the fix is scaling out." },
];
export type CustomScenario = { service: string; errorLine?: string } | null;

// The unified Activity feed: every event an operator would want to see in one chronological order, instead of
// speech, tool calls, phase changes, authorization and alerts each fighting for their own panel.
export type FeedItem =
  | { id: number; at: number; kind: "speech"; who: "operator" | "agent"; text: string; interrupted?: boolean }
  | { id: number; at: number; kind: "tool"; text: string; callId?: string }
  | { id: number; at: number; kind: "phase"; phase: Phase }
  | { id: number; at: number; kind: "gate"; gate: Gate }
  | { id: number; at: number; kind: "agent_request"; req: AgentRequest }
  | { id: number; at: number; kind: "flag"; service: string; line: string }
  | { id: number; at: number; kind: "precedent"; precedent: Precedent }
  | { id: number; at: number; kind: "refusal"; service: string; requested: string; proposed: string; reason: string }
  | { id: number; at: number; kind: "attempt"; what: string; detail: string; rule: string }
  | { id: number; at: number; kind: "link"; text: string; tone: "warn" | "ok" | "error" };
// Plain Omit<Union, K> collapses to only the keys shared across every member; this distributes it per-variant.
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type RelayState = {
  started: boolean;
  link: LinkState;
  dropAt?: number;
  recovery?: { ms: number; kind: "resumed" | "recovered"; at: number };
  mic: "off" | "on" | "blocked";
  phase: Phase;
  incidentAt?: number;
  resolvedAt?: number;
  ttr?: number;
  services: Record<string, Service>;
  infra?: Infra;
  modelContext?: ModelContext | null;
  logs: LogLine[];
  feed: FeedItem[];
  live: { who: "operator" | "agent"; text: string } | null;
  gate: Gate | null;
  agentRequest?: AgentRequest | null;
  agentToken?: string;
  precedent?: Precedent | null;
  progress?: string;
  latency?: number;
  events: ApiEvent[];
  report?: string;
  deltas?: Record<string, RecoveryDelta>;
  sttChars: number; // running proof-of-work: characters AssemblyAI has actually transcribed this session
  error?: string;
  agentSpeaking: boolean;
  operatorSpeaking: boolean;
  rating?: "up" | "down" | null; // post-execution rating
  ptt: boolean; // hold-to-talk: the mic is heard only while a key or button is held (speakers, no headphones)
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ev = Record<string, any>;
type Action =
  | { kind: "start"; mic: RelayState["mic"] }
  | { kind: "link"; link: LinkState }
  | { kind: "event"; ev: Ev; at: number }
  | { kind: "rating"; rating: "up" | "down" }
  | { kind: "ptt"; on: boolean };

const initial: RelayState = {
  started: false, link: "idle", mic: "off", phase: "starting", services: {}, logs: [], feed: [], live: null,
  gate: null, events: [], agentSpeaking: false, operatorSpeaking: false, sttChars: 0, ptt: false,
};

const TOOL: Record<string, string> = {
  query_service_health: "Health check",
  tail_error_logs: "Log read",
  propose_remediation: "Proposal",
};

// Seeded from the clock, not 0: a dev hot-reload re-runs this module (resetting a plain counter) while the
// useReducer state that already holds old ids survives it, producing a collision like "two children with key 4".
// Seeding from Date.now() makes a fresh module instance's ids start far above anything already in state.
let seq = Date.now();
function last<T>(xs: T[], n: number) {
  return xs.length > n ? xs.slice(xs.length - n) : xs;
}
const clip = (s = "", n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const toolText = (name: string, args: Ev = {}) =>
  [TOOL[name] ?? name, args.service, args.action].filter(Boolean).join(" · ");

// Transcript text arrives as `text` or `delta` depending on the event; never assume either is present.
const textOf = (ev: Ev): string => String(ev.text ?? ev.delta ?? "");

// Events come from outside (AssemblyAI via the relay). One malformed event must not take the dashboard down.
function reduce(s: RelayState, a: Action): RelayState {
  try {
    return reduceUnsafe(s, a);
  } catch (err) {
    console.warn("Ignored an event the dashboard could not apply", a, err);
    return s;
  }
}

function reduceUnsafe(s: RelayState, a: Action): RelayState {
  if (a.kind === "start") return { ...s, started: true, mic: a.mic, link: "connecting" };
  if (a.kind === "link") return { ...s, link: a.link };
  if (a.kind === "rating") return { ...s, rating: a.rating };
  if (a.kind === "ptt") return { ...s, ptt: a.on };
  const { ev, at } = a;
  const t: string = ev.type;
  const api = (dir: "in" | "out", type: string, detail = "") =>
    last([...s.events, { id: ++seq, at, dir, type, detail }], 80);
  const feed = (item: DistOmit<FeedItem, "id" | "at">): FeedItem[] => last([...s.feed, { ...item, id: ++seq, at } as FeedItem], 300);

  switch (t) {
    case "infra.state":
      return { ...s, services: ev.services };
    case "relay.model_context":
      return { ...s, modelContext: { call: ev.call, payload: ev.payload, code_words: ev.code_words } };
    case "infra.mode":
      return { ...s, infra: { mode: ev.mode, real: ev.real, label: ev.label, project: ev.project, fell_back: ev.fell_back } };
    case "infra.log":
      return { ...s, logs: last([...s.logs, { id: ++seq, service: ev.service, level: ev.level, line: ev.line }], 300) };
    case "relay.phase":
      return {
        ...s,
        phase: ev.phase,
        // A guard of !s.incidentAt would only ever capture the first incident in a session -- a second one
        // (the relay now allows reopening from "resolved") needs its own clock, so key off the transition
        // into triage instead of whether one was ever recorded.
        incidentAt: ev.phase === "triage" && s.phase !== "triage" ? at : s.incidentAt,
        resolvedAt: ev.phase === "resolved" ? at : s.resolvedAt,
        // A precedent from the last incident must not linger into one that doesn't have its own -- cleared
        // here and re-set only if relay.precedent actually arrives for this one.
        precedent: ev.phase === "triage" && s.phase !== "triage" ? null : s.precedent,
        modelContext: ev.phase === "triage" && s.phase !== "triage" ? null : s.modelContext,
        feed: ev.phase === s.phase ? s.feed : feed({ kind: "phase", phase: ev.phase }),
      };
    case "relay.postmortem":
      return { ...s, report: ev.markdown, ttr: ev.time_to_recover_s, deltas: ev.recovery };
    case "relay.readback":
      return s.gate && s.gate.state === "awaiting" ? { ...s, gate: { ...s.gate, heard: ev.heard, confidence: ev.confidence } } : s;
    case "relay.gate": {
      let gate: Gate;
      if (ev.state === "awaiting") {
        gate = {
          state: "awaiting", service: ev.service, action: ev.action, change: ev.change, affected: ev.affected,
          code: ev.code, evidence: ev.evidence, expiresAt: at + (ev.ttl_s ?? 120) * 1000,
        };
      } else {
        const g = s.gate && s.gate.service === ev.service && s.gate.action === ev.action ? s.gate : null;
        const base: Gate = g ?? { state: ev.state, service: ev.service, action: ev.action };
        gate = { ...base, state: ev.state, heard: ev.heard ?? base.heard,
                approvedAt: ev.state === "approved" ? at : base.approvedAt, result: ev.result ?? base.result,
                confidence: ev.confidence ?? base.confidence };
      }
      const prior = [...s.feed].reverse().find((f) => f.kind === "gate") as (FeedItem & { kind: "gate" }) | undefined;
      const dup = prior && prior.gate.code === gate.code && prior.gate.state === gate.state;
      return { ...s, progress: ev.state === "awaiting" ? undefined : s.progress, gate, feed: dup ? s.feed : feed({ kind: "gate", gate }) };
    }
    case "relay.progress":
      return { ...s, progress: ev.text };
    case "relay.flag":
      return { ...s, feed: feed({ kind: "flag", service: ev.service, line: ev.line }) };
    case "relay.attempt":
      return { ...s, feed: feed({ kind: "attempt", what: ev.kind, detail: ev.detail, rule: ev.rule }) };
    case "relay.refusal":
      return { ...s, feed: feed({ kind: "refusal", service: ev.service, requested: ev.requested, proposed: ev.proposed, reason: ev.reason }) };
    case "relay.precedent": {
      const precedent: Precedent = {
        service: ev.service, action: ev.action, root_cause: ev.root_cause, mttr_s: ev.mttr_s, resolved_at: ev.resolved_at,
      };
      return { ...s, precedent, feed: feed({ kind: "precedent", precedent }) };
    }
    case "relay.agent_request": {
      const agentRequest: AgentRequest =
        ev.state === "pending"
          ? { state: "pending", agent: ev.agent, action: ev.action, target: ev.target, command: ev.command,
              reason: ev.reason, code: ev.code, expiresAt: at + (ev.ttl_s ?? 120) * 1000 }
          : s.agentRequest
            ? { ...s.agentRequest, state: ev.state }
            : { state: ev.state, agent: "", action: "", target: "", command: "", reason: "" };
      const prior = [...s.feed].reverse().find((f) => f.kind === "agent_request") as (FeedItem & { kind: "agent_request" }) | undefined;
      const dup = prior && prior.req.code === agentRequest.code && prior.req.state === agentRequest.state;
      return { ...s, agentRequest, feed: dup ? s.feed : feed({ kind: "agent_request", req: agentRequest }) };
    }
    case "relay.tool":
      if (ev.status === "running") {
        return { ...s, feed: feed({ kind: "tool", text: toolText(ev.name, ev.arguments), callId: ev.call_id }) };
      }
      return {
        ...s,
        feed: s.feed.map((f) =>
          f.kind === "tool" && f.callId === ev.call_id
            ? { ...f, text: `${f.text} · ${ev.result?.error ? "error" : ev.result?.status ?? "ok"} · ${ev.ms} ms` }
            : f,
        ),
      };
    case "relay.metrics":
      return { ...s, latency: ev.turn_latency_ms };
    case "relay.status": {
      const link = ev.upstream as LinkState;
      if (link === "reconnecting") return { ...s, link, dropAt: s.dropAt ?? at, feed: feed({ kind: "link", text: "Voice link lost — reconnecting", tone: "warn" }) };
      const recovery =
        s.dropAt && (link === "resumed" || link === "recovered") ? { ms: at - s.dropAt, kind: link, at } : s.recovery;
      const note = recovery && recovery.at === at
        ? feed({ kind: "link", text: `Voice link restored in ${(recovery.ms / 1000).toFixed(1)}s (${recovery.kind})`, tone: "ok" })
        : s.feed;
      return { ...s, link, dropAt: undefined, recovery, feed: note };
    }
    case "relay.connect":
      return { ...s, agentToken: ev.agent_token };
    case "relay.echo":
      return { ...s, feed: feed({ kind: "link", text: "The microphone is hearing the agent's voice through your speakers. Hold Space, or the Talk button, to speak — or use headphones.", tone: "warn" }) };
    case "relay.notice":
      return { ...s, feed: feed({ kind: "link", text: ev.message, tone: "warn" }) };
    case "relay.error":
      return { ...s, error: ev.message, feed: feed({ kind: "link", text: `Session stopped: ${ev.message}`, tone: "error" }) };
    case "relay.sent":
      return { ...s, events: api("out", ev.message, ev.detail) };

    case "transcript.user.delta":
      return { ...s, live: { who: "operator", text: textOf(ev) } };
    case "transcript.agent.delta": {
      // Agent deltas are single words in `delta` (with start_ms/end_ms), unlike the user's cumulative `text`.
      // Join words with spaces; if a delta ever arrives cumulative, it simply replaces the caption.
      const prev = s.live?.who === "agent" ? s.live.text : "";
      const d = textOf(ev).trim();
      return { ...s, live: { who: "agent", text: d.startsWith(prev) ? d : `${prev} ${d}`.trim() } };
    }
    case "transcript.user":
      return {
        ...s, live: null, events: api("in", t, clip(textOf(ev))), sttChars: s.sttChars + textOf(ev).length,
        feed: feed({ kind: "speech", who: "operator", text: textOf(ev) }),
      };
    case "transcript.agent":
      return {
        ...s, live: null, events: api("in", t, clip(textOf(ev))), sttChars: s.sttChars + textOf(ev).length,
        feed: feed({ kind: "speech", who: "agent", text: textOf(ev).trim(), interrupted: ev.interrupted }),
      };
    case "input.speech.started":
      return { ...s, operatorSpeaking: true, events: api("in", t) };
    case "input.speech.stopped":
      return { ...s, operatorSpeaking: false, events: api("in", t) };
    case "reply.started":
      return { ...s, agentSpeaking: true, events: api("in", t) };
    case "reply.done":
      return { ...s, agentSpeaking: false, events: api("in", t, ev.status) };
    case "tool.call":
      return { ...s, events: api("in", t, `${ev.name} ${JSON.stringify(ev.arguments ?? {})}`) };
    case "session.ready":
      return { ...s, events: api("in", t, ev.session_id) };
    case "session.error":
      return { ...s, events: api("in", t, `${ev.code}: ${ev.message}`) };
    default:
      return t.startsWith("infra.") || t.startsWith("relay.") ? s : { ...s, events: api("in", t) };
  }
}

function relayUrl() {
  return process.env.NEXT_PUBLIC_RELAY_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

type Audio = {
  ws?: WebSocket;
  ctx?: AudioContext; // mic capture, native rate -- pcm-worklet.js resamples it, deliberately not this context
  playCtx?: AudioContext; // agent playback, pinned to 24kHz to match the PCM exactly
  out?: GainNode;
  analyser?: AnalyserNode;
  stream?: MediaStream;
  sources: Set<AudioBufferSourceNode>;
  playhead: number;
  micLevel: number;
  ptt?: boolean; // mirrors state.ptt for the audio callback
  talkUntil?: number; // performance.now() until which mic frames still go out after a release
  wave?: Float32Array<ArrayBuffer>;
  opened: boolean; // F10e: did the WS ever actually open -- distinguishes "never reached the relay" from a drop
};

export function useRelay() {
  const [state, dispatch] = useReducer(reduce, initial);
  const a = useRef<Audio>({ sources: new Set(), playhead: 0, micLevel: 0, opened: false });

  const flush = useCallback(() => {
    // Barge-in: drop queued agent audio so the operator never hears stale speech.
    const r = a.current;
    r.sources.forEach((src) => src.stop());
    r.sources.clear();
    r.playhead = 0;
  }, []);

  const play = useCallback((b64: string) => {
    const r = a.current;
    if (!r.playCtx || !r.out) return;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    // playCtx runs at 24000Hz, matching this buffer exactly -- no implicit per-chunk resampling. Without that
    // match, each of these small buffers gets resampled independently by the browser with no phase continuity
    // across chunk boundaries, which is what streamed clicks/graininess in Web Audio almost always trace to.
    const buf = r.playCtx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = r.playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(r.out);
    const at = Math.max(r.playCtx.currentTime + 0.03, r.playhead); // back to back; the small lead absorbs jitter
    src.start(at);
    r.playhead = at + buf.duration;
    r.sources.add(src);
    src.onended = () => r.sources.delete(src);
  }, []);

  const start = useCallback(async (withMic: boolean, autopilot = false, scenario: CustomScenario = null, fault: Fault = "deploy") => {
    const r = a.current;
    if (r.ws) return;
    // Two contexts, both created on this click so autoplay rules allow both: ctx captures the mic at the
    // device's native rate (pcm-worklet.js resamples it -- forcing this context to 24000Hz breaks echo
    // cancellation on Firefox/Safari, per AssemblyAI's troubleshooting guide). playCtx exists purely to play
    // the agent's 24kHz PCM back with no resampling at all.
    const ctx = new AudioContext();
    const playCtx = new AudioContext({ sampleRate: 24000 });
    r.ctx = ctx;
    r.playCtx = playCtx;
    r.out = playCtx.createGain();
    r.analyser = playCtx.createAnalyser();
    r.analyser.fftSize = 1024;
    r.out.connect(r.analyser);
    r.analyser.connect(playCtx.destination);

    // Without a mic (declined, blocked, or chosen) the page runs in watch mode: the incident still runs and the
    // agent still talks, but nobody can authorize by voice.
    let mic: RelayState["mic"] = "off";
    if (withMic) {
      mic = "blocked";
      try {
        r.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
        });
        await ctx.audioWorklet.addModule("/pcm-worklet.js");
        const node = new AudioWorkletNode(ctx, "pcm24k-capture");
        ctx.createMediaStreamSource(r.stream).connect(node);
        node.connect(ctx.destination); // the processor writes no output; connecting just keeps it running
        node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
          r.micLevel = e.data.level;
          // Hold-to-talk: only while held, plus a beat after release so the server's turn detection sees the pause.
          if (r.ptt && performance.now() > (r.talkUntil ?? 0)) return;
          if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(e.data.pcm);
        };
        mic = "on";
      } catch {
        // stays "blocked"
      }
    }
    dispatch({ kind: "start", mic });
    // A blocked or missing microphone must not strand a judge on a proposal nobody can authorize: the demo plays the
    // operator's part instead, and says so.
    const handsFree = autopilot || (withMic && mic === "blocked");
    if (handsFree && !autopilot) {
      dispatch({ kind: "event", ev: { type: "relay.notice", message: "No microphone available, so the demo is playing the operator's part for you." }, at: Date.now() });
    }

    const ws = new WebSocket(relayUrl());
    r.ws = ws;
    // ponytail: autopilot's synthesized readback plays through the same channel as the agent's voice rather than
    // a dedicated operator-synth graph -- fine since nothing else is ever "speaking" in an unattended run.
    if (handsFree) ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "demo.autopilot" })), { once: true });
    if (scenario) ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "relay.scenario", service: scenario.service, errorLine: scenario.errorLine })), { once: true });
    else ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "relay.incident", fault })), { once: true });
    ws.onopen = () => {
      r.opened = true;
    };
    ws.onerror = () => {
      // A refused/unreachable connection fires error then close with no other signal at all -- distinguish it
      // from a normal drop (which the existing "reconnecting"/"closed" states already explain) so the operator
      // isn't left staring at "Connecting" forever with no idea why.
      if (!r.opened) {
        dispatch({
          kind: "event",
          ev: { type: "relay.error", message: `Can't reach the relay at ${relayUrl()}. Check that it's running and reachable.` },
          at: Date.now(),
        });
      }
    };
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "reply.audio" || ev.type === "autopilot.audio") return play(ev.data);
      // The relay saw the agent's own voice come back through the microphone: switch to hold-to-talk.
      if (ev.type === "relay.echo") { r.ptt = true; dispatch({ kind: "ptt", on: true }); }
      if (ev.type === "input.speech.started" || (ev.type === "reply.done" && ev.status === "interrupted")) flush();
      dispatch({ kind: "event", ev, at: Date.now() });
    };
    ws.onclose = () => dispatch({ kind: "link", link: "closed" });
  }, [play, flush]);

  useEffect(
    () => () => {
      const r = a.current;
      r.ws?.close();
      r.stream?.getTracks().forEach((t) => t.stop());
      r.ctx?.close();
      r.playCtx?.close();
    },
    [],
  );

  const levels = useCallback(() => {
    const r = a.current;
    let agent = 0;
    if (r.analyser) {
      const w = (r.wave ??= new Float32Array(r.analyser.fftSize));
      r.analyser.getFloatTimeDomainData(w);
      for (const v of w) agent = Math.max(agent, Math.abs(v));
    }
    return { operator: r.micLevel, agent };
  }, []);

  const control = useCallback(
    (type: "demo.fault" | "demo.drop" | "demo.inject", extra: { fault?: Fault; text?: string } = {}) => {
      const ws = a.current.ws;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...extra }));
    },
    [],
  );

  // Post-execution rating — store locally and POST to backend.
  const setRating = useCallback(async (sessionId: string, rating: "up" | "down") => {
    dispatch({ kind: "rating", rating });
    try {
      await fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, rating }),
      });
    } catch { /* best effort */ }
  }, []);

  return {
    state,
    start,
    levels,
    setPtt: (on: boolean) => { a.current.ptt = on; a.current.talkUntil = 0; dispatch({ kind: "ptt", on }); },
    // Holding the talk key/button: the mic goes live, and the agent is cut off at once (barge-in).
    hold: (down: boolean) => {
      const r = a.current;
      if (down) { r.talkUntil = Number.MAX_SAFE_INTEGER; flush(); } else { r.talkUntil = performance.now() + 900; }
    },
    injectFault: (fault: Fault) => control("demo.fault", { fault }),
    cutLink: () => control("demo.drop"),
    injectPrompt: (text?: string) => control("demo.inject", { text }),
    setRating,
  };
}
