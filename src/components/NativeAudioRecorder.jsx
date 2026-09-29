import { useEffect, useRef, useState } from "react";
import { NativeAudio, nativeAudioSupported } from "../lib/nativeAudioApi.js";
import { formatTodayDate } from "../lib/dailyApi.js";
import {
  getNativeRecordingSyncState,
  subscribeNativeRecordingSync,
  syncNativeRecordings,
} from "../lib/nativeRecordingSync.js";

function formatElapsed(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function NativeAudioRecorder({ caregiverId, date, enabled = false, onRecorderBusyChange }) {
  const [status, setStatus] = useState("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [latestRecording, setLatestRecording] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [syncState, setSyncState] = useState(() => getNativeRecordingSyncState(caregiverId));
  const busy = status === "recording" || working;
  const actionPendingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setSyncState(getNativeRecordingSyncState(caregiverId));
    const unsubscribe = subscribeNativeRecordingSync((id, state) => {
      if (id !== caregiverId) return;
      setSyncState(state);
      if (state.completedId) {
        if (!cancelled) {
          setLatestRecording((current) => current?.id === state.completedId ? { ...current, uploaded: true } : current);
        }
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [caregiverId]);

  useEffect(() => {
    let cancelled = false;
    let stateListener;
    setStatus("idle");
    setElapsedSeconds(0);
    setLatestRecording(null);
    setError("");

    async function connect() {
      if (!nativeAudioSupported) return;
      try {
        const nextStateListener = await NativeAudio.addListener("recordingStateChanged", (next) => {
          if (cancelled) return;
          setStatus(next.status);
          setElapsedSeconds(Math.floor(next.elapsedSeconds ?? 0));
          if (next.recording) setLatestRecording(next.recording);
          if (next.status === "interrupted") {
            setError("Recording was interrupted. Check the saved audio before starting again.");
          }
        });
        if (cancelled) {
          await nextStateListener.remove();
          return;
        }
        stateListener = nextStateListener;

        const current = await NativeAudio.getStatus({ caregiverId });
        if (cancelled) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        setLatestRecording(current.latestRecording ?? null);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      } catch {
        if (!cancelled) setError("Native recording is unavailable on this device.");
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState !== "visible" || !nativeAudioSupported) return;
      NativeAudio.getStatus({ caregiverId }).then((current) => {
        if (cancelled) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        setLatestRecording(current.latestRecording ?? null);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      }).catch(() => {
        if (!cancelled) setError("Unable to check the recording status.");
      });
    }

    void connect();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void stateListener?.remove();
    };
  }, [caregiverId]);

  useEffect(() => {
    onRecorderBusyChange?.(busy);
    return () => onRecorderBusyChange?.(false);
  }, [busy, onRecorderBusyChange]);

  useEffect(() => {
    if (status !== "recording") return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      NativeAudio.getStatus({ caregiverId }).then((current) => {
        if (cancelled) return;
        setStatus(current.status);
        setElapsedSeconds(Math.floor(current.elapsedSeconds ?? 0));
        if (current.latestRecording) setLatestRecording(current.latestRecording);
        if (current.status === "interrupted") {
          setError("Recording was interrupted. Check the saved audio before starting again.");
        }
      }).catch(() => {
        if (!cancelled) setError("Unable to check the recording status.");
      });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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
        if (date !== formatTodayDate()) {
          setError("The date has changed. Please reopen Dashboard before recording.");
          return;
        }
        const result = await NativeAudio.start({ caregiverId, date });
        setStatus(result.status);
        setElapsedSeconds(0);
        setLatestRecording(null);
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
          {status === "recording"
            ? "Recording to this iPhone"
            : latestRecording?.uploaded
              ? "Audio saved to ELLA"
              : latestRecording
                ? "Saved on this iPhone"
                : "Ready to record"}
        </p>

        {syncState.status === "uploading" && (
          <p className="text-sm text-brand-700">
            Uploading saved audio...
            {syncState.progress?.sizeBytes > 0 && ` ${Math.round(100 * syncState.progress.uploadedBytes / syncState.progress.sizeBytes)}%`}
          </p>
        )}
        {(syncState.pendingCount > 0 || syncState.error) && syncState.status !== "uploading" && (
          <div className="w-full rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {syncState.pendingCount > 0 && (
              <p>
                {syncState.pendingCount} recording{syncState.pendingCount === 1 ? "" : "s"} saved on this iPhone, waiting to upload.
              </p>
            )}
            {syncState.error && (
              <p>
                {syncState.unreadableCount > 0
                  ? "Some saved audio could not be read. Please contact the ELLA team."
                  : syncState.cleanupFailureCount > 0
                    ? "Uploaded audio could not be removed from this iPhone. Please retry."
                  : "Upload could not finish. Please retry."}
              </p>
            )}
            <button type="button" className="btn-ghost mt-3" onClick={() => void syncNativeRecordings(caregiverId)}>
              Retry upload
            </button>
          </div>
        )}
        {error && (
          <p className="w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
