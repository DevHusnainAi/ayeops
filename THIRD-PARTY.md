# Third-party notices

AyeOps bundles or depends on the following. Licences are as published by each project; check the upstream
project for the authoritative text.

## Fonts (embedded in the built dashboard)

| Font | Licence |
|---|---|
| Atkinson Hyperlegible Next | SIL Open Font License 1.1 |
| Atkinson Hyperlegible Mono | SIL Open Font License 1.1 |
| Big Shoulders | SIL Open Font License 1.1 |

The fonts are fetched and self-hosted at build time by `next/font`. The OFL requires that this notice travels
with any distribution that includes the font files.

## Runtime dependencies

| Project | Licence |
|---|---|
| FastAPI | MIT |
| Uvicorn | BSD-3-Clause |
| websockets | BSD-3-Clause |
| Next.js | MIT |
| React | MIT |
| Tailwind CSS | MIT |
| `python:3.13-slim` image (demo cluster) | PSF licence, plus Debian base packages |

## Development-only

| Project | Licence | Used for |
|---|---|---|
| gTTS | MIT | Generating the autopilot voice clips (`backend/autopilot/gen_clips.py`) |
| ffmpeg | LGPL/GPL | Converting those clips to PCM |

The generated audio itself comes from an online text-to-speech service; see `backend/autopilot/README.md` for
how to produce the clips locally.

## Brand

The AyeOps name, logo, wordmark and banner (`docs/brand/`) are **not** covered by the code licence.
