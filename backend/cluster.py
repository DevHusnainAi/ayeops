"""The infrastructure the agent operates. Both clusters expose the same coroutines:
health(), logs(service, n), remediate(service, action, progress), inject_fault(), run(on_state, on_log), close()."""
import asyncio
import contextlib
import json
import os
import random
import time
import urllib.request
import uuid
from asyncio.subprocess import DEVNULL, PIPE, STDOUT
from collections import deque
from pathlib import Path

SERVICES = ["auth-service", "api-gateway", "billing-worker"]
ACTIONS = ["rollback", "restart", "scale_up"]
DEPENDENTS = {"auth-service": ["api-gateway", "billing-worker"]}
GOOD = {"auth-service": "v2.14.0", "api-gateway": "v5.3.0", "billing-worker": "v1.9.2"}
BAD_AUTH = "v2.14.1"  # the deploy that breaks JWKS key parsing (see demo-cluster/svc.py)
SEED_AGE_S = {"auth-service": 2 * 86400, "api-gateway": 3 * 86400, "billing-worker": 2 * 86400}  # seeded history
ROLLOUT_S = 2.5  # sim only
CASCADE_S = 1.5  # sim only: dependents recover a beat after their upstream


def ago(ts):
    s = int(time.time() - ts)
    return f"{s} second{'' if s == 1 else 's'} ago" if s < 120 else f"{s // 60} minutes ago" if s < 7200 else f"{s // 86400} days ago"


def level(line):
    return "error" if any(w in line for w in ("ERROR", "FATAL", "panic")) else "info"


class Cluster:
    """Deploy history shared by both clusters; the relay is the CD system, so it knows what it shipped."""

    def __init__(self):
        self.history = {s: [v] for s, v in GOOD.items()}
        self.deployed_at = {s: time.time() - SEED_AGE_S[s] for s in SERVICES}
        self.remediating = set()

    def deploy_info(self, s):
        h = self.history[s]
        return {"version": h[-1], "previous_version": h[-2] if len(h) > 1 else None,
                "last_deploy": ago(self.deployed_at[s])}

    def ship(self, s, version):
        self.history[s].append(version)
        self.deployed_at[s] = time.time()

    def roll_back(self, s):
        bad = self.history[s].pop()
        self.deployed_at[s] = time.time()
        return bad, self.history[s][-1]

    async def result(self, action, s):
        health = await self.health()
        ok = all(v["status"] == "healthy" for v in health.values())
        return {"status": "success" if ok else "no_improvement", "action": action, "service": s,
                "services": {n: {"status": v["status"], "version": v["version"]} for n, v in health.items()}}

    async def close(self):
        pass


SIM_LOGS = {
    "auth-service": [
        "FATAL jwks: failed to parse signing key kid=prod-2026-09: unexpected nil *rsa.PublicKey",
        "panic: runtime error: invalid memory address or nil pointer dereference [token/verify.go:88]",
        "Back-off restarting failed container auth-service (restarts=14)",
    ],
    "api-gateway": [
        "ERROR 502 GET /v1/checkout upstream=auth-service: connection refused",
        "WARN circuit breaker OPEN for auth-service (failure ratio 0.93)",
    ],
    "billing-worker": [
        "ERROR charge job failed: auth-service token verification unavailable",
        "WARN queue depth above threshold, consumer lag rising",
    ],
}
SIM_OK_LOGS = ["INFO GET /healthz 200 3ms", "INFO request completed 200 p50=41ms"]


