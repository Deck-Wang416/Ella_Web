export async function hasUnacceptedNativeRecording(caregiverId, native, api) {
  const { recordings = [], unreadableCount = 0 } = await native.getPendingUploads({ caregiverId });
  if (unreadableCount > 0) return true;

  for (const recording of recordings) {
    if (!recording.stopped || !recording.sessionId) return true;
    try {
      const session = await api.getRecordingSession(recording.sessionId);
      if (session?.status !== "completed" || session.caregiverId !== caregiverId ||
          session.date !== recording.date) return true;
    } catch {
      // When completion cannot be verified, keep the local recording protected.
      return true;
    }
  }

  return false;
}
