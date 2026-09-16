# Security policy

AyeOps sits in the authorization path for production changes, so we take reports seriously.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a
public issue for anything exploitable.

We aim to acknowledge within **72 hours** and to agree a disclosure timeline with you.

## What we consider in scope

- Any way to make a production change execute **without** a human reading the authorization code aloud.
- Any way to get the one-time code **into the model's context**, or to obtain it as the agent.
- Prompt injection that changes what the operator is told they're approving.
- Authentication bypass on the external agent endpoint (`/api/agent-requests`).
- Leaks of session recordings, transcripts or incident records.

## Known limitations (not vulnerabilities, but real)

These are design limits we state openly rather than defects to report:

- **Voice is one factor.** A cloned voice reading a code shown on a compromised screen would pass. Speaker
  verification is on the roadmap, not implemented.
- **Logs feed the model's context.** Whoever controls a log line can influence what the agent *proposes*. It
  cannot execute anything, and the operator sees the exact change before authorizing, but the risk is real.
- **The demo cluster is simulated** unless `INFRA=docker`, and even then it is a local sandbox, not your
  infrastructure.
- **No multi-tenant isolation or user accounts yet.** Deploy it where only your team can reach it.

## Handling secrets

`ASSEMBLYAI_API_KEY` lives only in `backend/.env`, which is gitignored and has never been committed. Recordings
and incident records under `backend/incidents/` are gitignored as well: they contain voice.
