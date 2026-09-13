"""Self-check: incident lifecycle, code-authorized gate, named-fix watchdog, tool.result timing, latency, resume.
Run: uv run test_relay.py"""
import asyncio
import json
import os
import tempfile
import time

os.environ.setdefault("ASSEMBLYAI_API_KEY", "test")
os.environ["INCIDENT_DIR"] = tempfile.mkdtemp()
os.environ["INFRA"] = "sim"
import websockets  # noqa: E402

import cluster  # noqa: E402
import relay  # noqa: E402

cluster.ROLLOUT_S = cluster.CASCADE_S = 0


class Fake:
    def __init__(self):
        self.sent = []

    async def send_text(self, s):
        self.sent.append(json.loads(s))

    send = send_text


def sent(f, kind):
    return [m for m in f.sent if m["type"] == kind]


AUTH_ROLLBACK = {"service": "auth-service", "action": "rollback"}


def session():
    s = relay.Session(Fake())
    s.up = Fake()

    async def ev(**k):
        await s.on_upstream(json.dumps(k))

    return s, ev


async def incident_flow():
    s, ev = session()

    async def poll():
        await s.on_state(await s.cluster.health())

    await ev(type="session.ready", session_id="s1")
    await poll()
    assert s.phase == "monitoring"

    # The page waits for the agent to be free, then goes out as reply.create.
    await ev(type="reply.started")
    await s.cluster.inject_fault()
    await poll()
    assert s.phase == "triage" and not sent(s.up, "reply.create")
    await ev(type="reply.done", status="completed")
    page = sent(s.up, "reply.create")
    assert len(page) == 1 and "auth-service is down" in page[0]["instructions"], page
    await ev(type="reply.started")
    await ev(type="reply.done", status="completed")

    # The code goes to the operator's screen only, never to the model.
    r = await s.run_tool("propose_remediation", AUTH_ROLLBACK)
    code = sent(s.ws, "relay.gate")[-1]["code"]
    assert r["status"] == "awaiting_authorization" and not any(w in json.dumps(r) for w in code.split()), r
    assert (await s.cluster.health())["auth-service"]["status"] == "down"
    # A plain "yes" (or the agent's own voice echoing back) can't authorize anything.
    await ev(type="transcript.user", text="Yes, do it.")
    assert s.pending and not s.executing
    # A wrong code runs nothing and asks the operator to read it again.
    wrong = [w for w in relay.CODE_WORDS if w not in code.split()][:2]
    await ev(type="transcript.user", text=f"Authorize {' '.join(wrong)}.")
    assert s.pending and not s.executing
    assert "didn't match" in (s.say_queue + [m["instructions"] for m in sent(s.up, "reply.create")])[-1]
    # Veto cancels.
    await ev(type="transcript.user", text="No, wait.")
    assert s.pending is None
    # Re-proposing the same change keeps its code; a different change replaces the proposal.
    await s.run_tool("propose_remediation", AUTH_ROLLBACK)
    code = s.pending["code"]
    await s.run_tool("propose_remediation", AUTH_ROLLBACK)
    assert s.pending["code"] == code
    await s.run_tool("propose_remediation", {"service": "api-gateway", "action": "restart"})
    assert s.pending["service"] == "api-gateway"
    # The right code: the relay runs exactly the authorized change.
    await s.run_tool("propose_remediation", AUTH_ROLLBACK)
    code = s.pending["code"]
    await ev(type="transcript.user", text=f"Authorize {code.title()}.")
    await asyncio.sleep(0)  # let the spawned execution start
    assert s.pending is None and s.executing
    assert (await s.run_tool("propose_remediation", AUTH_ROLLBACK))["status"] == "executing"
    await asyncio.gather(*s.tasks)
    assert not s.executing and all(v["status"] == "healthy" for v in (await s.cluster.health()).values())
    assert sent(s.ws, "relay.progress"), "rollout progress reaches the UI"

    # Recovery closes the incident: postmortem with the code, prompt swapped mid-session, outcome said first.
    await poll()
    assert s.phase == "resolved"
    assert "resolved" in sent(s.up, "session.update")[-1]["session"]["system_prompt"]
    report = (relay.INCIDENT_DIR / "s1.md").read_text()
    assert f'code "{code}"' in report and "v2.14.1 to v2.14.0" in report, report
    said = [m["instructions"] for m in sent(s.up, "reply.create")] + s.say_queue
    outcome = next(i for i, x in enumerate(said) if "finished with status success" in x)
    assert outcome < next(i for i, x in enumerate(said) if "postmortem" in x), said

    # tool.result waits while the agent is speaking.
    s.up.sent.clear()
    await ev(type="reply.started")
    await ev(type="tool.call", call_id="c1", name="query_service_health", arguments={"service": "all"})
    await asyncio.gather(*s.tasks)
    assert s.up.sent == []
    await ev(type="reply.done", status="completed")
    assert sent(s.up, "tool.result")[0]["call_id"] == "c1", s.up.sent
    assert json.loads(sent(s.up, "tool.result")[0]["result"])["auth-service"]["status"] == "healthy"
    # ...and still goes out after a barge-in: the hold-mode call stays open server-side (dropping it stalls 60 s).
    s.up.sent.clear()
    await ev(type="reply.started")
    await ev(type="tool.call", call_id="c2", name="tail_error_logs", arguments={"service": "auth-service"})
    await asyncio.gather(*s.tasks)
    assert not sent(s.up, "tool.result")
    await ev(type="input.speech.started")
    await ev(type="reply.done", status="interrupted")
    assert [m["call_id"] for m in sent(s.up, "tool.result")] == ["c2"], s.up.sent
    assert not sent(s.up, "reply.create"), "no proactive speech over the operator"

    # LLM arguments are validated.
    assert "error" in await s.run_tool("tail_error_logs", {"service": "../etc/passwd"})
    assert "error" in await s.run_tool("propose_remediation", {"service": "auth-service", "action": "scale_up"})

    # Turn latency runs from the operator's last voiced frame, not the late speech.stopped event.
    s.last_voice_at = time.perf_counter() - 0.5
    await ev(type="input.speech.stopped")
    await ev(type="reply.started")
    await ev(type="reply.audio", data="")
    await ev(type="reply.done", status="completed")
    lat = [m["turn_latency_ms"] for m in s.ws.sent if m["type"] == "relay.metrics"]
    assert len(lat) == 1 and 450 < lat[0] < 800, lat
    # A reply the operator talked over (they hadn't finished) reports nothing.
    await ev(type="input.speech.stopped")
    await ev(type="reply.started")
    await ev(type="reply.audio", data="")
    await ev(type="reply.done", status="interrupted")
    assert len(sent(s.ws, "relay.metrics")) == 1


