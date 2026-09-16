# Contributing

Thanks for looking. AyeOps is small on purpose, and the bar for adding code is high.

## Run it locally

See **Quick start** in the [README](README.md). The short version:

```bash
echo "ASSEMBLYAI_API_KEY=your-key" > backend/.env
cd web && npm install && npm run build && cd ../backend
uv run --env-file .env relay.py     # http://127.0.0.1:8000
```

## Before you open a pull request

```bash
cd backend && uv run test_relay.py   # offline self-check, prints "ok"
cd web && npm run build              # type-checks the dashboard
```

CI runs both on every push and pull request, and must be green.

## What we look for

- **Small and direct.** The simplest thing that works, with the standard library before a dependency. New
  dependencies need a reason in the pull request.
- **Tests for anything non-trivial.** Especially anything touching the authorization path.
- **Never weaken the gate.** The one-time code must never reach the model's context, and only the relay may
  execute a change. A change that breaks either of those will be declined however convenient it is.
- **Honest claims.** If you add a number to the README, say where it came from.

## Reporting bugs

Open an issue with what you did, what happened and what you expected. For anything security-related, follow
[SECURITY.md](SECURITY.md) instead.
