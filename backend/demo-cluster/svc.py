"""One demo-cluster service; ROLE picks which. Stdlib only, so the stock python image runs it with no build step."""
import json
import os
import sys
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROLE, VERSION = os.environ["ROLE"], os.environ["VERSION"]
AUTH_URL = "http://auth-service:8080/verify"
BAD_AUTH_VERSION = "v2.14.1"  # ships a JWKS parser that can't read the rotated signing key

calls = deque(maxlen=20)  # (ok, ms) for the last ~2 s of upstream calls
queue = {"depth": 0}
served = {"n": 0}
last_log = [0.0]


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
        queue["depth"] += 2  # ~20 charge jobs/s arrive
        if err := call_auth():
            log_sometimes(f"ERROR charge job failed: auth-service token verification unavailable ({err}); "
                          f"queue depth {queue['depth']}")
        else:
            queue["depth"] -= min(queue["depth"], 10 * workers)
        time.sleep(0.1)


def heartbeat():
    while True:
        time.sleep(5)
        log(f"INFO verified {served['n']} tokens in the last 5s")
        served["n"] = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # per-request access logs would drown the real signal
        pass

    def do_GET(self):
        if self.path == "/verify":
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
