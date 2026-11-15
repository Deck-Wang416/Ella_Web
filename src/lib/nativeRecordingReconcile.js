export async function reconcileNativeRecording(recording, caregiverId, api, signal, onUploadAccepted) {
  if (recording.uploadError && !recording.uploadCompleted) {
    throw new Error(recording.uploadError);
  }
  if (!recording.sessionId || !recording.uploadCompleted) return false;
  const session = await api.getRecordingSession(recording.sessionId, { signal });
  if (session.caregiverId !== caregiverId || session.date !== recording.date ||
      session.chunkFormat !== "standalone" || session.status !== "completed" ||
      session.uploadedChunks !== recording.segmentCount ||
      session.lastChunkIndex !== recording.segmentCount - 1) {
    throw new Error("Recording session does not match the saved audio.");
  }
  onUploadAccepted(recording.id);
  // The native uploader removes local segments after the server confirms completion.
  return true;
}
