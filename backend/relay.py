"""IncidentVoice relay: browser mic <-> FastAPI <-> AssemblyAI Voice Agent API.

Browser protocol (ws://host:8000/ws):
  browser -> relay : binary frames of raw PCM16 LE, 24 kHz mono (~50 ms each), plus two demo controls:
                     {"type":"demo.fault"} ships the bad deploy; {"type":"demo.drop"} cuts the AssemblyAI link to
                     show session.resume. Nothing else is accepted, so a page can't rewrite the prompt or forge
                     tool results or authorizations.
  relay -> browser : every AssemblyAI event verbatim (reply.audio, transcript.*, tool.call, reply.done ...)
                     plus relay events: infra.state, infra.log, relay.phase, relay.tool, relay.gate (carries the
                     authorization code for the operator's screen), relay.progress, relay.metrics,
                     relay.postmortem, relay.status, relay.error.
INFRA=docker gives each session its own real container cluster; INFRA=sim (default) an in-memory one.
The API key never leaves this process, and the authorization code never reaches the model.
"""
import asyncio
import base64
import contextlib
import json
import logging
import os
import re
import secrets
import time
import urllib.request
from array import array
from pathlib import Path

import uvicorn
import websockets
from fastapi import FastAPI, WebSocket
from websockets.exceptions import ConnectionClosed, ConnectionClosedError

from cluster import ACTIONS, DEPENDENTS, SERVICES, DockerCluster, SimCluster, level

AAI_URL = os.environ.get("AAI_URL", "wss://agents.assemblyai.com/v1/ws")
SESSIONS_URL = AAI_URL.replace("wss://", "https://").removesuffix("/ws") + "/sessions"
API_KEY = os.environ["ASSEMBLYAI_API_KEY"]
INFRA = os.environ.get("INFRA", "sim")
ALLOWED_ORIGINS = set(os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(","))
MAX_SESSION_S = int(os.environ.get("MAX_SESSION_S", "900"))  # caps spend if the public demo is left open
INCIDENT_DIR = Path(os.environ.get("INCIDENT_DIR", Path(__file__).parent / "incidents"))
RESUME_WINDOW_S = 30  # server keeps a dropped session this long
MAX_AUDIO_FRAME = 48_000  # 1 s of PCM16 @ 24 kHz; anything bigger isn't a mic chunk
VOICE_PEAK = 2000  # |sample| above this counts as operator voice for the latency counter; tune for the demo mic
GATE_TTL_S = 120

log = logging.getLogger("relay")

# Two-stage gate. Stage 1: the model can only *propose* a change. Stage 2: the operator authorizes by reading a
# one-time code that is shown on their screen and never sent to the model, so neither a hallucinated "yes" nor the
# agent's own voice echoing through the mic can approve anything. The relay then runs exactly the authorized
# change: the model never holds the trigger.
CODE_WORDS = ["alpha", "bravo", "charlie", "delta", "foxtrot", "golf", "hotel", "kilo",
              "lima", "mike", "oscar", "papa", "romeo", "sierra", "tango", "victor"]
VETO = re.compile(r"\b(no|nope|cancel|abort|stop|don['’]?t|do not|wait|hold)\b", re.I)
FIX = re.compile(r"\b(roll(ing)?[\s-]?back|restart|scal(e|ing) up)", re.I)
MAX_NUDGES = 2

