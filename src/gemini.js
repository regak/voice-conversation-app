import { GoogleGenAI, Modality } from "@google/genai";

// ---- Configuration -----------------------------------------------------------
// Model name is isolated here so it is trivial to swap as Google rotates models.
// As of this build, Google's recommended low-latency Live model:
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
export const VOICE_NAME = "Aoede"; // warm, natural prebuilt voice
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// ---- Tool declarations -------------------------------------------------------
// Custom functions the model may call. The actual implementations live in the
// app (passed in as `toolHandlers`) so they can touch the UI. This keeps
// declaration (here) and behavior (App) cleanly separated.
export const FUNCTION_DECLARATIONS = [
  {
    name: "set_theme_color",
    description:
      "Change the app's accent/orb color to match a mood or the user's request. " +
      "Use when the user asks to change the color, theme, or vibe of the interface.",
    parameters: {
      type: "OBJECT",
      properties: {
        color: {
          type: "STRING",
          description:
            "A CSS color — a hex value like '#ff5577' or a common name like 'teal', 'sunset orange', 'calm blue'.",
        },
      },
      required: ["color"],
    },
  },
  {
    name: "get_current_time",
    description:
      "Get the user's current local date and time. Use when the user asks what " +
      "time or date it is.",
    parameters: {
      type: "OBJECT",
      properties: {
        timezone: {
          type: "STRING",
          description: "Optional IANA timezone, e.g. 'Africa/Nairobi'. Omit for the user's local time.",
        },
      },
    },
  },
  {
    name: "play_youtube",
    description:
      "Play a YouTube video inside the app. Use when the user asks to play, watch, " +
      "or put on a video, song, or music video. Provide a search query describing " +
      "what to play (preferred), OR a direct YouTube URL / video ID if the user gave one.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description:
            "What to play, e.g. 'lofi hip hop radio', 'Queen Bohemian Rhapsody official video'.",
        },
        video_url: {
          type: "STRING",
          description:
            "Optional direct YouTube URL or 11-character video ID, if the user supplied one.",
        },
      },
    },
  },
  {
    name: "open_url",
    description:
      "Open a website in a new browser tab. Use when the user asks to open, go to, " +
      "or visit a specific website or page.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "The full URL to open, e.g. 'https://github.com'. Add https:// if missing.",
        },
      },
      required: ["url"],
    },
  },
];

// Built-in + custom tools passed to the Live session.
export const TOOLS = [
  { googleSearch: {} }, // real-time web grounding, no backend needed
  { functionDeclarations: FUNCTION_DECLARATIONS },
];

