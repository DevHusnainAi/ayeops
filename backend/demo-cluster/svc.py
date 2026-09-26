"""One demo-cluster service; ROLE picks which. Stdlib only, so the stock python image runs it with no build step."""
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROLE, VERSION = os.environ["ROLE"], os.environ["VERSION"]
AUTH_URL = "http://auth-service:8080/verify"
RATE = int(os.environ.get("RATE", "1"))  # billing arrival multiplier: 8 is a traffic spike one worker cannot drain
BAD_AUTH_VERSION = "v2.14.1"  # ships a JWKS parser that can't read the rotated signing key

calls = deque(maxlen=20)  # (ok, ms) for the last ~2 s of upstream calls
queue = {"depth": 0}
served = {"n": 0}
last_log = [0.0]
wedged = threading.Event()  # set by POST /_fault?mode=wedge; lives in this process, so a restart clears it
BACKLOG = 150  # queue depth past which billing reports itself unhealthy


def log(line):
    print(time.strftime("%H:%M:%S"), line, flush=True)


def log_sometimes(line):  # an outage fires these 10x/s; two lines a second is plenty
    if time.monotonic() - last_log[0] > 0.5:
        last_log[0] = time.monotonic()
        log(line)


def call_auth():
    t0 = time.perf_counter()
    try:
        urllib.request.urlopen(AUTH_URL, timeout=0.5).read()
        err = None
    except Exception as e:
        err = getattr(e, "reason", e)
    calls.append((err is None, (time.perf_counter() - t0) * 1000))
    return err


def gateway():
    while True:
        if err := call_auth():
            log_sometimes(f"ERROR 502 GET /v1/checkout upstream=auth-service: {err}")
        time.sleep(0.1)


def billing():
    workers = int(os.environ.get("WORKERS", "1"))
    while True:
        queue["depth"] += 2 * RATE  # ~20 charge jobs/s arrive normally
        if err := call_auth():
            log_sometimes(f"ERROR charge job failed: auth-service token verification unavailable ({err}); "
                          f"queue depth {queue['depth']}")
        else:
            queue["depth"] -= min(queue["depth"], 10 * workers)
            if queue["depth"] > BACKLOG:
                if 20 * RATE > 100 * workers:  # arrivals outrun the workers: a real backlog
                    log_sometimes(f"ERROR consumer lag {queue['depth'] // 50}s: queue depth {queue['depth']}; arrivals "
                                  f"{20 * RATE} jobs/s exceed what {workers} worker(s) drain ({100 * workers}/s)")
                else:  # a leftover queue, already draining
                    log_sometimes(f"INFO draining backlog: queue depth {queue['depth']}, "
                                  f"{100 * workers - 20 * RATE} jobs/s faster than arrivals")
        time.sleep(0.1)


def workers_now():
    return int(os.environ.get("WORKERS", "1"))


def wedge_noise():
    while wedged.is_set():
        log("ERROR verify timeout after 5000ms: session-cache connection pool exhausted (0/10 free, 212 waiters)")
        log("WARN goroutines=4812 and climbing; heap 1.9GB (limit 2GB)")
        time.sleep(2)


def heartbeat():
    while True:
        time.sleep(5)
        log(f"INFO verified {served['n']} tokens in the last 5s")
        served["n"] = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # per-request access logs would drown the real signal
        pass

    def do_POST(self):  # demo control, reachable only inside the session's own compose network / localhost port
        if ROLE == "auth" and self.path.startswith("/_log?text="):  # a visitor's own line, into this container's log
            log("ERROR auth-service: " + urllib.parse.unquote(self.path[len("/_log?text="):])[:200].replace("\n", " "))
            self.send_response(204)
        elif ROLE == "auth" and self.path == "/_fault?mode=wedge" and not wedged.is_set():
            wedged.set()
            threading.Thread(target=wedge_noise, daemon=True).start()
            self.send_response(204)
        else:
            self.send_response(404)
        self.end_headers()

    def do_GET(self):
        if self.path == "/verify":
            if wedged.is_set():  # hang past every caller's timeout, and never answer
                time.sleep(1)
                return
            served["n"] += 1
            body = {"ok": True}
        elif self.path == "/healthz":
            window = list(calls)
            lat = sorted(ms for _, ms in window)
            body = {"version": VERSION,
                    "error_rate": round(sum(not ok for ok, _ in window) / len(window), 2) if window else 0.0,
                    "p99_ms": round(lat[-1]) if lat else 0}  # ponytail: max of ~20 samples stands in for p99
            if ROLE == "billing":
                body["queue_depth"] = queue["depth"]
                if queue["depth"] > BACKLOG and 20 * RATE > 100 * workers_now():  # only while it is still growing
                    body["error_rate"] = max(body["error_rate"], 0.5)
                    body["p99_ms"] = max(body["p99_ms"], queue["depth"] * 20)
            if wedged.is_set():
                body["error_rate"], body["p99_ms"] = 1.0, 5000
        else:
            self.send_error(404)
            return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    log(f"INFO {ROLE} {VERSION} starting")
    if ROLE == "auth":
        log("INFO loading JWKS signing keys kid=prod-2026-09")
        time.sleep(0.5)
        if VERSION == BAD_AUTH_VERSION:
            log("FATAL jwks: failed to parse signing key kid=prod-2026-09: unexpected nil *rsa.PublicKey")
            log("panic: runtime error: invalid memory address or nil pointer dereference [token/verify.go:88]")
            sys.exit(2)
    threading.Thread(target={"auth": heartbeat, "gateway": gateway, "billing": billing}[ROLE], daemon=True).start()
    log("INFO ready on :8080")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
