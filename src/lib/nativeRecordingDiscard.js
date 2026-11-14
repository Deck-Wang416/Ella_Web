import { Capacitor } from "@capacitor/core";

export async function discardSavedRecording(caregiverId, recordingId, native, api, sync) {
  await sync.pauseNativeRecordingSync(caregiverId);
  const iosNativeUpload = Capacitor.getPlatform() === "ios";
  try {
    if (iosNativeUpload) await native.pauseUpload({ caregiverId, id: recordingId });
    const pending = await native.getPendingUploads({ caregiverId });
    const recording = (pending.recordings || []).find((item) => item.id === recordingId);
    if (!recording || !recording.stopped) {
      throw new Error("This recording is no longer available to discard.");
    }

    if (recording.sessionId) {
      const cancelled = await api.cancelRecordingSession(recording.sessionId, caregiverId);
      if (cancelled.sessionId !== recording.sessionId || cancelled.status !== "cancelled") {
        throw new Error("Server did not confirm the recording cancellation.");
      }
    }

    await native.discardRecording({ caregiverId, id: recordingId, sessionId: recording.sessionId ?? null });
    return recording;
  } finally {
    try {
      if (iosNativeUpload) await native.resumeUpload({ caregiverId, id: recordingId });
    } finally {
      void sync.resumeNativeRecordingSync(caregiverId);
    }
  }
}