class SimCluster(Cluster):
    """In-memory cluster, one per browser tab: hosted demos without Docker."""

    def __init__(self):
        super().__init__()
        self.broken = None  # service whose running version is bad
        self.last_broken, self.fixed_at = None, 0.0
        self.queue_depth = 0
        self.lines = {s: deque(maxlen=50) for s in SERVICES}
        self.on_log = None

    async def log(self, s, line):
        line = f"{time.strftime('%H:%M:%S')} {line}"
        self.lines[s].append(line)
        if self.on_log:
            await self.on_log(s, level(line), line)

    async def inject_fault(self):
        if self.broken:
            return
        self.ship("auth-service", BAD_AUTH)
        self.broken = "auth-service"
        await self.log("auth-service", f"INFO auth-service {BAD_AUTH} starting")
        for line in SIM_LOGS["auth-service"][:2]:
            await self.log("auth-service", line)

    def status(self, s):
        if s in self.remediating:
            return "remediating"
        if s == self.broken:
            return "down"
        src = self.broken or (self.last_broken if time.monotonic() < self.fixed_at + CASCADE_S else None)
        return "degraded" if src and s in DEPENDENTS.get(src, ()) else "healthy"

    async def health(self):
        out = {}
        for s in SERVICES:
            st = self.status(s)
            err = {"down": 1.0, "degraded": 0.6}.get(st, 1.0 if s == self.broken else 0.0)
            out[s] = {"status": st, **self.deploy_info(s), "error_rate": err, "p99_ms": 5000 if err else 40}
            if s == "billing-worker":
                out[s]["queue_depth"] = self.queue_depth
        return out

    async def logs(self, s, n):
        return list(self.lines[s])[-n:]

    async def remediate(self, s, action, progress):
        self.remediating.add(s)
        try:
            if action == "rollback":
                bad, good = self.roll_back(s)
                await progress(f"rolling {s} back from {bad} to {good}")
                await asyncio.sleep(ROLLOUT_S)
                if self.broken == s:  # the bad build is gone
                    self.broken, self.last_broken, self.fixed_at = None, s, time.monotonic()
                await self.log(s, f"INFO rollout complete: {good} ready")
            else:
                await progress(f"{action.replace('_', ' ')} of {s} under way")
                await asyncio.sleep(ROLLOUT_S)
        finally:
            self.remediating.discard(s)
        await progress(f"{s} is {self.status(s)}")
        await asyncio.sleep(CASCADE_S)
        return await self.result(action, s)

    async def run(self, on_state, on_log):
        self.on_log = on_log
        while True:
            self.queue_depth = max(0, self.queue_depth + (10 if self.broken else -40))  # per 0.5 s tick
            for s in SERVICES:
                st = self.status(s)
                if st in ("down", "degraded") and random.random() < 0.6:
                    await self.log(s, random.choice(SIM_LOGS[s]))
                elif st == "healthy" and random.random() < 0.1:
                    await self.log(s, random.choice(SIM_OK_LOGS))
            await on_state(await self.health())
            await asyncio.sleep(0.5)


COMPOSE = ["docker", "compose", "-f", str(Path(__file__).parent / "demo-cluster" / "compose.yaml")]
VERSION_ENV = {"auth-service": "AUTH_VERSION", "api-gateway": "GATEWAY_VERSION", "billing-worker": "BILLING_VERSION"}
MAX_DOCKER_CLUSTERS = int(os.environ.get("MAX_DOCKER_CLUSTERS", "4"))  # 3 containers each


async def sh(*cmd, env=None):
    proc = await asyncio.create_subprocess_exec(*cmd, env=env, stdout=PIPE, stderr=STDOUT)
    out, _ = await proc.communicate()
    if proc.returncode:
        raise RuntimeError(f"{' '.join(cmd[-4:])}: {out.decode()[-400:]}")
    return out.decode()


def port_of(container):
    return next((p["PublishedPort"] for p in container.get("Publishers") or [] if p.get("PublishedPort")), None)


def probe(port):
    if not port:
        return None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=0.3) as r:
            return json.load(r)
    except Exception:  # down, starting, or crash-looping
        return None


