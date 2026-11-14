export async function reconcileIOSRecording(recording, caregiverId, native, api, signal, onUploadAccepted) {
  if (recording.uploadError && !recording.uploadCompleted) {
    throw new Error(recording.uploadError);
  }
  if (!recording.sessionId || !recording.uploadCompleted) return false;
  onUploadAccepted(recording.id);
  const session = await api.getRecordingSession(recording.sessionId, { signal });
  if (session.caregiverId !== caregiverId || session.date !== recording.date ||
      session.chunkFormat !== "standalone" || session.status !== "completed") {
    throw new Error("Recording session does not match the saved audio.");
  }
  if (session.mergeStatus === "failed") {
    const error = new Error("Audio was uploaded, but processing failed. Please contact the ELLA team.");
    error.discardable = false;
    error.code = "merge_failed";
    throw error;
  }
  if (session.mergeStatus !== "completed" || !session.finalAudio?.storagePath) return false;
  try {
    await native.deleteUploadedRecording({ caregiverId, id: recording.id, sessionId: recording.sessionId });
  } catch (cause) {
    const error = new Error(cause?.message || "Unable to remove uploaded audio from this device.", { cause });
    error.discardable = false;
    throw error;
  }
  return true;
}