async def named_fix_watchdog():
    s, ev = session()
    await ev(type="session.ready", session_id="s2")
    s.phase = "triage"
    # The model names a fix but ends its turn without proposing it: the relay hands it straight back.
    await ev(type="reply.started")
    await ev(type="transcript.agent", text="The last deploy broke auth; I'd roll back auth-service.")
    await ev(type="reply.done", status="completed")
    assert "propose_remediation" in sent(s.up, "reply.create")[-1]["instructions"], s.up.sent
    # A reply that did call a tool is left alone.
    await ev(type="reply.started")
    await ev(type="transcript.agent", text="Rolling back is the fix.")
    await ev(type="tool.call", call_id="c9", name="propose_remediation", arguments=AUTH_ROLLBACK)
    await ev(type="reply.done", status="completed")
    await asyncio.gather(*s.tasks)
    assert s.nudges == 1


async def until(cond):
    for _ in range(100):
        if cond():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition never met")


async def drop_mid_incident(refuse_resume):
    """Cut the AssemblyAI link mid-incident (the dashboard's demo.drop) against a fake server."""
    got = []

    async def fake_aai(ws):
        first = json.loads(await ws.recv())
        got.append(first)
        if first["type"] == "session.resume" and refuse_resume:  # exactly what the live server did
            await ws.send(json.dumps({"type": "session.error", "code": "unauthorized",
                                      "message": "Resume credential is invalid for this session"}))
            await ws.close(1008)
            return
        sid = first.get("session_id") or f"sess-{len(got)}"
        await ws.send(json.dumps({"type": "session.ready", "session_id": sid, "resume_token": f"tok-{sid}"}))
        await ws.wait_closed()

    async with websockets.serve(fake_aai, "127.0.0.1", 0) as server:
        relay.AAI_URL = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
        s = relay.Session(Fake())
        task = asyncio.create_task(s.pump_upstream())
        await until(lambda: s.session_ready)
        s.incident_at = time.time()
        await s.on_control('{"type": "demo.drop"}')
        await until(lambda: len(got) == (3 if refuse_resume else 2) and s.session_ready)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert got[0]["type"] == "session.update" and got[0]["session"]["tools"], got
    return s, got


async def resume_after_drop():
    s, got = await drop_mid_incident(refuse_resume=False)
    assert got[1] == {"type": "session.resume", "session_id": "sess-1", "resume_token": "tok-sess-1"}, got
    assert s.session_id == "sess-1" and sent(s.ws, "relay.status")[-1]["upstream"] == "resumed"
    # Refused resume: straight into a new session, no greeting, briefed from the relay's own timeline.
    s, got = await drop_mid_incident(refuse_resume=True)
    new = got[2]["session"]
    assert got[2]["type"] == "session.update" and "greeting" not in new, got
    assert "middle of an incident" in new["system_prompt"]
    assert s.session_id == "sess-3" and sent(s.ws, "relay.status")[-1]["upstream"] == "recovered"


if __name__ == "__main__":
    asyncio.run(incident_flow())
    asyncio.run(named_fix_watchdog())
    asyncio.run(resume_after_drop())
    print("ok")
