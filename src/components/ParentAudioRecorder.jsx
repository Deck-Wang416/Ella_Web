import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/dailyApi.js";
import {
  completeRecordingSession,
  createRecordingSession,
  getRecordingSession,
  uploadRecordingChunk,
} from "../lib/recordingsApi.js";

const CHUNK_TIMESLICE_MS = 3000;
const RETRY_DELAY_MS = 1200;
const MAX_UPLOAD_ATTEMPTS = 2;

function formatElapsed(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function pickSupportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "",
  ];

  if (typeof MediaRecorder === "undefined") return "";

  return candidates.find((item) => !item || MediaRecorder.isTypeSupported(item)) || "";
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function ParentAudioRecorder({
  date,
  parentAudio,
  onRefreshDaily,
  onRecorderBusyChange,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionId, setSessionId] = useState(parentAudio?.activeSession?.sessionId || null);
  const [nextChunkIndex, setNextChunkIndex] = useState(
    parentAudio?.activeSession ? parentAudio.activeSession.lastChunkIndex + 1 : 0
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [lastUploadedChunkIndex, setLastUploadedChunkIndex] = useState(
    parentAudio?.activeSession?.lastChunkIndex ?? -1
  );
  const [sessionStatus, setSessionStatus] = useState(
    parentAudio?.activeSession?.status || "idle"
  );
  const [recorderError, setRecorderError] = useState("");
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockMessage, setWakeLockMessage] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [completedDate, setCompletedDate] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const pendingBlobsRef = useRef([]);
  const uploadLoopRunningRef = useRef(false);
  const uploadErrorRef = useRef("");
  const nextChunkIndexRef = useRef(nextChunkIndex);
  const lastUploadedChunkIndexRef = useRef(lastUploadedChunkIndex);
  const sessionIdRef = useRef(sessionId);
  const isRecordingRef = useRef(false);
  const stopPromiseRef = useRef(null);
  const startTimestampRef = useRef(null);
  const wakeLockRef = useRef(null);
  const wakeLockRequestIdRef = useRef(0);
  const busyState = isRecording || uploading || isCompleting;

  useEffect(() => {
    nextChunkIndexRef.current = nextChunkIndex;
  }, [nextChunkIndex]);

  useEffect(() => {
    uploadErrorRef.current = uploadError;
  }, [uploadError]);

  useEffect(() => {
    lastUploadedChunkIndexRef.current = lastUploadedChunkIndex;
  }, [lastUploadedChunkIndex]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (typeof onRecorderBusyChange !== "function") return undefined;
    onRecorderBusyChange(busyState);
    return () => {
      onRecorderBusyChange(false);
    };
  }, [busyState, onRecorderBusyChange]);

  useEffect(() => {
    let cancelled = false;

    async function syncFromActiveSession() {
      if (!parentAudio?.enabled) {
        sessionIdRef.current = null;
        lastUploadedChunkIndexRef.current = -1;
        nextChunkIndexRef.current = 0;
        setSessionId(null);
        setNextChunkIndex(0);
        setLastUploadedChunkIndex(-1);
        setElapsedSeconds(0);
        setSessionStatus("idle");
        setUploadError("");
        setCompletedDate(null);
        return;
      }

      const activeSession = parentAudio?.activeSession;
      if (!activeSession) {
        if (!isRecordingRef.current) {
          sessionIdRef.current = null;
          lastUploadedChunkIndexRef.current = -1;
          nextChunkIndexRef.current = 0;
          setSessionId(null);
          setNextChunkIndex(0);
          setLastUploadedChunkIndex(-1);
          setElapsedSeconds(0);
          setSessionStatus("idle");
          setUploadError("");
          if (completedDate !== date) {
            setCompletedDate(null);
          }
        }
        return;
      }

      setCompletedDate(null);
      sessionIdRef.current = activeSession.sessionId;
      lastUploadedChunkIndexRef.current = activeSession.lastChunkIndex ?? -1;
      nextChunkIndexRef.current = (activeSession.lastChunkIndex ?? -1) + 1;
      setSessionId(activeSession.sessionId);
      setSessionStatus(activeSession.status || "recording");
      setLastUploadedChunkIndex(activeSession.lastChunkIndex ?? -1);
      setNextChunkIndex((activeSession.lastChunkIndex ?? -1) + 1);

      try {
        const precise = await getRecordingSession(activeSession.sessionId);
        if (cancelled) return;
        sessionIdRef.current = precise.sessionId || activeSession.sessionId;
        lastUploadedChunkIndexRef.current =
          precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1;
        nextChunkIndexRef.current =
          (precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1) + 1;
        setSessionStatus(precise.status || activeSession.status || "recording");
        setLastUploadedChunkIndex(precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1);
        setNextChunkIndex((precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1) + 1);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          sessionIdRef.current = null;
          lastUploadedChunkIndexRef.current = -1;
          nextChunkIndexRef.current = 0;
          setSessionId(null);
          setSessionStatus("idle");
          setLastUploadedChunkIndex(-1);
          setNextChunkIndex(0);
          setUploadError("");
          if (onRefreshDaily) {
            onRefreshDaily();
          }
        }
      }
    }

    syncFromActiveSession();

    return () => {
      cancelled = true;
    };
  }, [date, parentAudio]);

  useEffect(() => {
    if (!isRecording) return undefined;

    const timer = window.setInterval(() => {
      if (!startTimestampRef.current) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTimestampRef.current) / 1000)));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isRecording]);

  useEffect(() => {
    function handlePageHide() {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") return;
      try {
        recorder.requestData();
      } catch {
        // Best effort only.
      }
    }

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, []);

  useEffect(() => {
    return () => {
      wakeLockRequestIdRef.current += 1;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {
          // Ignore release errors during unmount.
        });
        wakeLockRef.current = null;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore stop errors on unmount.
        }
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    async function handleVisibilityChange() {
      if (!isRecordingRef.current || document.visibilityState !== "visible") return;
      if (wakeLockRef.current) return;
      await requestWakeLock();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  async function processPendingBlobs() {
    if (uploadLoopRunningRef.current) return;

    uploadLoopRunningRef.current = true;
    setUploading(true);

    while (pendingBlobsRef.current.length > 0) {
      if (!sessionIdRef.current) {
        try {
          await ensureSession();
        } catch (error) {
          const fallback =
            error instanceof ApiError && error.status >= 500
              ? "Service is temporarily unavailable. Please try again later."
              : "Unable to start recording. Please try again.";
          setRecorderError(fallback);
          break;
        }
      }

      const blob = pendingBlobsRef.current[0];
      const chunkIndex = nextChunkIndexRef.current;
      let uploaded = false;

      for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
        try {
          const response = await uploadRecordingChunk(sessionIdRef.current, chunkIndex, blob);
          pendingBlobsRef.current.shift();
          const nextIndex = (response.lastChunkIndex ?? chunkIndex) + 1;
          uploaded = true;
          setUploadError("");
          lastUploadedChunkIndexRef.current = response.lastChunkIndex ?? chunkIndex;
          nextChunkIndexRef.current = nextIndex;
          setLastUploadedChunkIndex(response.lastChunkIndex ?? chunkIndex);
          setNextChunkIndex(nextIndex);
          break;
        } catch (error) {
          setUploadError("Upload failed. Retrying...");
          if (attempt < MAX_UPLOAD_ATTEMPTS) {
            await delay(RETRY_DELAY_MS);
            continue;
          }

          const fallback =
            error instanceof ApiError && error.status >= 500
              ? "Service is temporarily unavailable. Please try again later."
              : "Upload failed. Retrying...";
          setUploadError(fallback);
          uploaded = false;
        }
      }

      if (!uploaded) break;
    }

    uploadLoopRunningRef.current = false;
    setUploading(false);
  }

  async function ensureSession() {
    if (sessionIdRef.current) return sessionIdRef.current;

    const created = await createRecordingSession(date);
    setCompletedDate(null);
    sessionIdRef.current = created.sessionId;
    lastUploadedChunkIndexRef.current = created.lastChunkIndex ?? -1;
    nextChunkIndexRef.current = (created.lastChunkIndex ?? -1) + 1;
    setSessionId(created.sessionId);
    setSessionStatus(created.status || "recording");
    setLastUploadedChunkIndex(created.lastChunkIndex ?? -1);
    setNextChunkIndex((created.lastChunkIndex ?? -1) + 1);
    setElapsedSeconds(0);
    if (onRefreshDaily) {
      onRefreshDaily();
    }
    return created.sessionId;
  }

  function resetLocalSessionState() {
    sessionIdRef.current = null;
    lastUploadedChunkIndexRef.current = -1;
    nextChunkIndexRef.current = 0;
    pendingBlobsRef.current = [];
    setSessionId(null);
    setSessionStatus("idle");
    setLastUploadedChunkIndex(-1);
    setNextChunkIndex(0);
    setUploadError("");
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      setWakeLockActive(false);
      setWakeLockMessage("Please keep your screen awake while recording.");
      return;
    }

    const requestId = wakeLockRequestIdRef.current + 1;
    wakeLockRequestIdRef.current = requestId;

    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (wakeLockRequestIdRef.current !== requestId || !isRecordingRef.current) {
        await sentinel.release().catch(() => {
          // Ignore release errors if state changed while the request was pending.
        });
        return;
      }

      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      setWakeLockMessage("");
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
        }
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
      setWakeLockMessage("Please keep your screen awake while recording.");
    }
  }

  async function releaseWakeLock() {
    wakeLockRequestIdRef.current += 1;
    const sentinel = wakeLockRef.current;
    if (!sentinel) {
      setWakeLockActive(false);
      return;
    }

    wakeLockRef.current = null;
    try {
      await sentinel.release();
    } catch {
      // Ignore release failures; the system may already have released it.
    } finally {
      setWakeLockActive(false);
    }
  }

  async function startRecording() {
    if (!parentAudio?.enabled || isRecordingRef.current || isCompleting || uploading) return;
    setRecorderError("");
    setUploadError("");
    setWakeLockMessage("");

    if (!parentAudio?.activeSession) {
      resetLocalSessionState();
    }

    let stream = null;
    let recorder = null;

    try {
      await ensureSession();
      if (!sessionIdRef.current) {
        throw new Error("Missing recording session id.");
      }

      setElapsedSeconds(0);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      startTimestampRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        const blob = event.data;
        if (!blob || blob.size === 0) return;
        pendingBlobsRef.current.push(blob);
        processPendingBlobs();
      };

      recorder.onerror = () => {
        setRecorderError("Unable to start recording. Please try again.");
      };

      recorder.onstop = () => {
        if (stopPromiseRef.current) {
          stopPromiseRef.current.resolve();
          stopPromiseRef.current = null;
        }
      };

      recorder.start(CHUNK_TIMESLICE_MS);
      setIsRecording(true);
      setSessionStatus("recording");
      void requestWakeLock();
    } catch (error) {
      const fallback =
        error instanceof ApiError && error.status >= 500
          ? "Service is temporarily unavailable. Please try again later."
          : "Unable to start recording. Please try again.";
      setRecorderError(fallback);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
      mediaRecorderRef.current = null;
    }
  }

  async function waitForUploadsToDrain() {
    while (uploadLoopRunningRef.current || pendingBlobsRef.current.length > 0) {
      if (uploadErrorRef.current) {
        throw new Error(uploadErrorRef.current);
      }
      await delay(150);
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setIsCompleting(true);
    setRecorderError("");

    try {
      if (recorder.state === "recording") {
        const stopPromise = new Promise((resolve) => {
          stopPromiseRef.current = { resolve };
        });
        recorder.stop();
        await stopPromise;
      }

      await waitForUploadsToDrain();

      if (!sessionIdRef.current) {
        setSessionStatus("idle");
        setSessionId(null);
        setNextChunkIndex(0);
        setElapsedSeconds(0);
        setUploadError("");
        setRecorderError("No audio was captured. Please try again.");
        return;
      }

      await completeRecordingSession(sessionIdRef.current, lastUploadedChunkIndexRef.current);

      setSessionStatus("completed");
      setCompletedDate(date);
      sessionIdRef.current = null;
      lastUploadedChunkIndexRef.current = -1;
      nextChunkIndexRef.current = 0;
      setSessionId(null);
      setNextChunkIndex(0);
      setElapsedSeconds(0);
      setIsRecording(false);
      setUploadError("");
      if (onRefreshDaily) {
        onRefreshDaily();
      }
    } catch (error) {
      const fallback =
        error instanceof ApiError && error.status >= 500
          ? "Service is temporarily unavailable. Please try again later."
          : "Recording saved partially. Please retry completion.";
      setRecorderError(fallback);
    } finally {
      await releaseWakeLock();
      setIsCompleting(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }

  const uploadStatusLabel = useMemo(() => {
    if (isCompleting) return "Finalizing recording";
    if (uploading) return "Saving audio";
    if (uploadError) return "Upload paused";
    if (lastUploadedChunkIndex >= 0) return "Audio saved";
    return "Ready to record";
  }, [isCompleting, lastUploadedChunkIndex, uploading, uploadError]);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <p className="section-title">Recording</p>
      </div>

      <div className="mt-5 flex flex-col items-center gap-5 text-center">
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!parentAudio?.enabled || uploading || isCompleting}
          className={`flex h-36 w-36 items-center justify-center rounded-full border-8 transition ${
            isRecording
              ? "border-red-200 bg-red-500 text-white hover:bg-red-600"
              : "border-brand-200 bg-brand-500 text-white hover:bg-brand-600"
          } ${!parentAudio?.enabled || uploading || isCompleting ? "cursor-not-allowed opacity-50" : ""}`}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-base font-semibold">
            {isRecording ? "Stop" : "Start"}
          </span>
        </button>

        <div className="grid gap-1">
          <p className="font-display text-4xl">{formatElapsed(elapsedSeconds)}</p>
        </div>

        <div className="grid w-full gap-3 rounded-3xl bg-ink-100 p-4 text-left text-sm text-ink-700">
          <div className="flex items-center justify-between">
            <span>Upload status</span>
            <span className="font-semibold">{uploadStatusLabel}</span>
          </div>
        </div>

        {wakeLockActive && (
          <p className="w-full rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
            Screen will stay awake while recording.
          </p>
        )}

        {recorderError && (
          <p className="w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {recorderError}
          </p>
        )}

        {wakeLockMessage && (
          <p className="w-full rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {wakeLockMessage}
          </p>
        )}

        {uploadError && (
          <div className="w-full rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700">
            <p>Upload paused. Please retry.</p>
            <button
              type="button"
              onClick={() => {
                setUploadError("");
                processPendingBlobs();
              }}
              className="mt-3 btn-ghost px-3 py-2"
            >
              Retry upload
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
