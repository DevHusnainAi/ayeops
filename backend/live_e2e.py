"""Live rehearsal of the whole demo against the real AssemblyAI API; the operator's voice is synthesized with gTTS.
Beats: bad deploy -> agent pages and triages -> proposal -> link cut and resumed -> operator reads the code ->
relay rolls back -> postmortem -> "What happened?".
Run from backend/:  [INFRA=docker] uv run --env-file .env --with gtts python live_e2e.py"""
import asyncio
import base64
import io
import json
import os
import subprocess
import sys
import time
import wave

import websockets
from gtts import gTTS

FRAME = 2400  # 50 ms of PCM16 @ 24 kHz
OUT_WAV = "agent_reply.wav"


def speech(text):
    mp3 = io.BytesIO()
    gTTS(text, lang="en").write_to_fp(mp3)
    return subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "24000", "pipe:1"],
                          input=mp3.getvalue(), capture_output=True, check=True).stdout


LINES = {"fix": speech("Okay, fix it."), "what": speech("What happened?")}  # "approve" is made once the code is shown

relay = subprocess.Popen([sys.executable, "relay.py"], env=os.environ)
T0 = time.monotonic()


def say(*a):
    print(f"[{time.monotonic() - T0:6.1f}s]", *a, flush=True)


async def main():
    for _ in range(100):
        try:
            ws = await websockets.connect("ws://127.0.0.1:8000/ws", origin="http://localhost:3000", max_size=None)
            break
        except OSError:
            await asyncio.sleep(0.1)
    queue = []
    st = {"running": 0, "gate": None, "code": None, "last": None, "last_at": 0, "sent": [], "phase": None,
          "fault_sent": False, "fault_at": None, "drop_at": None, "resumed": False, "tool_done_at": 0,
          "phase_at": 0, "statuses": None}
    audio = bytearray()

    async def mic():  # real-time paced: utterance audio, else silence
        buf, nxt = b"", time.monotonic()
        while True:
            if not buf and queue:
                buf = queue.pop(0)
            chunk, buf = (buf[:FRAME], buf[FRAME:]) if buf else (b"\0" * FRAME, b"")
            await ws.send(chunk.ljust(FRAME, b"\0"))
            nxt += 0.05
            await asyncio.sleep(max(0, nxt - time.monotonic()))

    def utter(key):
        st["sent"].append(key)
        st["last"] = "waiting"
        queue.append(LINES[key])
        say(f"OPERATOR >> {key}")

    async def director():  # speak only when the agent is truly idle
        while True:
            await asyncio.sleep(0.25)
            quiet = st["last"] == "reply.done" and time.monotonic() - st["last_at"] > 1.5 and not queue
            if st["phase"] == "monitoring" and not st["fault_sent"] and quiet:
                st["fault_sent"], st["fault_at"] = True, time.monotonic()
                await ws.send(json.dumps({"type": "demo.fault"}))
                say("DEMO       : bad deploy shipped")
                continue
            # the agent must have spoken since the last tool result and since the phase changed (e.g. the page)
            idle = quiet and st["last_at"] > max(st["tool_done_at"], st["phase_at"]) and st["running"] == 0
            if not idle or st["phase"] in (None, "starting", "monitoring") or st["gate"] in ("approved", "executing"):
                continue
            s = st["sent"]
            if st["gate"] == "awaiting":
                if not st["drop_at"]:  # prove session.resume: cut the link mid-incident, then carry on
                    st["drop_at"] = time.monotonic()
                    await ws.send(json.dumps({"type": "demo.drop"}))
                    say("DEMO       : AssemblyAI link cut")
                elif st["resumed"] and "approve" in LINES and s.count("approve") < 2:
                    utter("approve")
            elif st["phase"] == "resolved":
                if "what" in s:
                    return
                utter("what")
            elif st["phase"] == "triage" and time.monotonic() - st["last_at"] > 5:  # the relay's watchdog goes first
                if s.count("fix") > 2:
                    raise RuntimeError("agent stalled")
                utter("fix")

    def make_approval(code):
        LINES["approve"] = speech(f"Authorize {code}.")

    async def listen():
        async for raw in ws:
            m = json.loads(raw)
            t = m["type"]
            if t == "reply.audio":
                audio.extend(base64.b64decode(m["data"]))
            elif t in ("reply.started", "reply.done"):
                st["last"] = "interrupted" if m.get("status") == "interrupted" else t
                st["last_at"] = time.monotonic()
                if m.get("status") == "interrupted":
                    say("  · reply interrupted")
            elif t == "transcript.user":
                say("HEARD      :", m["text"])
            elif t == "transcript.agent":
                say("AGENT      :", m["text"].strip())
            elif t == "relay.tool":
                st["running"] += 1 if m["status"] == "running" else -1
                if m["status"] == "running":
                    say("TOOL CALL  :", m["name"], m["arguments"])
                else:
                    st["tool_done_at"] = time.monotonic()
                    say("TOOL DONE  :", m["name"], f"{m['ms']}ms", json.dumps(m["result"])[:130])
            elif t == "relay.gate":
                st["gate"] = m["state"]
                say("GATE       :", m["state"], m["service"], m["action"], m.get("change", ""),
                    f"code={m['code']!r}" if m.get("code") else "", m.get("heard", ""))
                if m["state"] == "awaiting" and m["code"] != st["code"]:
                    st["code"] = m["code"]
                    LINES.pop("approve", None)
                    asyncio.get_running_loop().run_in_executor(None, make_approval, m["code"])
            elif t == "relay.status":
                since = f"({(time.monotonic() - st['drop_at']) * 1000:.0f} ms after the cut)" if st["drop_at"] else ""
                say("LINK       :", m["upstream"], since)
                if st["drop_at"] and m["upstream"] in ("resumed", "recovered", "connected"):
                    st["resumed"] = True
            elif t == "relay.phase":
                st["phase"], st["phase_at"] = m["phase"], time.monotonic()
                say("PHASE      :", m["phase"])
            elif t == "relay.progress":
                say("PROGRESS   :", m["text"])
            elif t == "relay.metrics":
                say("LATENCY    :", m["turn_latency_ms"], "ms")
            elif t == "relay.postmortem":
                say("POSTMORTEM :", m["path"], f"time to recover {m['time_to_recover_s']} s",
                    f"(from demo.fault: {time.monotonic() - st['fault_at']:.0f} s)")
            elif t == "infra.state":
                statuses = {k: v["status"] for k, v in m["services"].items()}
                if statuses != st["statuses"]:
                    st["statuses"] = statuses
                    say("INFRA      :", statuses)
            elif t in ("session.error", "relay.error", "session.ended"):
                say(t, {k: v for k, v in m.items() if k != "type"})
                if t == "relay.error":
                    tasks[2].cancel()  # the session is gone; don't wait out the timeout

    tasks = [asyncio.create_task(c) for c in (mic(), listen(), director())]
    try:
        async with asyncio.timeout(180):
            await tasks[2]
    finally:
        for t in tasks:
            t.cancel()
        await ws.close()
        with wave.open(OUT_WAV, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(bytes(audio))
        say("agent audio saved:", OUT_WAV)


try:
    asyncio.run(main())
finally:
    time.sleep(12)  # let the relay pull the session recording into incidents/ and tear down its cluster
    relay.terminate()
    relay.wait()
