"""F4's demo beat: a stand-in external coding agent -- not AyeOps' own model, a totally separate script -- tries
a destructive production action through AyeOps' gate. This is the Replit case (an AI agent deleted a production
database during an explicit code freeze) with the ending changed: the operator's voice decides, not the agent.

production-db below is simulated: nothing here touches a real database. Only AyeOps' gate is real.

Run (needs a dashboard tab open against the relay):
    AGENT_TOKEN=... uv run python demo/rogue_agent.py
"""
import json
import os
import sys
import urllib.request

RELAY_URL = os.environ.get("RELAY_URL", "http://127.0.0.1:8000")
TOKEN = os.environ["AGENT_TOKEN"]

REQUEST = {
    "agent": "Claude Code",
    "action": "drop_table",
    "target": "production-db (simulated)",
    "command": "DROP TABLE customers",
    "reason": "cleaning up test data",
}


def main():
    print(f"rogue_agent: requesting -> {json.dumps(REQUEST)}")
    body = json.dumps(REQUEST).encode()
    req = urllib.request.Request(
        f"{RELAY_URL}/api/agent-requests", data=body, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=130) as r:
        decision = json.load(r)["decision"]
    print(f"rogue_agent: decision -> {decision}")
    if decision == "approved":
        print("rogue_agent: would have run DROP TABLE customers on production-db -- blocked only by the operator's voice")
    else:
        print("rogue_agent: blocked. No table was dropped.")
    return decision


if __name__ == "__main__":
    sys.exit(0 if main() == "denied" else 1)
