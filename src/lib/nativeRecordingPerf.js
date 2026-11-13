const enabled = import.meta.env?.VITE_RECORDING_PERF === "true";
const active = new Map();
const recordings = new Map();
const PROGRESS_INTERVAL_MS = 5 * 60 * 1000;

function log(event, details) {
  if (enabled) console.info("[Recording perf]", event, { at: new Date().toISOString(), ...details });
}

function metrics(id) {
  if (!recordings.has(id)) {
    recordings.set(id, { bytes: 0, chunks: 0, retries: 0, uploadMs: 0, lastProgressAt: 0 });
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

export function chunkUploadFailed(recordingId, chunkIndex, attempt, status) {
  if (!enabled) return;
  metrics(recordingId).retries += 1;
  log("chunk upload failed", { recordingId, chunkIndex, attempt, status: status ?? "network error" });
}

export function chunkUploadConfirmed(recording, chunkIndex, byteCount, uploadMs) {
  if (!enabled) return;
  const current = metrics(recording.id);
  current.bytes += byteCount;
  current.chunks += 1;
  current.uploadMs += uploadMs;
  const now = Date.now();
  if (current.chunks === 1 || now - current.lastProgressAt >= PROGRESS_INTERVAL_MS ||
      (recording.stopped && chunkIndex === recording.segmentCount - 1)) {
    current.lastProgressAt = now;
    log("upload progress", {
      recordingId: recording.id,
      confirmedChunks: chunkIndex + 1,
      totalChunksAtScan: recording.segmentCount,
      pendingChunksAtScan: recording.segmentCount - chunkIndex - 1,
      uploadedBytesThisRun: current.bytes,
      meanUploadMs: Math.round(current.uploadMs / current.chunks),
      failedAttempts: current.retries,
      secondsSinceStop: current.stopRequestedAt ? Math.round((now - current.stopRequestedAt) / 1000) : null,
    });
  }
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
    failedAttempts: current.retries,
  });
  recordings.delete(recordingId);
}
