"""Run from repo root: uv run --project backend --env-file backend/.env python backend/probes/probe_tools.py
Does a mid-session session.update of `tools` take effect? Session starts with NO tools; we add one, ask the
agent to call it via reply.create, then remove it and ask again."""
import asyncio, base64, json, os, websockets
URL = "wss://agents.assemblyai.com/v1/ws"
H = {"Authorization": f"Bearer {os.environ['ASSEMBLYAI_API_KEY']}"}
PING = {"type": "function", "name": "ping_probe", "description": "Call this whenever asked to ping.",
        "parameters": {"type": "object", "properties": {}}, "execution_mode": "hold", "timeout_seconds": 20}
SIL = json.dumps({"type": "input.audio", "audio": base64.b64encode(b"\0" * 2400).decode()})

async def main():
    async with websockets.connect(URL, additional_headers=H) as ws:
        await ws.send(json.dumps({"type": "session.update", "session": {
            "system_prompt": "You are a test agent. Be extremely brief. If a tool named ping_probe exists and you are asked to ping, call it; if it does not exist, say 'no tool'.",
            "greeting": "Ready."}}))
        stage, calls, done = "greeting", {}, asyncio.Event()
        async def mic():
            while True:
                await ws.send(SIL); await asyncio.sleep(0.05)
        async def step(name, msgs):
            nonlocal stage
            stage = name; calls[name] = []
            for m in msgs: await ws.send(json.dumps(m))
        feeder = None
        async for raw in ws:
            m = json.loads(raw); t = m["type"]
            if t == "session.ready":
                feeder = asyncio.create_task(mic())
            elif t == "session.updated":
                print(f"[{stage}] session.updated tools={[x['name'] for x in (m.get('config') or {}).get('tools') or []]}")
            elif t in ("session.error", "error"):
                print(f"[{stage}] ERROR {m.get('code')} {m.get('message')}")
            elif t == "tool.call":
                calls[stage].append(m["name"]); print(f"[{stage}] tool.call {m['name']}")
                await asyncio.sleep(0.3)
                await ws.send(json.dumps({"type": "tool.result", "call_id": m["call_id"], "result": json.dumps({"pong": True})}))
            elif t == "transcript.agent":
                print(f"[{stage}] agent: {m['text'].strip()}")
            elif t == "reply.done":
                await asyncio.sleep(1.0)
                if stage == "greeting":
                    await step("added", [{"type": "session.update", "session": {"tools": [PING]}}])
                    await asyncio.sleep(1.0)
                    await ws.send(json.dumps({"type": "reply.create", "instructions": "Ping now."}))
                elif stage == "added" and not calls["added"] and False:
                    pass
                elif stage == "added":
                    await step("removed", [{"type": "session.update", "session": {"tools": []}}])
                    await asyncio.sleep(1.0)
                    await ws.send(json.dumps({"type": "reply.create", "instructions": "Ping now."}))
                elif stage == "removed":
                    break
        print("RESULT: tool added mid-session was called:", bool(calls.get("added")),
              "| tool removed mid-session was still called:", bool(calls.get("removed")))
        await ws.send(json.dumps({"type": "session.end"}))

asyncio.run(asyncio.wait_for(main(), 90))
