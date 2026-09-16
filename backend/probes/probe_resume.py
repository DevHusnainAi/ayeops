"""Live probe: which session.resume variants does the server accept?
Run from repo root: uv run --project backend --env-file backend/.env python backend/probes/probe_resume.py
Each variant: open a real session, stream silence until the greeting finishes, cut the link, then try to resume."""
import asyncio, base64, json, os, urllib.request, websockets
URL = "wss://agents.assemblyai.com/v1/ws"
KEY = os.environ["ASSEMBLYAI_API_KEY"]
H = {"Authorization": f"Bearer {KEY}"}
UPDATE = {"type": "session.update", "session": {"system_prompt": "Stay silent.", "greeting": "Hi there."}}
SILENCE = json.dumps({"type": "input.audio", "audio": base64.b64encode(b"\0" * 2400).decode()})

def temp_token():
    req = urllib.request.Request("https://agents.assemblyai.com/v1/token?expires_in_seconds=60", headers={"Authorization": KEY})
    return json.load(urllib.request.urlopen(req, timeout=10))["token"]

async def live_dropped_session(url, headers):
    ws = await websockets.connect(url, additional_headers=headers)
    await ws.send(json.dumps(UPDATE))
    sid = tok = None
    async def mic():
        while True:
            if sid: await ws.send(SILENCE)
            await asyncio.sleep(0.05)
    feeder = asyncio.create_task(mic())
    async for raw in ws:
        m = json.loads(raw)
        if m["type"] == "session.ready":
            sid, tok = m["session_id"], m.get("resume_token")
        elif m["type"] == "reply.done":
            break
    await asyncio.sleep(1)
    feeder.cancel()
    ws.transport.abort()  # abnormal drop, like a network cut
    return sid, tok

async def try_resume(name, create, url_fn, headers_fn, body_fn, delay):
    cu, ch = create()
    sid, tok = await live_dropped_session(cu, ch)
    await asyncio.sleep(delay)
    try:
        async with websockets.connect(url_fn(sid, tok), additional_headers=headers_fn(sid, tok)) as ws:
            await ws.send(json.dumps(body_fn(sid, tok)))
            m = json.loads(await asyncio.wait_for(ws.recv(), 10))
            ok = m["type"] == "session.ready" and m.get("session_id") == sid
            print(f"{name:52} -> {'RESUMED ' if ok else ''}{m['type']} {m.get('code', '')} {m.get('message', '')}")
            await ws.send(json.dumps({"type": "session.end"}))
    except Exception as e:
        print(f"{name:52} -> {type(e).__name__}")

KEYCONN = lambda: (URL, H)
TMPCONN = lambda: (f"{URL}?token={temp_token()}", {})
R = lambda s, t: {"type": "session.resume", "session_id": s}
RT = lambda s, t: {"type": "session.resume", "session_id": s, "resume_token": t}
VARIANTS = [
    ("docs: key session, body session_id only", KEYCONN, lambda s, t: URL, lambda s, t: H, R, 0.5),
    ("key session, key resume @0.25s", KEYCONN, lambda s, t: URL, lambda s, t: H, R, 0.25),
    ("key session, key resume + resume_token @0.25s", KEYCONN, lambda s, t: URL, lambda s, t: H, RT, 0.25),
    ("key session, Authorization: Bearer <resume_token>", KEYCONN, lambda s, t: URL, lambda s, t: {"Authorization": f"Bearer {t}"}, R, 0.25),
    ("key session, URL ?resume_token=", KEYCONN, lambda s, t: f"{URL}?resume_token={t}", lambda s, t: H, R, 0.25),
    ("key session, fresh temp-token resume", KEYCONN, lambda s, t: f"{URL}?token={temp_token()}", lambda s, t: {}, R, 0.25),
    ("key session, temp-token resume + resume_token", KEYCONN, lambda s, t: f"{URL}?token={temp_token()}", lambda s, t: {}, RT, 0.25),
    ("temp-token session, temp-token resume", TMPCONN, lambda s, t: f"{URL}?token={temp_token()}", lambda s, t: {}, R, 0.25),
    ("temp-token session, temp-token resume + resume_token", TMPCONN, lambda s, t: f"{URL}?token={temp_token()}", lambda s, t: {}, RT, 0.25),
]

async def main():
    for v in VARIANTS:
        await try_resume(*v)

asyncio.run(main())
