// Plays queued 24kHz 16-bit PCM from Gemini. Main thread posts Int16 buffers;
// this processor keeps a sample queue and streams it out gaplessly.
// Posting the string "flush" clears the queue instantly (used for interruptions).
class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];      // array of Float32Array chunks
    this.readIndex = 0;   // read offset into queue[0]
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        this.queue = [];
        this.readIndex = 0;
        return;
      }
      // e.data is an ArrayBuffer of Int16 samples
      const int16 = new Int16Array(e.data);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        f32[i] = int16[i] / 0x8000;
      }
      this.queue.push(f32);
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const channel = output[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      if (this.queue.length === 0) {
        channel[i] = 0;
        continue;
      }
      const current = this.queue[0];
      channel[i] = current[this.readIndex++];
      if (this.readIndex >= current.length) {
        this.queue.shift();
        this.readIndex = 0;
      }
    }

    // Tell the main thread whether we are still producing sound (for the orb state).
    const playing = this.queue.length > 0;
    if (playing !== this._lastPlaying) {
      this._lastPlaying = playing;
      this.port.postMessage({ playing });
    }
    return true;
  }
}

registerProcessor("player-processor", PlayerProcessor);
