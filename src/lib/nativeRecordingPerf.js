import { flushRecordingPerf, flushSavedRecordingPerf, queueRecordingPerf } from "./nativeRecordingPerfUpload.js";

const enabled = import.meta.env?.VITE_RECORDING_PERF === "true";
const active = new Map();
const recordings = new Map();
const interruptions = new Set();

function log(event, details) {
  if (!enabled) return;
  const at = new Date().toISOString();
  console.info("[Recording perf]", event, { at, ...details });
  if (details.recordingId) queueRecordingPerf(details.recordingId, event, details);
}

export function uploadRecordingPerfLog(recordingId, sessionId, caregiverId, force = false) {
  if (enabled) return flushRecordingPerf(recordingId, sessionId, caregiverId, force);
  return Promise.resolve();
}

export function uploadSavedRecordingPerfLogs(caregiverId) {
  if (enabled) flushSavedRecordingPerf(caregiverId);
}

function metrics(id) {
  if (!recordings.has(id)) {
    recordings.set(id, { bytes: 0, chunks: 0, retries: 0, requestMs: 0, totalMs: 0 });
  }
  return recordings.get(id);
}

export function recordingStarted(caregiverId) {
  if (!enabled) return;
  active.set(caregiverId, { startedAt: Date.now() });
  log("start", {});
}

export function recordingStopRequested(caregiverId) {
  if (!enabled) return;
  const current = active.get(caregiverId);
  if (current) current.stopRequestedAt = Date.now();
  log("stop requested", {});
}

export function recordingStopped(caregiverId, recording) {
  if (!enabled) return;
  const current = active.get(caregiverId);
  Object.assign(metrics(recording.id), current);
  active.delete(caregiverId);
  log("stop saved locally", {
    recordingId: recording.id,
    durationSeconds: recording.durationSeconds,
    totalChunks: recording.segmentCount,
    uploadedChunks: recording.nextChunkIndex,
    pendingChunks: recording.segmentCount - recording.nextChunkIndex,
    stopCallMs: current?.stopRequestedAt ? Date.now() - current.stopRequestedAt : null,
  });
}

export function recordingInterrupted(caregiverId, recording) {
  if (!enabled || interruptions.has(recording.id)) return;
  interruptions.add(recording.id);
  const current = active.get(caregiverId);
  Object.assign(metrics(recording.id), current);
  active.delete(caregiverId);
  log("interrupted", {
    recordingId: recording.id,
    durationSeconds: recording.durationSeconds,
    totalChunks: recording.segmentCount,
    uploadedChunks: recording.nextChunkIndex,
  });
}

export function chunkUploadStarted(recordingId, chunkIndex, attempt, sizeBytes) {
  log("chunk request started", { recordingId, chunkIndex, attempt, sizeBytes });
}

export function chunkUploadFailed(recordingId, chunkIndex, attempt, status, requestMs) {
  if (!enabled) return;
  metrics(recordingId).retries += 1;
  log("chunk request failed", {
    recordingId, chunkIndex, attempt, status: status ?? "network error", requestMs: Math.round(requestMs),
  });
}

export function chunkUploadConfirmed(recording, chunkIndex, byteCount, timing) {
  if (!enabled) return;
  const current = metrics(recording.id);
  current.bytes += byteCount;
  current.chunks += 1;
  current.requestMs += timing.requestMs;
  current.totalMs += timing.totalMs;
  log("chunk confirmed", {
    recordingId: recording.id,
    chunkIndex,
    sizeBytes: byteCount,
    sealedChunksAtScan: recording.segmentCount,
    readMs: Math.round(timing.readMs),
    decodeMs: Math.round(timing.decodeMs),
    requestMs: Math.round(timing.requestMs),
    confirmMs: Math.round(timing.confirmMs),
    totalMs: Math.round(timing.totalMs),
    attempts: timing.attempts,
  });
}

export function recordingCompleteRequested(recordingId) {
  if (!enabled) return;
  log("complete requested", { recordingId });
}

export function recordingCompleteConfirmed(recordingId, completeMs) {
  if (!enabled) return;
  const current = metrics(recordingId);
  log("complete confirmed", {
    recordingId,
    stopToCompleteSeconds: current.stopRequestedAt
      ? Math.round((Date.now() - current.stopRequestedAt) / 1000) : null,
    completeMs,
    uploadedChunksThisRun: current.chunks,
    uploadedBytesThisRun: current.bytes,
    meanRequestMs: current.chunks ? Math.round(current.requestMs / current.chunks) : null,
    meanTotalMs: current.chunks ? Math.round(current.totalMs / current.chunks) : null,
    failedAttempts: current.retries,
  });
  recordings.delete(recordingId);
}