class DockerCluster(Cluster):
    """Real containers from demo-cluster/: real crash loops, real logs, real rollbacks. Every session gets its own
    compose project (own network, own ephemeral ports), torn down when the session ends, so concurrent viewers
    never touch each other's cluster."""

    mine = set()  # live projects owned by this relay process
    swept = False

    def __init__(self):
        super().__init__()
        self.project = f"iv-{uuid.uuid4().hex[:8]}"
        self.workers = 1

    def env(self):
        return {**os.environ, **{VERSION_ENV[s]: h[-1] for s, h in self.history.items()},
                "BILLING_WORKERS": str(self.workers)}

    async def compose(self, *args):
        return await sh(*COMPOSE, "-p", self.project, *args, env=self.env())

    async def ps(self):
        raw = (await self.compose("ps", "-a", "--format", "json")).strip()
        rows = json.loads(raw) if raw.startswith("[") else [json.loads(r) for r in raw.splitlines() if r.startswith("{")]
        return {r["Service"]: r for r in rows}

    async def inject_fault(self):
        if self.history["auth-service"][-1] != BAD_AUTH:
            self.ship("auth-service", BAD_AUTH)
            await self.compose("up", "-d", "auth-service")

    async def health(self):
        ps = await self.ps()
        probes = await asyncio.gather(*(asyncio.to_thread(probe, port_of(ps.get(s, {}))) for s in SERVICES))
        out = {}
        for s, m in zip(SERVICES, probes):
            c = ps.get(s, {})
            if s in self.remediating:
                st = "remediating"
            elif c.get("State") != "running" or m is None:
                st = "down"
            elif m.get("error_rate", 0) > 0.05:
                st = "degraded"
            else:
                st = "healthy"
            out[s] = {**(m or {}), "status": st, "container": c.get("Status", "not created"), **self.deploy_info(s)}
        return out

    async def logs(self, s, n):
        return (await self.compose("logs", "--no-color", "--no-log-prefix", "--tail", str(n), s)).splitlines()

    async def settle(self, s, timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            m = await asyncio.to_thread(probe, port_of((await self.ps()).get(s, {})))
            if m and m.get("error_rate", 0) <= 0.05:
                return True
            await asyncio.sleep(0.5)
        return False

    async def remediate(self, s, action, progress):
        self.remediating.add(s)
        try:
            if action == "rollback":
                bad, good = self.roll_back(s)
                await progress(f"rolling {s} back from {bad} to {good}")
                await self.compose("up", "-d", s)
            elif action == "restart":
                await progress(f"restarting {s}")
                await self.compose("restart", s)
            else:
                self.workers += 2
                await progress(f"scaling {s} to {self.workers} workers")
                await self.compose("up", "-d", s)
            ok = await self.settle(s, 10)
        finally:
            self.remediating.discard(s)
        await progress(f"{s} is {'healthy' if ok else 'still failing'}")
        if ok:  # dependents recover as their error windows clear
            await asyncio.gather(*(self.settle(d, 10) for d in SERVICES if d != s))
        return await self.result(action, s)

    async def follow(self, on_log):
        since = str(int(time.time()))
        while True:  # respawn if compose stops following
            proc = await asyncio.create_subprocess_exec(*COMPOSE, "-p", self.project, "logs", "-f", "--no-color",
                                                        "--since", since, env=self.env(), stdout=PIPE, stderr=DEVNULL)
            try:
                async for raw in proc.stdout:
                    name, sep, line = raw.decode(errors="replace").rstrip().partition(" | ")
                    s = next((s for s in SERVICES if name.strip().startswith(s)), None)
                    if sep and s:
                        await on_log(s, level(line), line)
            finally:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
            since = str(int(time.time()))
            await asyncio.sleep(0.5)

    async def sweep(self):
        """Tear down projects a crashed relay left behind; restart: always would keep them running forever."""
        for p in json.loads(await sh("docker", "compose", "ls", "-a", "--format", "json") or "[]"):
            if p["Name"].startswith("iv-") and p["Name"] not in DockerCluster.mine:
                await sh(*COMPOSE, "-p", p["Name"], "down", "--remove-orphans", "-t", "1")

    async def run(self, on_state, on_log):
        if len(DockerCluster.mine) >= MAX_DOCKER_CLUSTERS:
            raise RuntimeError("every demo cluster is busy; try again in a minute")
        DockerCluster.mine.add(self.project)
        if not DockerCluster.swept:
            DockerCluster.swept = True
            await self.sweep()
        await self.compose("up", "-d")
        follower = asyncio.create_task(self.follow(on_log))
        try:
            while True:
                try:
                    await on_state(await self.health())
                except RuntimeError as e:  # a transient compose hiccup shouldn't kill a recording take
                    print("health poll failed:", e)
                await asyncio.sleep(1)
        finally:
            follower.cancel()

    async def close(self):
        if self.project in DockerCluster.mine:
            DockerCluster.mine.discard(self.project)
            await self.compose("down", "--remove-orphans", "-t", "1")
