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

export default function ParentAudioRecorder({ date, parentAudio, onRefreshDaily }) {
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
    let cancelled = false;

    async function syncFromActiveSession() {
      if (!parentAudio?.enabled) {
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
      setSessionId(activeSession.sessionId);
      setSessionStatus(activeSession.status || "recording");
      setLastUploadedChunkIndex(activeSession.lastChunkIndex ?? -1);
      setNextChunkIndex((activeSession.lastChunkIndex ?? -1) + 1);

      try {
        const precise = await getRecordingSession(activeSession.sessionId);
        if (cancelled) return;
        setSessionStatus(precise.status || activeSession.status || "recording");
        setLastUploadedChunkIndex(precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1);
        setNextChunkIndex((precise.lastChunkIndex ?? activeSession.lastChunkIndex ?? -1) + 1);
      } catch {
        if (cancelled) return;
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

  async function processPendingBlobs() {
    if (uploadLoopRunningRef.current) return;
    if (!sessionIdRef.current) return;

    uploadLoopRunningRef.current = true;
    setUploading(true);

    while (pendingBlobsRef.current.length > 0) {
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

  async function startRecording() {
    if (!parentAudio?.enabled) return;
    setRecorderError("");
    setUploadError("");

    let stream = null;
    let recorder = null;

    try {
      setElapsedSeconds(0);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      await ensureSession();

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
        throw new Error("Missing sessionId");
      }

      await completeRecordingSession(
        sessionIdRef.current,
        lastUploadedChunkIndexRef.current
      );

      setSessionStatus("completed");
      setCompletedDate(date);
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
      setIsCompleting(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }

  const buttonLabel = isRecording ? "Stop" : sessionId ? "Resume" : "Start";
  const statusLabel = useMemo(() => {
    if (!parentAudio?.enabled) return "Recording unavailable";
    if (isCompleting) return "Finalizing recording";
    if (isRecording) return "Recording in progress";
    if (completedDate === date) return "Recording completed";
    if (uploadError) return "Upload interrupted";
    if (sessionStatus === "completed") return "Recording completed";
    if (sessionId) return "Session ready to continue";
    return "Ready to record";
  }, [
    completedDate,
    date,
    isCompleting,
    isRecording,
    parentAudio?.enabled,
    sessionId,
    sessionStatus,
    uploadError,
  ]);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <p className="section-title">Recording</p>
        <span className="text-xs text-ink-500">{statusLabel}</span>
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
          aria-label={buttonLabel}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-base font-semibold">
            {isRecording ? "Stop" : "Start"}
          </span>
        </button>

        <div className="grid gap-1">
          <p className="font-display text-4xl">{formatElapsed(elapsedSeconds)}</p>
          <p className="text-sm text-ink-500">
            {sessionId ? `Session ${sessionId}` : "No active session"}
          </p>
        </div>

        <div className="grid w-full gap-3 rounded-3xl bg-ink-100 p-4 text-left text-sm text-ink-700">
          <div className="flex items-center justify-between">
            <span>Next chunk</span>
            <span className="font-semibold">{nextChunkIndex}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last uploaded</span>
            <span className="font-semibold">
              {lastUploadedChunkIndex >= 0 ? lastUploadedChunkIndex : "None"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Upload status</span>
            <span className="font-semibold">
              {uploading ? "Uploading..." : uploadError ? "Needs attention" : "Synced"}
            </span>
          </div>
        </div>

        {recorderError && (
          <p className="w-full rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {recorderError}
          </p>
        )}

        {uploadError && (
          <div className="w-full rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700">
            <p>{uploadError}</p>
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
