"""Live check for F5: click "Run the demo for me" and watch it run to green, unattended, against the real API.
Run from backend/:  [INFRA=docker] uv run --env-file .env relay.py &   (separate terminal)
                     uv run --env-file .env python live_autopilot.py
"""
import asyncio
import json
import os
import sys
import time

import websockets

T0 = time.monotonic()


def say(*a):
    print(f"[{time.monotonic() - T0:6.1f}s]", *a, flush=True)


async def main():
    ws = await websockets.connect("ws://127.0.0.1:8000/ws", origin="http://localhost:3000", max_size=None)
    await ws.send(json.dumps({"type": "demo.autopilot"}))
    say("sent demo.autopilot -- no mic, no scripted operator lines from this process")
    async with asyncio.timeout(120):
        async for raw in ws:
            m = json.loads(raw)
            t = m["type"]
            if t == "relay.phase":
                say("PHASE      :", m["phase"])
            elif t == "transcript.user":
                say("HEARD      :", m["text"])
            elif t == "transcript.agent":
                say("AGENT      :", m["text"].strip())
            elif t == "relay.gate":
                say("GATE       :", m["state"], m.get("service", ""), m.get("action", ""))
            elif t == "relay.postmortem":
                say("POSTMORTEM :", f"time to recover {m['time_to_recover_s']}s")
                say("autopilot ran the full incident unattended -- F5 verified live")
                return
            elif t in ("relay.error", "session.error"):
                say(t, {k: v for k, v in m.items() if k != "type"})
                sys.exit(1)
    await ws.close()


asyncio.run(main())
