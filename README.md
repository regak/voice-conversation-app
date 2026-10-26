# Voice Conversation App (voice-orb)

A real-time, voice-to-voice companion built on the **Gemini Live API**. Speak
naturally, get spoken replies, interrupt anytime (barge-in), see live
transcripts, and let the assistant call tools — search the web, play YouTube,
open links, change the UI, and more.

![Status](https://img.shields.io/badge/stage-in%20development-blue)

## Features

- 🎙️ **Real-time voice conversation** — bidirectional streaming audio via Gemini Live
- ✋ **Interruptible (barge-in)** — start talking and the assistant stops to listen
- 📝 **Live transcripts** — see both sides of the conversation as it happens
- 🟢 **Animated orb** — idle / listening / speaking states
- 🔧 **Tool calling**:
  - `googleSearch` — real-time web grounding (built in, no backend)
  - `play_youtube` — plays a video inside the app
  - `open_url` — opens a site in a new tab
  - `set_theme_color` — recolor the UI by voice
  - `get_current_time` — local date & time

## Tech stack

React + Vite · `@google/genai` · Web Audio API (AudioWorklets for 16 kHz capture
and 24 kHz playback) · lucide-react icons.

## Getting started

```bash
npm install
cp .env.example .env     # then paste your key into .env
npm run dev
```

Get a Gemini API key at <https://aistudio.google.com/apikey> and set it in `.env`:

```
VITE_GEMINI_API_KEY=your_api_key_here
```

Open the printed localhost URL, click **Start talking**, and allow microphone access.

## Project layout

| Path | Purpose |
|---|---|
| `src/gemini.js` | `VoiceSession` — mic ↔ Gemini ↔ speaker, tools, transcripts, barge-in |
| `src/App.jsx` | UI, orb states, transcript, tool handlers |
| `public/recorder-processor.js` | AudioWorklet: mic → 16-bit PCM @ 16 kHz |
| `public/player-processor.js` | AudioWorklet: gapless 24 kHz playback + flush on interrupt |

The Live model is set as `LIVE_MODEL` at the top of `src/gemini.js` — a one-line
swap as Google rotates model names.

## ⚠️ Security note

With Vite, any `VITE_*` variable is **bundled into the client build and visible
in the browser**. This is fine for **local development only**. Do **not** deploy
this publicly with a real key — mint short-lived ephemeral tokens from a backend
instead. `.env` is git-ignored; only `.env.example` (a placeholder) is tracked.

## License

MIT
