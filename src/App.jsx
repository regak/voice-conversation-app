import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2, AudioLines } from "lucide-react";
import { VoiceSession } from "./gemini";
import "./App.css";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const KEY_READY = API_KEY && API_KEY !== "your_api_key_here";

export default function App() {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // voiceState: "idle" | "listening" | "speaking"
  const [voiceState, setVoiceState] = useState("idle");
  const [status, setStatus] = useState(
    KEY_READY ? "Ready when you are" : "Add your API key to .env to begin"
  );
  const [error, setError] = useState("");
  // Committed conversation turns: [{ id, role, text }]
  const [transcript, setTranscript] = useState([]);
  // Last tool invocation, for a small UI indicator.
  const [lastTool, setLastTool] = useState(null);
  // Inline YouTube player: { src, label } or null.
  const [player, setPlayer] = useState(null);
  // URL we tried to open (shown as a clickable fallback if the popup was blocked).
  const [openedUrl, setOpenedUrl] = useState(null);
  const sessionRef = useRef(null);
  // Accumulate streaming fragments until a turn completes.
  const pendingRef = useRef({ user: "", assistant: "" });
  const transcriptEndRef = useRef(null);

  function handleTranscript({ role, text, final }) {
    const key = role === "user" ? "user" : "assistant";
    if (!final) {
      pendingRef.current[key] += text;
      // Force a re-render so the live (in-progress) line updates.
      setTranscript((prev) => [...prev]);
      return;
    }
    // Commit the accumulated text as a finished turn.
    const committed = pendingRef.current[key].trim();
    pendingRef.current[key] = "";
    if (committed) {
      setTranscript((prev) => [
        ...prev,
        { id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: key, text: committed },
      ]);
    }
  }

  // Auto-scroll transcript to the newest line.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  // ---- Custom tool implementations (client-side) ----------------------------
  // These are the functions the model can call. Returned objects are sent back
  // to Gemini so it can speak a natural confirmation.
  const toolHandlers = {
    set_theme_color: ({ color }) => {
      if (!color) return { ok: false, message: "No color provided." };
      // Apply to the orb + accent via a CSS variable + a data attribute.
      document.documentElement.style.setProperty("--user-accent", color);
      document.documentElement.setAttribute("data-custom-accent", "true");
      return { ok: true, applied_color: color, message: `Accent color changed to ${color}.` };
    },
    get_current_time: ({ timezone } = {}) => {
      try {
        const opts = {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        };
        if (timezone) opts.timeZone = timezone;
        const formatted = new Intl.DateTimeFormat("en-GB", opts).format(new Date());
        return { ok: true, datetime: formatted, timezone: timezone || "local" };
      } catch (e) {
        return { ok: false, message: `Invalid timezone: ${timezone}` };
      }
    },
    play_youtube: ({ query, video_url } = {}) => {
      // Extract an 11-char video ID from a URL/ID if provided.
      const extractId = (s) => {
        if (!s) return null;
        const m = String(s).match(
          /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
        if (m) return m[1];
        if (/^[A-Za-z0-9_-]{11}$/.test(s.trim())) return s.trim();
        return null;
      };
      const id = extractId(video_url);
      if (id) {
        setPlayer({
          src: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
          label: video_url,
        });
        return { ok: true, playing: "direct video", video_id: id };
      }
      if (query) {
        // Use YouTube's embed-by-search playlist, autoplaying the top match.
        setPlayer({
          src: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(
            query
          )}&autoplay=1&rel=0`,
          label: query,
        });
        return { ok: true, playing: query };
      }
      return { ok: false, message: "No query or video URL provided." };
    },
    open_url: ({ url } = {}) => {
      if (!url) return { ok: false, message: "No URL provided." };
      const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      // Popups triggered outside a click are usually blocked, so we also surface
      // a clickable link in the UI as a reliable fallback.
      const win = window.open(full, "_blank", "noopener,noreferrer");
      setOpenedUrl(full);
      if (win) return { ok: true, opened: full };
      return {
        ok: true,
        opened: full,
        note: "Popup may have been blocked; a clickable link is shown in the app for the user to tap.",
      };
    },
  };

  function handleToolCall({ name, args, result }) {
    setLastTool({ name, args, result, id: `${name}-${Date.now()}` });
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  async function startConversation() {
    if (!KEY_READY) {
      setError(
        "No API key found. Paste your key into voice-orb/.env (VITE_GEMINI_API_KEY) and restart the dev server."
      );
      return;
    }
    setError("");
    setActive(true);
    setConnecting(true);
    setVoiceState("listening");
    setTranscript([]);
    setLastTool(null);
    setPlayer(null);
    setOpenedUrl(null);
    pendingRef.current = { user: "", assistant: "" };

    const session = new VoiceSession({
      apiKey: API_KEY,
      onStatus: (s) => {
        setStatus(s);
        setConnecting(false);
      },
      onState: (s) => setVoiceState(s),
      onTranscript: handleTranscript,
      onToolCall: handleToolCall,
      toolHandlers,
      onError: (msg) => {
        setError(msg);
        setConnecting(false);
      },
    });
    sessionRef.current = session;
    await session.start();
  }

  async function endConversation() {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    setActive(false);
    setConnecting(false);
    setVoiceState("idle");
    setStatus("Conversation ended");
  }

  const orbClass = [
    "orb",
    active ? "orb-active" : "",
    voiceState === "speaking" ? "orb-speaking" : "",
    voiceState === "listening" && active ? "orb-listening" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const heading = !active
    ? "A more natural conversation."
    : voiceState === "speaking"
    ? "Listening to the assistant…"
    : "I'm listening.";

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>Voice Companion</span>
        </div>
        <span className="language">English · British</span>
      </header>

      <section className="conversation">
        <div className={orbClass}>
          <div className="orb-core">
            {voiceState === "speaking" ? (
              <AudioLines size={36} strokeWidth={1.4} />
            ) : (
              <Volume2 size={36} strokeWidth={1.4} />
            )}
          </div>
        </div>

        <p className="eyebrow">YOUR VOICE ASSISTANT</p>
        <h1>{heading}</h1>
        <p className="status" aria-live="polite">
          {connecting ? "Connecting…" : status}
        </p>

        {error && <p className="error" role="alert">{error}</p>}

        {active && lastTool && (
          <p className="tool-chip" key={lastTool.id}>
            🔧 {lastTool.name === "set_theme_color"
              ? `Changed color → ${lastTool.args.color}`
              : lastTool.name === "get_current_time"
              ? "Checked the time"
              : lastTool.name === "play_youtube"
              ? `Playing → ${lastTool.args.query || lastTool.args.video_url || "video"}`
              : lastTool.name === "open_url"
              ? `Opening → ${lastTool.args.url}`
              : `Called ${lastTool.name}`}
          </p>
        )}

        <div className="controls">
          {!active ? (
            <button
              className="start-button"
              onClick={startConversation}
              disabled={connecting}
            >
              <Mic size={20} />
              Start talking
            </button>
          ) : (
            <button className="end-button" onClick={endConversation}>
              <PhoneOff size={19} />
              End conversation
            </button>
          )}
        </div>

        <p className="hint">
          {active
            ? "Speak naturally · Interrupt anytime — just start talking"
            : "Tap to begin · Speak naturally · Interrupt whenever you like"}
        </p>

        {active && (transcript.length > 0 || pendingRef.current.user || pendingRef.current.assistant) && (
          <div className="transcript" aria-live="polite">
            {transcript.map((t) => (
              <div key={t.id} className={`bubble bubble-${t.role}`}>
                <span className="bubble-role">{t.role === "user" ? "You" : "Assistant"}</span>
                <span className="bubble-text">{t.text}</span>
              </div>
            ))}
            {pendingRef.current.user && (
              <div className="bubble bubble-user bubble-live">
                <span className="bubble-role">You</span>
                <span className="bubble-text">{pendingRef.current.user}</span>
              </div>
            )}
            {pendingRef.current.assistant && (
              <div className="bubble bubble-assistant bubble-live">
                <span className="bubble-role">Assistant</span>
                <span className="bubble-text">{pendingRef.current.assistant}</span>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}

        {openedUrl && (
          <p className="open-link">
            Opened a tab for{" "}
            <a href={openedUrl} target="_blank" rel="noopener noreferrer">{openedUrl}</a>
            {" "}— if it didn't appear, tap the link.
          </p>
        )}

        {player && (
          <div className="player">
            <div className="player-head">
              <span className="player-label">▶ {player.label || "Now playing"}</span>
              <button className="player-close" onClick={() => setPlayer(null)}>
                Close
              </button>
            </div>
            <div className="player-frame">
              <iframe
                title="YouTube player"
                src={player.src}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        )}
      </section>

      <footer>
        <span><MicOff size={14} /> Microphone activates when you start</span>
        <span>Private session · No saved history</span>
      </footer>
    </main>
  );
}
