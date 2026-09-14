"use client";

// One hook owns the relay connection: the WebSocket, mic capture, agent playback, and the dashboard state that the
// relay's events drive. The browser protocol is specified in session-handoff.md section 11.
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
  container?: string;
};
export type Phase = "starting" | "monitoring" | "triage" | "mitigation" | "resolved";
export type LinkState = "idle" | "connecting" | "connected" | "reconnecting" | "resumed" | "recovered" | "closed";
export type Line = { id: number; who: "operator" | "agent" | "tool"; text: string; callId?: string; interrupted?: boolean };
export type Gate = {
  state: "awaiting" | "approved" | "rejected" | "executing" | "done";
  service: string;
  action: string;
  change?: string;
  affected?: string[];
  code?: string;
  heard?: string;
  expiresAt?: number;
  approvedAt?: number;
  result?: { status?: string };
};
export type ApiEvent = { id: number; at: number; dir: "in" | "out"; type: string; detail: string };
export type LogLine = { id: number; service: string; level: string; line: string };

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
  logs: LogLine[];
  lines: Line[];
  live: { who: "operator" | "agent"; text: string } | null;
  gate: Gate | null;
  progress?: string;
  latency?: number;
  events: ApiEvent[];
  report?: string;
  error?: string;
  agentSpeaking: boolean;
  operatorSpeaking: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ev = Record<string, any>;
type Action =
  | { kind: "start"; mic: RelayState["mic"] }
  | { kind: "link"; link: LinkState }
  | { kind: "event"; ev: Ev; at: number };

const initial: RelayState = {
  started: false, link: "idle", mic: "off", phase: "starting", services: {}, logs: [], lines: [], live: null,
  gate: null, events: [], agentSpeaking: false, operatorSpeaking: false,
};

const TOOL: Record<string, string> = {
  query_service_health: "Health check",
  tail_error_logs: "Log read",
  propose_remediation: "Proposal",
};

let seq = 0;
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
  const { ev, at } = a;
  const t: string = ev.type;
  const api = (dir: "in" | "out", type: string, detail = "") =>
    last([...s.events, { id: ++seq, at, dir, type, detail }], 80);

  switch (t) {
    case "infra.state":
      return { ...s, services: ev.services };
    case "infra.log":
      return { ...s, logs: last([...s.logs, { id: ++seq, service: ev.service, level: ev.level, line: ev.line }], 300) };
    case "relay.phase":
      return {
        ...s,
        phase: ev.phase,
        incidentAt: ev.phase === "triage" && !s.incidentAt ? at : s.incidentAt,
        resolvedAt: ev.phase === "resolved" ? at : s.resolvedAt,
      };
    case "relay.postmortem":
      return { ...s, report: ev.markdown, ttr: ev.time_to_recover_s };
    case "relay.gate": {
      if (ev.state === "awaiting") {
        return {
          ...s,
          progress: undefined,
          gate: {
            state: "awaiting", service: ev.service, action: ev.action, change: ev.change, affected: ev.affected,
            code: ev.code, expiresAt: at + (ev.ttl_s ?? 120) * 1000,
          },
        };
      }
      const g = s.gate && s.gate.service === ev.service && s.gate.action === ev.action ? s.gate : null;
      const base: Gate = g ?? { state: ev.state, service: ev.service, action: ev.action };
      return {
        ...s,
        gate: {
          ...base,
          state: ev.state,
          heard: ev.heard ?? base.heard,
          approvedAt: ev.state === "approved" ? at : base.approvedAt,
          result: ev.result ?? base.result,
        },
      };
    }
    case "relay.progress":
      return { ...s, progress: ev.text };
    case "relay.tool":
      if (ev.status === "running") {
        return { ...s, lines: last([...s.lines, { id: ++seq, who: "tool", text: toolText(ev.name, ev.arguments), callId: ev.call_id }], 80) };
      }
      return {
        ...s,
        lines: s.lines.map((l) =>
          l.callId === ev.call_id
            ? { ...l, text: `${l.text} · ${ev.result?.error ? "error" : ev.result?.status ?? "ok"} · ${ev.ms} ms` }
            : l,
        ),
      };
    case "relay.metrics":
      return { ...s, latency: ev.turn_latency_ms };
    case "relay.status": {
      const link = ev.upstream as LinkState;
      if (link === "reconnecting") return { ...s, link, dropAt: s.dropAt ?? at };
      const recovery =
        s.dropAt && (link === "resumed" || link === "recovered") ? { ms: at - s.dropAt, kind: link, at } : s.recovery;
      return { ...s, link, dropAt: undefined, recovery };
    }
    case "relay.error":
      return { ...s, error: ev.message };
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
        ...s, live: null, events: api("in", t, clip(textOf(ev))),
        lines: last([...s.lines, { id: ++seq, who: "operator", text: textOf(ev) }], 80),
      };
    case "transcript.agent":
      return {
        ...s, live: null, events: api("in", t, clip(textOf(ev))),
        lines: last([...s.lines, { id: ++seq, who: "agent", text: textOf(ev).trim(), interrupted: ev.interrupted }], 80),
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
  ctx?: AudioContext;
  out?: GainNode;
  analyser?: AnalyserNode;
  stream?: MediaStream;
  sources: Set<AudioBufferSourceNode>;
  playhead: number;
  micLevel: number;
  wave?: Float32Array<ArrayBuffer>;
};

export function useRelay() {
  const [state, dispatch] = useReducer(reduce, initial);
  const a = useRef<Audio>({ sources: new Set(), playhead: 0, micLevel: 0 });

  const flush = useCallback(() => {
    // Barge-in: drop queued agent audio so the operator never hears stale speech.
    const r = a.current;
    r.sources.forEach((src) => src.stop());
    r.sources.clear();
    r.playhead = 0;
  }, []);

  const play = useCallback((b64: string) => {
    const r = a.current;
    if (!r.ctx || !r.out) return;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    const buf = r.ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = r.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(r.out);
    const at = Math.max(r.ctx.currentTime + 0.03, r.playhead); // back to back; the small lead absorbs jitter
    src.start(at);
    r.playhead = at + buf.duration;
    r.sources.add(src);
    src.onended = () => r.sources.delete(src);
  }, []);

  const start = useCallback(async (withMic: boolean) => {
    const r = a.current;
    if (r.ws) return;
    const ctx = new AudioContext(); // created on the click, so autoplay rules allow playback
    r.ctx = ctx;
    r.out = ctx.createGain();
    r.analyser = ctx.createAnalyser();
    r.analyser.fftSize = 1024;
    r.out.connect(r.analyser);
    r.analyser.connect(ctx.destination);

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
          if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(e.data.pcm);
        };
        mic = "on";
      } catch {
        // stays "blocked"
      }
    }
    dispatch({ kind: "start", mic });

    const ws = new WebSocket(relayUrl());
    r.ws = ws;
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === "reply.audio") return play(ev.data);
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

  const control = useCallback((type: "demo.fault" | "demo.drop") => a.current.ws?.send(JSON.stringify({ type })), []);

  return {
    state,
    start,
    levels,
    shipBadDeploy: () => control("demo.fault"),
    cutLink: () => control("demo.drop"),
  };
}
