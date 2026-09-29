import { NativeAudio, nativeAudioSupported } from "./nativeAudioApi.js";
import * as recordingsApi from "./recordingsApi.js";
import { transferNativeRecording } from "./nativeRecordingTransfer.js";

const listeners = new Set();
const running = new Map();
const snapshots = new Map();

function publish(caregiverId, state) {
  const next = { ...snapshots.get(caregiverId), ...state };
  snapshots.set(caregiverId, next);
  listeners.forEach((listener) => listener(caregiverId, next));
}

export function subscribeNativeRecordingSync(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNativeRecordingSyncState(caregiverId) {
  return snapshots.get(caregiverId) ?? { status: "idle", pendingCount: 0, error: "" };
}

export function cancelNativeRecordingSync(caregiverId) {
  running.get(caregiverId)?.controller.abort();
}

export async function syncNativeRecordings(caregiverId) {
  if (!nativeAudioSupported || !caregiverId) return;
  if (running.has(caregiverId)) {
    const active = running.get(caregiverId);
    if (active.controller.signal.aborted) {
      return active.promise.then(() => syncNativeRecordings(caregiverId));
    }
    active.rerunRequested = true;
    return active.promise;
  }

  const controller = new AbortController();
  const entry = { controller, promise: null, rerunRequested: false };
  const promise = (async () => {
    try {
      const { recordings, unreadableCount = 0, cleanupFailureCount = 0 } = await NativeAudio.getPendingUploads({ caregiverId });
      const scanError = unreadableCount > 0
        ? "Some local recordings could not be read."
        : cleanupFailureCount > 0 ? "Uploaded audio could not be removed from this iPhone." : "";
      publish(caregiverId, { pendingCount: recordings.length, unreadableCount, cleanupFailureCount, error: scanError });
      let hadError = unreadableCount > 0 || cleanupFailureCount > 0;
      for (const recording of recordings) {
        if (controller.signal.aborted) return;
        publish(caregiverId, { status: "uploading", progress: null, completedId: null });
        try {
          await transferNativeRecording(
            recording,
            caregiverId,
            NativeAudio,
            recordingsApi,
            controller.signal,
            (progress) => publish(caregiverId, { progress })
          );
          publish(caregiverId, { pendingCount: Math.max(0, getNativeRecordingSyncState(caregiverId).pendingCount - 1), completedId: recording.id });
        } catch (error) {
          if (controller.signal.aborted) return;
          hadError = true;
          publish(caregiverId, {
            status: "pending",
            error: error?.message || "Unable to upload saved audio.",
          });
          if (navigator.onLine === false) break;
        }
      }
      publish(caregiverId, {
        status: hadError ? "pending" : "idle",
        completedId: null,
        error: hadError ? getNativeRecordingSyncState(caregiverId).error : "",
        progress: null,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        publish(caregiverId, { status: "pending", error: error?.message || "Unable to check saved audio." });
      }
    } finally {
      if (running.get(caregiverId) === entry) {
        running.delete(caregiverId);
        if (entry.rerunRequested && !controller.signal.aborted) {
          queueMicrotask(() => void syncNativeRecordings(caregiverId));
        }
      }
    }
  })();
  entry.promise = promise;
  running.set(caregiverId, entry);
  return promise;
}
