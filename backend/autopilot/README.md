# Autopilot voice clips

Autopilot (F5) plays pre-recorded operator lines so judges and visitors can watch a full incident without a
microphone. The clips are **not committed**: they are generated from an online text-to-speech service, and
redistributing that audio is a licensing risk.

Generate them once, before running autopilot:

```bash
cd backend
uv run --with gtts python autopilot/gen_clips.py    # needs ffmpeg on PATH
```

This writes one PCM clip per authorization code word, plus the `prefix` clip, into `clips/`.

**For the demo video, record these lines yourself.** A real voice sounds better than synthesis, and it removes
the licensing question entirely. Keep the same filenames, mono PCM16 at 24 kHz.