# All tools use hold mode: they return in ~100 ms, and interactive filler ("let me check...") only delays results,
# which can't be delivered until the filler finishes. timeout_seconds covers that wait too.
TOOLS = [
    {
        "type": "function",
        "name": "query_service_health",
        "description": "Read-only. Live health of production services: status, error rate, p99 latency, "
        "running version, previous version, last deploy, plus the latest error lines for any unhealthy service. "
        "Call this first whenever a page arrives or the operator asks what is wrong or for status.",
        "parameters": {
            "type": "object",
            "properties": {"service": {"type": "string", "enum": SERVICES + ["all"]}},
            "required": ["service"],
        },
        "execution_mode": "hold",
        "timeout_seconds": 60,
    },
    {
        "type": "function",
        "name": "tail_error_logs",
        "description": "Read-only. Most recent log lines for one service, for when the cause is still unclear.",
        "parameters": {
            "type": "object",
            "properties": {
                "service": {"type": "string", "enum": SERVICES},
                "lines": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["service"],
        },
        "execution_mode": "hold",
        "timeout_seconds": 60,
    },
    {
        "type": "function",
        # Named "propose", not "execute": models hesitate to call an execute tool before hearing a yes, which
        # made them describe the fix and wait instead of entering the consent flow.
        "name": "propose_remediation",
        "description": "Propose one production change for the operator to authorize. Always safe: it changes "
        "nothing. The operator authorizes by reading a code from their screen; the system then runs exactly this "
        "change and reports progress and the outcome to you. Call it in the same turn you state the root cause. "
        "scale_up only applies to billing-worker.",
        "parameters": {
            "type": "object",
            "properties": {
                "service": {"type": "string", "enum": SERVICES},
                "action": {"type": "string", "enum": ACTIONS},
            },
            "required": ["service", "action"],
        },
        "execution_mode": "hold",
        "timeout_seconds": 60,
    },
]

SYSTEM_PROMPT = """You are IncidentVoice, the incident commander for production, talking to the on-call engineer over voice.
Be calm, terse and decisive: one short sentence per turn, two at most. Plain speech, no lists or markdown.
Never read out version numbers, IDs or exact figures unless asked; say "the last deploy" or "almost every request failing".
Never guess system state; every claim comes from a tool result.
When you page the operator, start triage at once: call query_service_health for all services; it includes recent errors, so use tail_error_logs only if the cause is still unclear.
Then, in one turn, state the root cause in one sentence and call propose_remediation with the single best fix. Proposing is always safe, so never describe or ask about a fix without calling propose_remediation in that same turn.
You cannot execute changes. When a proposal comes back, ask the operator in under fifteen words to read the authorization code on their screen. You never know the code; never guess or repeat one.
The system, not you, checks codes: when the operator reads one out, say only "Verifying." and nothing else. The system then runs the change and sends you progress and the outcome to relay in one short sentence each.
If the operator says stop, cancel or no, acknowledge and drop the proposal."""

RESOLVED_PROMPT = """
The incident is resolved and a postmortem with the voice authorization record has been filed.
If asked what happened, answer in two or three sentences from this verified timeline, nothing else:
"""

REBRIEF_PROMPT = """
The connection dropped and this is a new session in the middle of an incident. Don't greet again; continue from
this verified timeline (any proposal still awaits the operator's code):
"""

SESSION_UPDATE = {
    "type": "session.update",
    "session": {
        "system_prompt": SYSTEM_PROMPT,
        "greeting": "IncidentVoice online and watching production. I'll page you the moment anything breaks.",
        "tools": TOOLS,
        "input": {
            # Service names plus every authorization code word, so codes transcribe reliably.
            "keyterms": SERVICES + ["rollback", "roll back", "triage", "crash loop", "JWKS", "postmortem",
                                    "authorize"] + CODE_WORDS,
        },
        "output": {"voice": "alba"},
    },
}

BACKGROUND = set()  # evidence downloads outlive their session


def hms(ts):
    return time.strftime("%H:%M:%S", time.localtime(ts))


def fetch(url, auth=False):  # pre-signed artifact URLs must not see our key
    req = urllib.request.Request(url, headers={"Authorization": API_KEY} if auth else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


async def save_evidence(session_id):
    """Store AssemblyAI's two-channel recording and turn timeline next to the postmortem."""
    for _ in range(12):
        await asyncio.sleep(5)  # artifacts appear shortly after session end
        try:
            meta = json.loads(await asyncio.to_thread(fetch, f"{SESSIONS_URL}/{session_id}", True))
            urls = {a["type"]: a["url"] for a in meta.get("artifacts", [])}
            if {"audio", "timeline"} <= urls.keys():
                for kind, ext in (("audio", "ogg"), ("timeline", "json")):
                    data = await asyncio.to_thread(fetch, urls[kind])
                    (INCIDENT_DIR / f"{session_id}.{ext}").write_bytes(data)
                log.info("evidence saved for %s", session_id)
                return
        except Exception as e:
            log.info("evidence for %s not ready yet (%r)", session_id, e)
    log.warning("gave up fetching evidence for %s", session_id)


class Session:
    """One browser tab = one AssemblyAI session and one isolated cluster."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.cluster = DockerCluster() if INFRA == "docker" else SimCluster()
        self.up = None  # current AssemblyAI connection; replaced on reconnect
        self.session_id = None
        self.resume_token = None  # signed credential from session.ready
        self.resuming = False  # the current connection opened with session.resume
        self.session_ready = False
        self.ended = False
        self.dropped_at = None
        self.last_turn_event = None  # reply.create only goes out while this is "reply.done"
        self.expect_reply = False  # we just triggered a reply; don't stack a reply.create on top of it
        self.ready_results = []  # tool.result messages waiting for an idle moment
        self.live_calls = set()  # call_ids whose results the agent still wants
        self.say_queue = []  # reply.create instructions that must be spoken (pages, outcomes, nudges)
        self.progress_note = None  # latest rollout progress, spoken if the agent frees up mid-rollout
        self.tasks = set()
        self.pending = None  # proposal awaiting its authorization code
        self.executing = False
        self.nudges = 0
        self.reply_had_tool = False
        self.agent_said = ""  # text of the reply in progress, for the named-fix watchdog
        self.last_voice_at = 0.0  # last mic frame loud enough to be speech
        self.turn_voice_end = None  # end of the operator's voice for the turn being answered
        self.turn_latency_ms = None  # reported once the reply completes
        self.agent_speaking = False
        self.phase = "starting"  # starting -> monitoring -> triage -> mitigation -> resolved
        self.incident_at = None
        self.timeline = []  # (epoch, kind, text): the audit trail behind the postmortem

    # ---- plumbing ----

    def spawn(self, coro):
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self._reap)

    def _reap(self, task):
        self.tasks.discard(task)
        if not task.cancelled() and task.exception():
            log.error("task failed", exc_info=task.exception())

    def mark(self, kind, text):
        self.timeline.append((time.time(), kind, " ".join(text.split())))

    async def emit(self, event):
        await self.ws.send_text(json.dumps(event))

    async def send_up(self, msg):
        if self.up:
            with contextlib.suppress(ConnectionClosed):
                await self.up.send(json.dumps(msg))

    async def set_phase(self, phase):
        self.phase = phase
        await self.emit({"type": "relay.phase", "phase": phase})

    def idle(self, during_tool=False):
        return (self.session_ready and self.last_turn_event == "reply.done" and not self.expect_reply
                and (during_tool or not self.live_calls))

    async def say(self, instructions):
        self.say_queue.append(instructions)
        await self.flush_say()

    async def flush_say(self):
        if self.say_queue and self.idle():
            self.expect_reply = True
            await self.send_up({"type": "reply.create", "instructions": self.say_queue.pop(0)})

    async def narrate(self, progress):
        """Rollout progress from the cluster. Only the latest note is kept, and it's dropped once the rollout ends."""
        self.mark("progress", progress)
        await self.emit({"type": "relay.progress", "text": progress})
        self.progress_note = progress
        await self.flush_progress()

    async def flush_progress(self):
        if self.progress_note and self.idle(during_tool=True):
            note, self.progress_note = self.progress_note, None
            self.expect_reply = True
            await self.send_up({"type": "reply.create", "instructions": f"In under eight words, tell the operator: {note}."})

    # ---- browser side ----

    async def pump_browser(self):
        while True:
            msg = await self.ws.receive()
            if msg["type"] == "websocket.disconnect":
                return
            if msg.get("text"):
                await self.on_control(msg["text"])
                continue
            pcm = msg.get("bytes")
            # Audio before session.ready is discarded upstream anyway; don't spend bandwidth on it.
            if not pcm or len(pcm) % 2 or len(pcm) > MAX_AUDIO_FRAME or not self.session_ready:
                continue
            samples = array("h", pcm)
            if max(samples) > VOICE_PEAK or min(samples) < -VOICE_PEAK:
                self.last_voice_at = time.perf_counter()
            with contextlib.suppress(ConnectionClosed):  # pump_upstream owns reconnection
                await self.up.send(json.dumps({"type": "input.audio", "audio": base64.b64encode(pcm).decode()}))

    async def on_control(self, text):
        with contextlib.suppress(ValueError, AttributeError):
            kind = json.loads(text[:200]).get("type")
            if kind == "demo.fault" and self.phase == "monitoring":
                self.spawn(self.cluster.inject_fault())
            elif kind == "demo.drop" and self.up:
                self.mark("link", "AssemblyAI connection cut (demo)")
                self.up.transport.abort()  # abnormal drop: pump_upstream resumes the same session

    # ---- incident lifecycle (driven by cluster health polls) ----

    async def on_log(self, service, level, line):
        await self.emit({"type": "infra.log", "service": service, "level": level, "line": line})

    async def on_state(self, services):
        await self.emit({"type": "infra.state", "services": services})
        statuses = {s: v["status"] for s, v in services.items()}
        broken = [s for s, st in statuses.items() if st in ("down", "degraded")]
        all_green = all(st == "healthy" for st in statuses.values())
        if self.phase == "starting" and all_green:
            await self.set_phase("monitoring")
        elif self.phase == "monitoring" and broken:
            await self.open_incident(services, broken)
        elif self.phase in ("triage", "mitigation") and all_green and not self.executing:
            await self.resolve()

    async def open_incident(self, services, broken):
        self.incident_at = time.time()
        await self.set_phase("triage")
        summary = ", ".join(f"{s} {services[s]['status']}" for s in broken)
        lead = next((s for s in broken if services[s]["status"] == "down"), broken[0])
        others = [s for s in broken if s != lead]
        page = f"{lead} is {services[lead]['status']}, last deployed {services[lead]['last_deploy']}" + \
            (f"; {' and '.join(others)} degraded" if others else "")
        self.mark("fault", summary)
        self.mark("page", page)
        # The agent speaks first and starts read-only triage on its own; only changes wait for the operator.
        await self.say(f"Page the operator in one short sentence: {page}. Then start triage right away.")

    async def resolve(self):
        mttr = round(time.time() - self.incident_at)
        self.mark("resolved", f"all services healthy {mttr} s after detection")
        await self.set_phase("resolved")
        report = self.postmortem(mttr)
        INCIDENT_DIR.mkdir(parents=True, exist_ok=True)
        path = INCIDENT_DIR / f"{self.session_id or 'offline'}.md"
        path.write_text(report)
        await self.emit({"type": "relay.postmortem", "time_to_recover_s": mttr, "path": str(path), "markdown": report})
        # Mid-session session.update: from here the agent answers "what happened?" from the verified record.
        await self.send_up({"type": "session.update",
                            "session": {"system_prompt": SYSTEM_PROMPT + RESOLVED_PROMPT + self.timeline_text()}})
        await self.say("In one short sentence, tell the operator the postmortem with the voice authorization record is filed.")

    def timeline_text(self):
        return "\n".join(f"{hms(ts)} {kind}: {text}" for ts, kind, text in self.timeline
                         if kind not in ("operator", "agent"))[-4000:]

    def postmortem(self, mttr):
        changes = [text for _, kind, text in self.timeline if kind == "change"]
        rows = [f"| {hms(ts)} | {kind} | {text.replace('|', '/')} |" for ts, kind, text in self.timeline]
        return "\n".join([
            f"# Incident report {self.session_id}", "",
            f"- **Detected** {hms(self.incident_at)}, **recovered** {hms(time.time())}, **time to recover** {mttr} s",
            *(f"- **Voice-authorized change:** {c}" for c in changes),
            f"- **Evidence:** AssemblyAI session `{self.session_id}`; the two-channel recording (operator left, "
            "agent right) and the turn timeline are saved next to this file.",
            "", "## Timeline", "", "| time | event | detail |", "|---|---|---|", *rows, ""])

    # ---- AssemblyAI side ----

    async def pump_upstream(self):
        delay = 0.25
        while True:
            try:
                async with websockets.connect(
                    AAI_URL,
                    additional_headers={"Authorization": f"Bearer {API_KEY}"},
                    compression=None,  # base64 PCM barely compresses; deflate only adds latency
                    ping_interval=5, ping_timeout=5,  # detect a dead link in <=10 s, leaving 20 s to resume
                    open_timeout=5, close_timeout=2,
                ) as up:
                    self.up, self.resuming = up, bool(self.session_id)
                    await up.send(json.dumps(self.opening()))
                    async for raw in up:
                        await self.on_upstream(raw)
                return  # clean 1000 close: session is over
            except (ConnectionClosedError, OSError, TimeoutError) as e:
                if isinstance(e, ConnectionClosedError) and e.rcvd and e.rcvd.code == 1008:
                    if not self.resuming:
                        raise  # a new session was refused (bad key): retrying can't fix it
                    log.warning("resume refused; opening a new session")
                    self.forget_session()
                    self.session_ready = False
                    continue  # a refusal, not a flaky network: reconnect at once
                self.session_ready = False
                self.dropped_at = self.dropped_at or time.monotonic()
                if time.monotonic() - self.dropped_at > RESUME_WINDOW_S:
                    raise
                log.warning("upstream dropped (%r); retrying in %.2fs", e, delay)
                await self.emit({"type": "relay.status", "upstream": "reconnecting"})
                await asyncio.sleep(delay)
                delay = min(delay * 2, 4)

    def opening(self):
        """First message on a new connection: resume if we can, else a new session, briefed if mid-incident."""
        if self.session_id:
            # resume_token arrives in session.ready but isn't documented as an input; the server tolerates it.
            return {"type": "session.resume", "session_id": self.session_id,
                    **({"resume_token": self.resume_token} if self.resume_token else {})}
        if not self.incident_at:
            return SESSION_UPDATE
        # Resume refused mid-incident (it was, in every variant tried live): incident state and authorizations live
        # here, so a new session rebuilt from our timeline carries on. No greeting: "IncidentVoice online" would
        # be absurd mid-rollback.
        session = {k: v for k, v in SESSION_UPDATE["session"].items() if k != "greeting"}
        return {"type": "session.update",
                "session": {**session, "system_prompt": SYSTEM_PROMPT + REBRIEF_PROMPT + self.timeline_text()}}

    def forget_session(self):
        self.session_id = self.resume_token = None
        self.ready_results.clear()
        self.live_calls.clear()

    async def on_upstream(self, raw):
        await self.ws.send_text(raw)  # forward first: audio latency matters more than our bookkeeping
        ev = json.loads(raw)
        t = ev.get("type")
        if t == "reply.audio":
            if self.turn_voice_end:
                self.turn_latency_ms = round((time.perf_counter() - self.turn_voice_end) * 1000)
                self.turn_voice_end = None
        elif t == "session.ready":
            fresh = ev["session_id"] != self.session_id
            self.session_id, self.resume_token = ev["session_id"], ev.get("resume_token")
            self.session_ready, self.dropped_at, self.agent_speaking, self.resuming = True, None, False, False
            self.last_turn_event = "reply.done"  # idle; also flushes results that finished while we were offline
            self.expect_reply = fresh and not self.incident_at  # only a first session opens with the greeting
            status = "resumed" if not fresh else "recovered" if self.incident_at else "connected"
            if status != "connected":
                self.mark("link", "session resumed with context intact" if status == "resumed"
                          else "resume refused; new session briefed from the incident timeline")
            await self.emit({"type": "relay.status", "upstream": status, "session_id": self.session_id})
            await self.flush_results()
            await self.flush_say()
        elif t == "reply.started":
            self.last_turn_event, self.agent_speaking, self.expect_reply = t, True, False
        elif t == "input.speech.started":
            self.last_turn_event, self.expect_reply = t, False
        elif t == "input.speech.stopped":
            # The server emits this together with the reply, not when speech ends, so latency is
            # measured from the operator's last voiced frame instead.
            self.turn_voice_end = self.last_voice_at or None
        elif t == "tool.call":
            self.reply_had_tool = True
            self.live_calls.add(ev["call_id"])
            self.spawn(self.exec_tool(ev))  # never block the audio loop on a tool
        elif t == "reply.done":
            self.agent_speaking = False
            latency, self.turn_latency_ms = self.turn_latency_ms, None
            named_fix = not self.reply_had_tool and FIX.search(self.agent_said)
            self.reply_had_tool, self.agent_said = False, ""
            # Hold-mode calls stay open after a barge-in. The docs say to drop the results, but a dropped one left
            # the agent silent until the 60 s tool timeout (verified live), so results always go out.
            await self.flush_results()
            if ev.get("status") == "interrupted":  # the operator is talking: no proactive speech over them
                self.last_turn_event = "input.speech.started"
            else:
                self.last_turn_event = t
                if latency is not None:  # interrupted replies began mid-utterance; their numbers are noise
                    await self.emit({"type": "relay.metrics", "turn_latency_ms": latency})
                if named_fix and self.phase == "triage" and not self.pending and self.nudges < MAX_NUDGES:
                    # The model named a fix without proposing it: hand it straight back instead of waiting on the
                    # operator to notice.
                    self.nudges += 1
                    self.mark("nudge", "agent named a fix without proposing it; asked it to propose")
                    self.say_queue.insert(0, "Without speaking first, call propose_remediation now for the fix you just named.")
                await self.flush_progress()
                await self.flush_say()
        elif t == "transcript.user":
            self.mark("operator", ev.get("text", ""))
            await self.on_user_transcript(ev.get("text", ""))
        elif t == "transcript.agent":
            self.agent_said += " " + ev.get("text", "")
            self.mark("agent", ev.get("text", ""))
        elif t in ("session.error", "error"):
            log.warning("upstream error: %s", ev)
            if ev.get("code") in ("session_not_found", "session_forbidden", "session_expired"):
                # Resume refused. The server closes this socket anyway (verified live), so drop it and come back as
                # a new session through the normal reconnect path.
                self.forget_session()
                self.up.transport.abort()
        elif t == "session.ended":
            self.ended = True

    async def flush_results(self):
        # Every tool runs in hold mode, where the server starts no reply until the result arrives, so "no reply in
        # progress" is the moment to send. Waiting for a reply.done after operator speech would deadlock.
        while self.ready_results and self.session_ready and not self.agent_speaking:
            msg = self.ready_results.pop(0)  # pop before await so a concurrent flush can't double-send
            try:
                await self.up.send(json.dumps(msg))
            except ConnectionClosed:
                self.ready_results.insert(0, msg)  # resend after session.ready
                return
            self.expect_reply = True  # the result triggers the agent's next reply

    # ---- tools ----

    async def exec_tool(self, ev):
        call_id, name, args = ev["call_id"], ev.get("name"), ev.get("arguments") or {}
        await self.emit({"type": "relay.tool", "call_id": call_id, "name": name, "arguments": args, "status": "running"})
        t0 = time.perf_counter()
        try:
            result = await self.run_tool(name, args)
        except Exception as e:
            log.exception("tool %s failed", name)
            result = {"error": f"{type(e).__name__}: {e}"}
        ms = round((time.perf_counter() - t0) * 1000)
        self.mark("tool", f"{name} {json.dumps(args)} -> {result.get('status') or ('error' if 'error' in result else 'ok')} in {ms} ms")
        await self.emit({"type": "relay.tool", "call_id": call_id, "name": name, "status": "done", "result": result, "ms": ms})
        if call_id in self.live_calls:
            self.live_calls.discard(call_id)
            self.ready_results.append({"type": "tool.result", "call_id": call_id, "result": json.dumps(result)})
            await self.flush_results()

    async def run_tool(self, name, args):
        # Arguments come from an LLM: validate like any untrusted input.
        if name == "query_service_health":
            which = args.get("service", "all")
            if which not in SERVICES + ["all"]:
                return {"error": f"unknown service {which!r}", "valid": SERVICES}
            health = {n: v for n, v in (await self.cluster.health()).items() if which in ("all", n)}
            # Recent errors ride along so triage takes one tool round trip (one LLM turn) instead of two.
            bad = [n for n, v in health.items() if v["status"] != "healthy"]
            for n, lines in zip(bad, await asyncio.gather(*(self.cluster.logs(n, 20) for n in bad))):
                health[n]["recent_errors"] = [line for line in lines if level(line) == "error"][-3:]
            return health
        if name == "tail_error_logs":
            service = args.get("service")
            if service not in SERVICES:
                return {"error": f"unknown service {service!r}", "valid": SERVICES}
            n = min(max(int(args.get("lines", 5)), 1), 20)
            return {"service": service, "lines": await self.cluster.logs(service, n)}
        if name == "propose_remediation":
            return await self.propose(args)
        return {"error": f"unknown tool {name!r}"}

    # ---- two-stage gate: the model proposes, the operator's code authorizes, the relay executes ----

    async def propose(self, args):
        service, action = args.get("service"), args.get("action")
        if service not in SERVICES or action not in ACTIONS:
            return {"error": "invalid service or action", "services": SERVICES, "actions": ACTIONS}
        if action == "scale_up" and service != "billing-worker":
            return {"error": "scale_up only applies to billing-worker"}
        if self.executing:
            return {"status": "executing", "message": "An authorized change is already running; progress will follow."}
        health = (await self.cluster.health())[service]
        if action == "rollback" and not health.get("previous_version"):
            return {"error": f"{service} has no previous version to roll back to"}
        change = f"{health['version']} to {health['previous_version']}" if action == "rollback" else action.replace("_", " ")
        p = self.pending
        if not (p and (p["service"], p["action"]) == (service, action) and time.monotonic() - p["at"] < GATE_TTL_S):
            # A new change always gets a new one-time code; re-proposing the same change keeps its code.
            code = " ".join(secrets.SystemRandom().sample(CODE_WORDS, 2))
            p = self.pending = {"service": service, "action": action, "change": change, "code": code, "at": time.monotonic()}
            self.mark("gate", f"proposed {action} {service} ({change}); awaiting the operator's authorization code")
        await self.emit({"type": "relay.gate", "state": "awaiting", "service": service, "action": action,
                         "change": change, "code": p["code"]})
        return {
            "status": "awaiting_authorization",
            "plan": f"roll {service} back to its previous version" if action == "rollback"
            else f"{action.replace('_', ' ')} {service}",
            "affected": DEPENDENTS.get(service, []),
            "instruction": "Nothing has changed. In under fifteen words, name the plan and ask the operator to read "
            "the authorization code on their screen. You do not know the code. When they read it, say only "
            "\"Verifying.\"; the system checks it, not you.",
        }

    async def on_user_transcript(self, text):
        p = self.pending
        if not p:
            return
        words = re.findall(r"[a-z]+", text.lower())
        if VETO.search(text):
            self.pending, self.nudges = None, MAX_NUDGES  # the operator is steering now
            self.mark("gate", f'rejected by the operator: "{text}"')
            await self.emit({"type": "relay.gate", "state": "rejected", "service": p["service"], "action": p["action"]})
        elif all(w in words for w in p["code"].split()):
            self.pending = None  # one code = one execution
            self.mark("gate", f'authorized by the operator reading code "{p["code"]}": "{text}"')
            await self.emit({"type": "relay.gate", "state": "approved", "service": p["service"], "action": p["action"],
                             "heard": text})
            self.spawn(self.execute(p, text))
        elif any(w in CODE_WORDS for w in words):
            await self.say("Tell the operator in one short sentence that the code didn't match and to read it again.")

    async def execute(self, p, heard):
        service, action = p["service"], p["action"]
        self.executing = True
        await self.set_phase("mitigation")
        await self.emit({"type": "relay.gate", "state": "executing", "service": service, "action": action})
        self.mark("change", f'{action} {service} ({p["change"]}), authorized by the operator reading code '
                            f'"{p["code"]}" ("{heard}")')
        try:
            result = await self.cluster.remediate(service, action, self.narrate)
        except Exception as e:
            log.exception("remediation failed")
            result = {"status": "failed", "error": repr(e)}
        self.progress_note = None  # the outcome speaks for itself now
        self.mark("outcome", f"{action} {service}: {result['status']}")
        states = ", ".join(f"{n} {v['status']}" for n, v in result.get("services", {}).items())
        # Queued while still executing, so the incident can't resolve (and file its postmortem) before this is said.
        await self.say(f"Report to the operator in one sentence: the {action} of {service} finished with status "
                       f"{result['status']}; {states}.")
        self.executing = False
        await self.emit({"type": "relay.gate", "state": "done", "service": service, "action": action, "result": result})

    # ---- lifecycle ----

    async def run(self):
        tasks = [asyncio.create_task(c) for c in
                 (self.pump_browser(), self.pump_upstream(), self.cluster.run(self.on_state, self.on_log))]
        try:
            async with asyncio.timeout(MAX_SESSION_S):
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                if t.exception():
                    raise t.exception()
        except Exception as e:
            log.warning("session closing: %r", e)
            with contextlib.suppress(Exception):
                await self.emit({"type": "relay.error", "message": repr(e)})
        finally:
            if self.up and not self.ended:  # skip the billable 30 s resume grace
                with contextlib.suppress(Exception):
                    await self.up.send(json.dumps({"type": "session.end"}))
            for t in (*tasks, *self.tasks):
                t.cancel()
            await asyncio.gather(*tasks, *self.tasks, return_exceptions=True)
            with contextlib.suppress(Exception):
                await self.cluster.close()
            with contextlib.suppress(Exception):
                await self.ws.close()
            if self.incident_at and self.session_id:
                task = asyncio.create_task(save_evidence(self.session_id))
                BACKGROUND.add(task)
                task.add_done_callback(BACKGROUND.discard)


app = FastAPI()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if ws.headers.get("origin") not in ALLOWED_ORIGINS:  # stop other sites spending our key via the visitor's browser
        await ws.close(code=1008)
        return
    await ws.accept()
    await Session(ws).run()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="127.0.0.1", port=8000)
