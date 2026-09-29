import { useEffect, useRef, useState } from "react";
import { NativeAudio, nativeAudioSupported } from "../lib/nativeAudioApi.js";

function formatElapsed(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function NativeAudioRecorder({ caregiverId, enabled = false, onRecorderBusyChange }) {
  const [status, setStatus] = useState("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [latestRecording, setLatestRecording] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const busy = status === "recording" || working;
  const mountedRef = useRef(true);
  const actionPendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    let stateListener;
    let playbackListener;

    async function connect() {
      if (!nativeAudioSupported) return;
      try {
        const nextStateListener = await NativeAudio.addListener("recordingStateChanged", (next) => {
          if (!mountedRef.current) return;
          setStatus(next.status);
          setElapsedSeconds(Math.floor(next.elapsedSeconds ?? 0));
          if (next.recording) setLatestRecording(next.recording);
          if (next.status === "interrupted") {
            setError("Recording was interrupted. Check the saved audio before starting again.");
          }
        });
        if (!mountedRef.current) {
          await nextStateListener.remove();
          return;
        }
        stateListener = nextStateListener;

        const nextPlaybackListener = await NativeAudio.addListener("playbackFinished", () => {
          if (mountedRef.current) setPlaying(false);
        });
        if (!mountedRef.current) {
          await nextPlaybackListener.remove();
          return;
        }
        playbackListener = nextPlaybackListener;
        const current = await NativeAudio.getStatus({ caregiverId });
        if (!mountedRef.current) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        setLatestRecording(current.latestRecording ?? null);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      } catch {
        if (mountedRef.current) setError("Native recording is unavailable on this device.");
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState !== "visible" || !nativeAudioSupported) return;
      NativeAudio.getStatus({ caregiverId }).then((current) => {
        if (!mountedRef.current) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        setLatestRecording(current.latestRecording ?? null);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      }).catch(() => {
        if (mountedRef.current) setError("Unable to check the recording status.");
      });
    }

    void connect();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void stateListener?.remove();
      void playbackListener?.remove();
    };
  }, [caregiverId]);

  useEffect(() => {
    onRecorderBusyChange?.(busy);
    return () => onRecorderBusyChange?.(false);
  }, [busy, onRecorderBusyChange]);

  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = window.setInterval(() => {
      NativeAudio.getStatus({ caregiverId }).then((current) => {
        if (!mountedRef.current) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        if (current.latestRecording) setLatestRecording(current.latestRecording);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      }).catch(() => {
        if (mountedRef.current) setError("Unable to check the recording status.");
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [caregiverId, status]);

  async function toggleRecording() {
    if (actionPendingRef.current || !enabled || !nativeAudioSupported) return;
    actionPendingRef.current = true;
    setWorking(true);
    setError("");
    try {
      if (status === "recording") {
        const result = await NativeAudio.stop({ caregiverId });
        setStatus(result.status);
        setElapsedSeconds(Math.floor(result.recording.durationSeconds));
        setLatestRecording(result.recording);
      } else {
        if (playing) await NativeAudio.stopPlayback();
        setPlaying(false);
        const result = await NativeAudio.start({ caregiverId });
        setStatus(result.status);
        setElapsedSeconds(0);
      }
    } catch (cause) {
      setError(cause?.message || "Unable to record. Please try again.");
      try {
        const current = await NativeAudio.getStatus({ caregiverId });
        setStatus(current.status);
        if (current.latestRecording) setLatestRecording(current.latestRecording);
      } catch {
        // Preserve the original error.
      }
    } finally {
      actionPendingRef.current = false;
      setWorking(false);
    }
  }

  async function togglePlayback() {
    if (!latestRecording || working || status === "recording") return;
    setError("");
    try {
      if (playing) {
        await NativeAudio.stopPlayback();
        setPlaying(false);
      } else {
        await NativeAudio.play({ caregiverId, id: latestRecording.id });
        setPlaying(true);
      }
    } catch (cause) {
      setPlaying(false);
      setError(cause?.message || "Unable to play the saved recording.");
    }
  }

  async function deleteLatestRecording() {
    if (!latestRecording || working || status === "recording" || actionPendingRef.current) return;
    if (!window.confirm("Delete this recording from this iPhone? This cannot be undone.")) return;
    actionPendingRef.current = true;
    setWorking(true);
    setError("");
    try {
      const result = await NativeAudio.deleteRecording({ caregiverId, id: latestRecording.id });
      setPlaying(false);
      setLatestRecording(result.latestRecording ?? null);
      setStatus(result.status);
      setElapsedSeconds(Math.floor(result.latestRecording?.durationSeconds ?? 0));
    } catch (cause) {
      setError(cause?.message || "Unable to delete this recording.");
    } finally {
      actionPendingRef.current = false;
      setWorking(false);
    }
  }

  if (!nativeAudioSupported) {
    return (
      <section className="card p-5">
        <p className="section-title">Recording</p>
        <p className="mt-5 text-sm text-ink-500">Native recording is not available on Android yet.</p>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <p className="section-title">Recording</p>
      <div className="mt-5 flex flex-col items-center gap-5 text-center">
        <button
          type="button"
          onClick={toggleRecording}
          disabled={!enabled || working}
          className={`flex h-36 w-36 items-center justify-center rounded-full border-8 transition ${
            status === "recording"
              ? "border-red-200 bg-red-500 text-white"
              : "border-brand-200 bg-brand-500 text-white"
          } ${!enabled || working ? "cursor-not-allowed opacity-50" : ""}`}
          aria-label={status === "recording" ? "Stop recording" : "Start recording"}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-base font-semibold">
            {status === "recording" ? "Stop" : "Start"}
          </span>
        </button>

        <p className="font-display text-4xl">{formatElapsed(elapsedSeconds)}</p>
        <p className="text-sm text-ink-600">
          {status === "recording" ? "Recording to this iPhone" : latestRecording ? "Saved on this iPhone" : "Ready to record"}
        </p>

        {latestRecording && status !== "recording" && (
          <div className="w-full rounded-2xl bg-ink-100 p-4 text-left text-sm text-ink-700">
            <p>Latest recording: {formatElapsed(Math.floor(latestRecording.durationSeconds))}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className="btn-ghost" onClick={togglePlayback} disabled={working}>
                {playing ? "Stop playback" : "Play recording"}
              </button>
              <button type="button" className="btn-ghost text-red-600" onClick={deleteLatestRecording} disabled={working}>
                Delete recording
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-500">Test build: recordings stay on this iPhone and are not uploaded yet.</p>
        {error && (
          <p className="w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
