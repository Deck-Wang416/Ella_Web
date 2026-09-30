const MIME_TYPE = "audio/mp4";
const RETRY_DELAYS_MS = [1000, 2500];

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
}

function toBlob(base64, mimeType) {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function mergedAudioIsReady(session) {
  return session.mergeStatus === "completed" && Boolean(session.finalAudio?.storagePath);
}

async function reconcileCompleted(session, native, target, sessionId) {
  if (mergedAudioIsReady(session)) {
    await native.deleteUploadedRecording({ ...target, sessionId });
    return true;
  }
  if (session.mergeStatus === "failed") {
    throw new Error("Audio was uploaded, but processing failed. Please contact the ELLA team.");
  }
  return false;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(new DOMException("Upload cancelled", "AbortError"));
    }
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function uploadWithRetry(api, sessionId, chunkIndex, blob, signal) {
  for (let attempt = 0; ; attempt += 1) {
    assertNotAborted(signal);
    try {
      return await api.uploadRecordingChunk(sessionId, chunkIndex, blob, { signal });
    } catch (error) {
      const retryable = !Number.isInteger(error?.status) || error.status >= 500;
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      await wait(RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

// The native manifest owns upload progress; it is advanced only after the server confirms a chunk.
export async function transferNativeRecording(recording, caregiverId, native, api, signal, onProgress = () => {}) {
  const standalone = recording.format === "standalone";
  if (!Number.isSafeInteger(recording.nextChunkIndex) || recording.nextChunkIndex < 0 ||
      (standalone
        ? !Number.isSafeInteger(recording.segmentCount) || recording.segmentCount < recording.nextChunkIndex
        : !Number.isSafeInteger(recording.sizeBytes) || recording.sizeBytes <= 0 ||
          !Number.isSafeInteger(recording.uploadedBytes) || recording.uploadedBytes < 0 ||
          recording.uploadedBytes > recording.sizeBytes) ||
      !Number.isFinite(recording.durationSeconds) || recording.durationSeconds < 0) {
    throw new Error("Saved audio metadata is invalid.");
  }
  const target = { caregiverId, id: recording.id };
  let sessionId = recording.sessionId;
  let uploadedBytes = recording.uploadedBytes;
  let nextChunkIndex = recording.nextChunkIndex;

  assertNotAborted(signal);
  if (sessionId) {
    try {
      const remote = await api.getRecordingSession(sessionId, { signal });
      if (remote.caregiverId !== caregiverId || remote.date !== recording.date ||
          (remote.chunkFormat || "byte_stream") !== (standalone ? "standalone" : "byte_stream")) {
        throw new Error("Recording session belongs to a different caregiver or date.");
      }
      if (remote.status === "completed") {
        return reconcileCompleted(remote, native, target, sessionId);
      }
      if (remote.status !== "recording") {
        await native.resetUploadSession(target);
        sessionId = null;
        uploadedBytes = 0;
        nextChunkIndex = 0;
      }
    } catch (error) {
      if (error?.status !== 404) throw error;
      await native.resetUploadSession(target);
      sessionId = null;
      uploadedBytes = 0;
      nextChunkIndex = 0;
    }
  }

  if (standalone && recording.segmentCount === 0) return false;

  if (!sessionId) {
    assertNotAborted(signal);
    const created = await api.createRecordingSession(recording.date, caregiverId, {
      signal,
      chunkFormat: standalone ? "standalone" : "byte_stream",
    });
    if (!created?.sessionId || created.caregiverId !== caregiverId || created.date !== recording.date) {
      throw new Error("Invalid recording session response.");
    }
    sessionId = created.sessionId;
    await native.setUploadSession({ ...target, sessionId });
  }

  while (standalone ? nextChunkIndex < recording.segmentCount : uploadedBytes < recording.sizeBytes) {
    assertNotAborted(signal);
    const chunk = await native.readUploadChunk(target);
    const blob = toBlob(chunk.base64, standalone ? "audio/wav" : MIME_TYPE);
    if (chunk.chunkIndex !== nextChunkIndex || chunk.byteCount !== blob.size || !blob.size) {
      throw new Error("Saved audio chunk does not match upload progress.");
    }
    const result = await uploadWithRetry(api, sessionId, nextChunkIndex, blob, signal);
    if (result.sessionId !== sessionId || result.chunkIndex !== nextChunkIndex) {
      throw new Error("Unexpected recording chunk response.");
    }
    await native.confirmUploadChunk({ ...target, sessionId, chunkIndex: nextChunkIndex, byteCount: chunk.byteCount });
    if (!standalone) uploadedBytes += chunk.byteCount;
    nextChunkIndex += 1;
    onProgress(standalone
      ? { uploadedChunks: nextChunkIndex, totalChunks: recording.segmentCount }
      : { uploadedBytes, sizeBytes: recording.sizeBytes });
  }

  assertNotAborted(signal);
  if (standalone && !recording.stopped) return false;
  if (nextChunkIndex < 1 || (standalone
    ? nextChunkIndex !== recording.segmentCount
    : uploadedBytes !== recording.sizeBytes)) {
    throw new Error("Saved audio is incomplete.");
  }
  const durationSeconds = Math.max(1, Math.ceil(recording.durationSeconds));
  const completed = await api.completeRecordingSession(sessionId, nextChunkIndex - 1, durationSeconds, { signal });
  if (completed.sessionId !== sessionId || completed.status !== "completed") {
    throw new Error("Recording completion was not confirmed.");
  }
  const remote = mergedAudioIsReady(completed)
    ? completed
    : await api.getRecordingSession(sessionId, { signal });
  return reconcileCompleted(remote, native, target, sessionId);
}
