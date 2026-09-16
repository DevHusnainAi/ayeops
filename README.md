<div align="center">
  <img src="docs/brand/banner.svg" alt="AyeOps — voice-authorized incident command" width="100%" />
</div>

<p align="center">
It pages you when production breaks, diagnoses the cause on its own, and then asks for something no
language model can fake: your voice, reading a one-time code it has never seen.
</p>

<p align="center">
<sub>
<strong>Blind</strong> — the approval code never enters the model's context &nbsp;·&nbsp;
<strong>Voiced</strong> — a human reads the change back to prove they understood it &nbsp;·&nbsp;
<strong>Refuses</strong> — declines a fix it already knows won't hold, and says why &nbsp;·&nbsp;
<strong>Logged</strong> — every authorization ships with a recording and a timeline
</sub>
</p>

<p align="center">
Built on the <a href="https://www.assemblyai.com/docs/voice-agents/voice-agent-api">AssemblyAI Voice Agent API</a>.
</p>

<p align="center">
<a href="https://github.com/DevHusnainAi/ayeops/actions/workflows/ci.yml"><img src="https://github.com/DevHusnainAi/ayeops/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0"/></a>
</p>

---

## Table of contents

- [Quick start](#quick-start)
- [The problem is not speed](#the-problem-is-not-speed)
- [What happens in a run](#what-happens-in-a-run)
- [Measured](#measured)
- [Competitors](#competitors)
- [Security posture](#security-posture)
- [Status](#status)
- [Learn more](#learn-more)

---

## Quick start

**Prerequisites:** [uv](https://docs.astral.sh/uv/) for the backend, an
[AssemblyAI API key](https://www.assemblyai.com/dashboard/signup), and Node.js if you want the dashboard
(skip it to talk to the relay directly over WebSocket).

```bash
git clone https://github.com/DevHusnainAi/ayeops.git && cd ayeops

echo "ASSEMBLYAI_API_KEY=your-key-here" > backend/.env

# build the dashboard once -- the relay serves it from web/out
cd web && npm install && npm run build && cd ..

cd backend
uv run --env-file .env relay.py                  # in-memory cluster, one per browser tab
# INFRA=docker uv run --env-file .env relay.py   # real containers instead, one project per session
```

Open **http://127.0.0.1:8000** and click **Start session** (headphones on, so the mic doesn't hear the
agent), or **Run the demo for me** for the unattended, no-mic autopilot walkthrough.

```bash
uv run test_relay.py                                                # offline self-check, prints "ok"
INFRA=docker uv run --env-file .env --with gtts python live_e2e.py  # full live rehearsal (~90 s, uses API credit)
```

`INFRA=docker` needs Docker running and the `python:3.13-slim` image pulled ahead of time — a missing
base image looks exactly like a broken cluster.

**Environment:** `INFRA` (sim|docker), `ALLOWED_ORIGINS`, `MAX_SESSION_S`, `MAX_DOCKER_CLUSTERS`,
`INCIDENT_DIR`, `AAI_URL`.

---

## The problem is not speed

The obvious pitch for an AI incident responder is *"mean time to resolution drops from [the 101-minute
industry median](https://stackgen.com/blog/10-sre-best-practices-for-reducing-mttr-in-2026) to 40 seconds."*
That pitch is real, for this incident's shape — and it is the least interesting thing here.

The actual problem with 3am incident response is that the on-call engineer is **impaired, alone, and
unaccountable**:

- **Impaired.** A large share of severe outages are prolonged by the *remediation*, not the fault. The
  tired human applies the wrong fix and extends the outage.
- **Alone.** There is no second pair of eyes at 3am. Change-approval process is precisely what gets
  bypassed during a Sev-1.
- **Unaccountable.** The record gets written hours later, from memory, by the person with the strongest
  incentive to be generous to themselves.

This is why AI ops tools stall in procurement. They don't stall because they're slow. They stall because
**nobody can prove who authorized what.** An LLM that can restart production is an audit finding.

AyeOps is built as the answer to that: not a faster hand, but a **sober second party** that does
the thinking you can't do at 3am, makes fat-fingering production structurally impossible, and produces the
record nobody would otherwise write.

---

## What happens in a run

1. Three services run healthy. The agent is watching, silent.
2. A bad deploy ships — `auth-service v2.14.1`, whose JWKS parser can't read the rotated signing key. It
   crash-loops for real. `api-gateway` starts returning real 502s. `billing-worker`'s queue backs up.
3. **The agent speaks first.** It pages you — it does not wait to be asked — and immediately begins
   read-only triage on its own authority.
4. It diagnoses the root cause from a single enriched health call and proposes exactly one fix.
5. **Your screen shows a two-word code — `LIMA CHARLIE`.** The model cannot see it.
6. You read it aloud. The *relay*, not the model, verifies it and executes precisely the authorized change.
7. The agent narrates the rollout. Everything goes green.
8. A postmortem is filed containing the verbatim authorization, and AssemblyAI's two-channel recording and
   turn timeline are downloaded next to it as evidence.
9. Ask *"What happened?"* and it answers from the verified record — not from its own recollection.

Mid-incident, the demo can **cut the AssemblyAI connection on purpose**. The relay is back in under two
seconds with full context, and the pending authorization still works.

---

## Measured

On real Docker containers, against the real API, including a deliberate mid-incident link cut:

| Metric | Result |
|---|---|
| Bad deploy → all green | **29 s** |
| Turn latency | **0.84–1.09 s** |
| Recovery from connection loss | **1.8 s**, context intact |
| Cluster boot → healthy | 5.0 s |
| Injected fault → visible | 2.6 s |
| Rollback → all green | 4.1 s |

*Time to recover runs from incident **detection** to all-green. Latency is measured from the operator's
last voiced mic frame — the honest method, not the flattering one.*

---

## Competitors

| Category | Representative | What they do well | What's missing |
|---|---|---|---|
| **Incident management platforms** | PagerDuty SRE Agent (Aug 2026), incident.io, Rootly | Alerting, on-call rotation, AI-drafted fixes as a PR | Approval is a **GitHub click**. Nothing proves a present human read it, understood it, or is even the person on call. |
| **AI SRE agents** | Cleric, Resolve.ai, k8sgpt, Dynatrace Autonomous Operations (Jul 2026) | Autonomous investigation and root-cause analysis | Largely **read-only or advisory** — precisely because the authorization problem is unsolved. The hard part isn't diagnosis, it's permission. |
| **ChatOps** | Slack bots, Backstage actions | Execute real operations from chat | Identity = an API token. No liveness, no anti-impersonation, no proof a *human* acted. |
| **Voice agent demos** | The typical hackathon entry | Natural conversation | Nothing irreversible ever happens, so no authorization model is needed — or built. |

**Where AyeOps sits:** every one of these gates a change with a click, a token, or nothing at all. None of
them prove a *present* human understood *this specific* change — they prove a channel was live, which is a
different and weaker claim. AyeOps is a working implementation of the pattern the IETF's WIMSE working group,
OpenID's CIBA, and MCP's elicitation mode are all independently converging on right now — out-of-band
authorization the agent can't forge from inside its own context — built specifically for voice, with one
addition none of those protocols require: the operator has to say back what they're approving, not just
approve it.

Everyone else is racing to make the agent **faster**. The bottleneck in production isn't speed — it's that
no one will grant an LLM write access to infrastructure. AyeOps is built around that constraint
instead of against it: reads are autonomous, writes require a live human voice reading a secret the model
cannot access, and every change leaves a postmortem record with the verbatim authorization and audio attached.

---

## Security posture

- The approval code is **one-time, expires in 120 seconds, and never reaches the model** — it's shown only
  on the operator's screen, checked only by the relay.
- Any change is **vetoable** at any point by saying "no," "cancel," "stop," or "wait."
- The AssemblyAI API key lives only in the relay; the browser can't send config, forge a tool result, or
  forge an authorization.
- Every authorized change ships with the verbatim readback, a two-channel recording, and a turn-by-turn
  timeline — [more in the engineering deep-dive](docs/ENGINEERING.md).

---

## Limitations

Stated up front, because the whole point is trustworthy authorization:

- **Voice is one factor, not proof of a person.** A cloned voice reading a code from a compromised screen would
  pass. Speaker verification is on the roadmap and not implemented.
- **Logs reach the model's context.** Whoever controls a log line can influence what the agent *proposes*. It
  still cannot execute anything, and you see the exact change before authorizing, but the risk is real: the
  demo deliberately includes this attack.
- **The demo cluster is a sandbox.** `INFRA=sim` is in memory; `INFRA=docker` runs real containers locally.
  Neither touches your infrastructure.
- **No accounts, roles or tenant isolation yet.** Run it where only your team can reach it.
- **`session.resume` never worked against the live API** in 11 variants we tried, so the relay recovers by
  opening a new session briefed from its own incident record instead.

See [SECURITY.md](SECURITY.md) to report anything exploitable.

---

## Status

**Backend and dashboard: complete and live-verified.** Offline self-check plus a full live rehearsal
driver that synthesizes the operator's voice, so the whole demo is reproducible without a human in the
room. Built and tested, not just planned:

- **The Next.js/Tailwind dashboard** — full event protocol implemented, live-verified end to end
- **Phase-scoped tools** — least privilege enforced by the platform: `propose_remediation` doesn't exist
  in the model's schema outside an open incident window, added and removed with `session.update`
- **The refusal** — the relay declines a remediation it already knows will fail (a restart on a service
  crash-looping from a bad deploy) and points the model at the fix that will, with the evidence attached
- **Blast radius stated aloud** before the authorization code arms, when the change affects anything else

**Roadmap — not yet built:**

- A deployed HTTPS URL
- The repo goes public at submission (CI already runs on every push; no badge row here on purpose — nothing
  to show yet is more honest than a row of placeholders)

---

## Learn more

- [**Engineering deep-dive**](docs/ENGINEERING.md) — the design history, the architecture diagram, every
  AssemblyAI Voice Agent API surface in use, and what real infrastructure the demo actually runs against.
