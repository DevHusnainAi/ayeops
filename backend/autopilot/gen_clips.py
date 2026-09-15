"""One-time generator for autopilot's pre-recorded operator clips (F5). Not needed at runtime, and not imported
by relay.py -- keeps gTTS/ffmpeg out of the production dependency set.
Run: uv run --with gtts python autopilot/gen_clips.py"""
import io
import subprocess
from pathlib import Path

from gtts import gTTS

OUT = Path(__file__).parent / "clips"
OUT.mkdir(exist_ok=True)

# Mirrors relay.CODE_WORDS; duplicated rather than imported so this script has no relay.py import-time
# dependency on ASSEMBLYAI_API_KEY.
CODE_WORDS = ["alpha", "bravo", "charlie", "delta", "foxtrot", "golf", "hotel", "kilo",
              "lima", "mike", "oscar", "papa", "romeo", "sierra", "tango", "victor"]


def render(text, name):
    mp3 = io.BytesIO()
    gTTS(text, lang="en").write_to_fp(mp3)
    pcm = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "24000", "pipe:1"],
        input=mp3.getvalue(), capture_output=True, check=True,
    ).stdout
    (OUT / f"{name}.pcm").write_bytes(pcm)
    print(f"  {name}.pcm  ({len(pcm)} bytes)")


if __name__ == "__main__":
    render("Roll back auth service,", "prefix")
    for w in CODE_WORDS:
        render(w, w)
    print(f"wrote {len(CODE_WORDS) + 1} clips to {OUT}")