function base64FromArrayBuffer(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function arrayBufferFromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Manages one Gemini Live voice session: mic -> API -> speaker, with
 * barge-in (interruption) handling. All lifecycle is controlled via
 * start()/stop(). Status/state changes surface through the callbacks passed in.
 */
export class VoiceSession {
  constructor({ apiKey, onStatus, onState, onError, onTranscript, onToolCall, toolHandlers }) {
    this.apiKey = apiKey;
    this.onStatus = onStatus || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    // onTranscript({ role: "user" | "assistant", text, final }) — streamed text.
    this.onTranscript = onTranscript || (() => {});
    // onToolCall({ name, args, result }) — surfaced for UI display/logging.
    this.onToolCall = onToolCall || (() => {});
    // toolHandlers: { [name]: async (args) => resultObject } — custom tool impls.
    this.toolHandlers = toolHandlers || {};

    this.ai = null;
    this.session = null;
    this.inputCtx = null;
    this.outputCtx = null;
    this.recorderNode = null;
    this.playerNode = null;
    this.micStream = null;
    this.running = false;
  }

  async start() {
    if (this.running) return;
    if (!this.apiKey) {
      this.onError("Missing API key. Add VITE_GEMINI_API_KEY to your .env file.");
      return;
    }
    this.running = true;
    this.onStatus("Requesting microphone…");

    try {
      // 1. Microphone
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Audio graph — separate contexts for the two sample rates.
      this.inputCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      this.outputCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      await this.inputCtx.audioWorklet.addModule("/recorder-processor.js");
      await this.outputCtx.audioWorklet.addModule("/player-processor.js");

      this.playerNode = new AudioWorkletNode(this.outputCtx, "player-processor");
      this.playerNode.connect(this.outputCtx.destination);
      this.playerNode.port.onmessage = (e) => {
        if (e.data && typeof e.data.playing === "boolean") {
          this.onState(e.data.playing ? "speaking" : "listening");
        }
      };

      const source = this.inputCtx.createMediaStreamSource(this.micStream);
      this.recorderNode = new AudioWorkletNode(this.inputCtx, "recorder-processor");
      source.connect(this.recorderNode);
      // Do NOT connect recorder to destination (avoids echo/feedback).

      this.onStatus("Connecting to Gemini…");

      // 3. Live session
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      this.session = await this.ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          tools: TOOLS,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          },
          systemInstruction: {
            parts: [
              {
                text:
                  "You are a warm, concise voice companion. Speak naturally and " +
                  "conversationally. Keep responses brief unless asked to elaborate. " +
                  "You can be interrupted at any time — if the user starts speaking, " +
                  "stop and listen.",
              },
            ],
          },
        },
        callbacks: {
          onopen: () => {
            this.onStatus("Listening… start talking");
            this.onState("listening");
          },
          onmessage: (msg) => this._handleMessage(msg),
          onerror: (e) => this.onError(e?.message || "Connection error"),
          onclose: (e) => {
            if (this.running) this.onStatus("Connection closed" + (e?.reason ? `: ${e.reason}` : ""));
          },
        },
      });

      // 4. Pump mic chunks to the API once connected.
      this.recorderNode.port.onmessage = (e) => {
        if (!this.session || !this.running) return;
        const data = base64FromArrayBuffer(e.data);
        try {
          this.session.sendRealtimeInput({
            audio: { data, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
          });
        } catch {
          /* session may be mid-teardown */
        }
      };
    } catch (err) {
      this.running = false;
      const name = err?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        this.onError("Microphone permission denied. Allow mic access and try again.");
      } else {
        this.onError(err?.message || String(err));
      }
      await this.stop();
    }
  }

  _handleMessage(msg) {
    // Tool calls arrive at the top level, not under serverContent.
    if (msg.toolCall?.functionCalls?.length) {
      this._handleToolCall(msg.toolCall.functionCalls);
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    // Barge-in: server tells us the user interrupted — flush queued playback.
    if (sc.interrupted) {
      this.playerNode?.port.postMessage("flush");
      this.onState("listening");
      return;
    }

    // Streaming transcripts (incremental text fragments).
    if (sc.inputTranscription?.text) {
      this.onTranscript({ role: "user", text: sc.inputTranscription.text, final: false });
    }
    if (sc.outputTranscription?.text) {
      this.onTranscript({ role: "assistant", text: sc.outputTranscription.text, final: false });
    }
    // End of a turn — commit both pending transcripts as final lines.
    if (sc.turnComplete) {
      this.onTranscript({ role: "user", text: "", final: true });
      this.onTranscript({ role: "assistant", text: "", final: true });
    }

    const parts = sc.modelTurn?.parts || [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data && inline.mimeType?.startsWith("audio/")) {
        const buf = arrayBufferFromBase64(inline.data);
        this.playerNode?.port.postMessage(buf, [buf]);
      }
    }
  }

  // Execute each requested function and send results back so the model can speak them.
  async _handleToolCall(functionCalls) {
    const functionResponses = [];
    for (const call of functionCalls) {
      const { id, name, args } = call;
      let result;
      try {
        const handler = this.toolHandlers[name];
        if (!handler) {
          result = { error: `No handler registered for function "${name}".` };
        } else {
          result = await handler(args || {});
        }
      } catch (err) {
        result = { error: err?.message || String(err) };
      }
      this.onToolCall({ name, args: args || {}, result });
      functionResponses.push({ id, name, response: result });
    }
    try {
      this.session?.sendToolResponse({ functionResponses });
    } catch {
      /* session may be mid-teardown */
    }
  }

  async stop() {
    this.running = false;
    try {
      this.session?.close();
    } catch { /* ignore */ }
    this.session = null;

    if (this.recorderNode) {
      this.recorderNode.port.onmessage = null;
      this.recorderNode.disconnect();
      this.recorderNode = null;
    }
    if (this.playerNode) {
      this.playerNode.port.postMessage("flush");
      this.playerNode.disconnect();
      this.playerNode = null;
    }
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;

    if (this.inputCtx && this.inputCtx.state !== "closed") {
      await this.inputCtx.close().catch(() => {});
    }
    if (this.outputCtx && this.outputCtx.state !== "closed") {
      await this.outputCtx.close().catch(() => {});
    }
    this.inputCtx = null;
    this.outputCtx = null;
  }
}
