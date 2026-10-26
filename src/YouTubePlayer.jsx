import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";

// Loads the YouTube IFrame Player API once and resolves when ready.
let apiReadyPromise = null;
function loadYouTubeAPI() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(window.YT);
    };
    document.head.appendChild(tag);
  });
  return apiReadyPromise;
}

/**
 * Embeds a YouTube video via the IFrame API and exposes imperative controls
 * through a ref: play, pause, stop, mute, unmute, setVolume, changeVolume,
 * seek (relative), getState. Controlled by the parent's tool handlers.
 */
const YouTubePlayer = forwardRef(function YouTubePlayer({ videoId }, ref) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            e.target.playVideo();
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Load a new video when the id changes (reuse the same player instance).
  useEffect(() => {
    if (readyRef.current && playerRef.current && videoId) {
      try {
        playerRef.current.loadVideoById(videoId);
      } catch {
        /* ignore */
      }
    }
  }, [videoId]);

  useImperativeHandle(ref, () => {
    const p = () => playerRef.current;
    const clamp = (n) => Math.max(0, Math.min(100, n));
    return {
      play: () => p()?.playVideo(),
      pause: () => p()?.pauseVideo(),
      stop: () => p()?.stopVideo(),
      restart: () => {
        p()?.seekTo(0, true);
        p()?.playVideo();
      },
      mute: () => p()?.mute(),
      unmute: () => p()?.unMute(),
      setVolume: (v) => {
        const vol = clamp(Number(v));
        p()?.unMute();
        p()?.setVolume(vol);
        return vol;
      },
      changeVolume: (delta) => {
        const cur = p()?.getVolume?.() ?? 50;
        const vol = clamp(cur + delta);
        p()?.unMute();
        p()?.setVolume(vol);
        return vol;
      },
      getVolume: () => p()?.getVolume?.() ?? null,
      // Relative seek in seconds (positive = forward).
      seek: (deltaSeconds) => {
        const cur = p()?.getCurrentTime?.() ?? 0;
        const dur = p()?.getDuration?.() ?? Infinity;
        const target = Math.max(0, Math.min(dur, cur + deltaSeconds));
        p()?.seekTo(target, true);
        return target;
      },
      seekTo: (seconds) => {
        p()?.seekTo(Math.max(0, Number(seconds)), true);
        return Number(seconds);
      },
      getState: () => {
        const map = {
          "-1": "unstarted",
          0: "ended",
          1: "playing",
          2: "paused",
          3: "buffering",
          5: "cued",
        };
        return map[String(p()?.getPlayerState?.())] ?? "unknown";
      },
    };
  }, []);

  // The IFrame API replaces this div with the actual iframe.
  return <div ref={hostRef} className="yt-host" />;
});

export default YouTubePlayer;
