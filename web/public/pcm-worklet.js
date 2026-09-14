// Mic capture for the Voice Agent API: resample the context's native rate to 24 kHz mono PCM16 and post 50 ms
// frames. Resampling here, instead of forcing AudioContext({ sampleRate: 24000 }), keeps Firefox and Safari
// echo cancellation working (AssemblyAI troubleshooting guide).
// ponytail: linear interpolation with no low-pass filter; speech sits below 8 kHz, add a filter if aliasing is audible.
class Pcm24kCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000; // `sampleRate` is a global in the worklet scope
    this.pos = 0; // read position in the current block; -1 means the previous block's last sample
    this.prev = 0;
    this.out = new Int16Array(1200); // 50 ms at 24 kHz
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const len = ch.length;
    let pos = this.pos;
    while (pos < len - 1) {
      const i = Math.floor(pos);
      const s0 = i < 0 ? this.prev : ch[i];
      const v = Math.max(-1, Math.min(1, s0 + (ch[i + 1] - s0) * (pos - i)));
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (Math.abs(v) > this.peak) this.peak = Math.abs(v);
      if (this.n === this.out.length) {
        this.port.postMessage({ pcm: this.out.buffer, level: this.peak }, [this.out.buffer]);
        this.out = new Int16Array(1200);
        this.n = 0;
        this.peak = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - len;
    this.prev = ch[len - 1];
    return true;
  }
}

registerProcessor("pcm24k-capture", Pcm24kCapture);
