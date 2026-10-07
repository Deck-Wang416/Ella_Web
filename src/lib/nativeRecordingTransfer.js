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
    try {
      await native.deleteUploadedRecording({ ...target, sessionId });
    } catch (cause) {
      const error = new Error(cause?.message || "Unable to remove uploaded audio from this device.", { cause });
      error.discardable = false;
      throw error;
    }
    return true;
  }
  if (session.mergeStatus === "failed") {
    const error = new Error("Audio was uploaded, but processing failed. Please contact the ELLA team.");
    error.discardable = false;
    error.code = "merge_failed";
    throw error;
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
export async function transferNativeRecording(recording, caregiverId, native, api, signal, onUploadAccepted = () => {}) {
  if (recording.format !== "standalone" ||
      !Number.isSafeInteger(recording.nextChunkIndex) || recording.nextChunkIndex < 0 ||
      !Number.isSafeInteger(recording.segmentCount) || recording.segmentCount < recording.nextChunkIndex ||
      !Number.isFinite(recording.durationSeconds) || recording.durationSeconds < 0) {
    throw new Error("Saved audio metadata is invalid.");
  }
  const target = { caregiverId, id: recording.id };
  let sessionId = recording.sessionId;
  let nextChunkIndex = recording.nextChunkIndex;

  assertNotAborted(signal);
  if (sessionId) {
    try {
      const remote = await api.getRecordingSession(sessionId, { signal });
      if (remote.caregiverId !== caregiverId || remote.date !== recording.date ||
          remote.chunkFormat !== "standalone") {
        throw new Error("Recording session belongs to a different caregiver or date.");
      }
      if (remote.status === "completed") {
        onUploadAccepted(recording.id);
        return reconcileCompleted(remote, native, target, sessionId);
      }
      if (remote.status === "cancelled") {
        throw new Error("This upload was cancelled. Please discard its local copy.");
      }
      if (remote.status !== "recording") {
        await native.resetUploadSession(target);
        sessionId = null;
        nextChunkIndex = 0;
      }
    } catch (error) {
      if (error?.status !== 404) throw error;
      await native.resetUploadSession(target);
      sessionId = null;
      nextChunkIndex = 0;
    }
  }

  if (recording.segmentCount === 0) return false;

  if (!sessionId) {
    assertNotAborted(signal);
    const created = await api.createRecordingSession(recording.date, caregiverId, {
      signal,
      chunkFormat: "standalone",
    });
    if (!created?.sessionId || created.caregiverId !== caregiverId || created.date !== recording.date) {
      throw new Error("Invalid recording session response.");
    }
    sessionId = created.sessionId;
    await native.setUploadSession({ ...target, sessionId });
  }

  while (nextChunkIndex < recording.segmentCount) {
    assertNotAborted(signal);
    const chunk = await native.readUploadChunk(target);
    const blob = toBlob(chunk.base64, "audio/wav");
    if (chunk.chunkIndex !== nextChunkIndex || chunk.byteCount !== blob.size || !blob.size) {
      throw new Error("Saved audio chunk does not match upload progress.");
    }
    let result;
    try {
      result = await uploadWithRetry(api, sessionId, nextChunkIndex, blob, signal);
    } catch (error) {
      const failure = new Error(error?.message || "Audio upload failed", { cause: error });
      failure.status = error?.status;
      failure.recordingSessionId = sessionId;
      failure.chunkIndex = nextChunkIndex;
      throw failure;
    }
    if (result.sessionId !== sessionId || result.chunkIndex !== nextChunkIndex) {
      throw new Error("Unexpected recording chunk response.");
    }
    await native.confirmUploadChunk({ ...target, sessionId, chunkIndex: nextChunkIndex, byteCount: chunk.byteCount });
    nextChunkIndex += 1;
  }

  assertNotAborted(signal);
  if (!recording.stopped) return false;
  if (nextChunkIndex < 1 || nextChunkIndex !== recording.segmentCount) {
    throw new Error("Saved audio is incomplete.");
  }
  const durationSeconds = Math.max(1, Math.ceil(recording.durationSeconds));
  const completed = await api.completeRecordingSession(sessionId, nextChunkIndex - 1, durationSeconds, { signal });
  if (completed.sessionId !== sessionId || completed.status !== "completed") {
    throw new Error("Recording completion was not confirmed.");
  }
  onUploadAccepted(recording.id);
  const remote = mergedAudioIsReady(completed)
    ? completed
    : await api.getRecordingSession(sessionId, { signal });
  return reconcileCompleted(remote, native, target, sessionId);
}
