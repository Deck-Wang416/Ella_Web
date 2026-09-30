import { NativeAudio, nativeAudioSupported } from "./nativeAudioApi.js";
import { SegmentedAudio } from "./nativeSegmentedAudioApi.js";
import { Capacitor } from "@capacitor/core";
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
      const current = await SegmentedAudio.getPendingUploads({ caregiverId });
      const legacy = Capacitor.getPlatform() === "ios"
        ? await NativeAudio.getPendingUploads({ caregiverId })
        : { recordings: [], unreadableCount: 0, cleanupFailureCount: 0 };
      const recordings = [...(legacy.recordings || []), ...(current.recordings || [])];
      const unreadableCount = (legacy.unreadableCount || 0) + (current.unreadableCount || 0);
      const cleanupFailureCount = (legacy.cleanupFailureCount || 0) + (current.cleanupFailureCount || 0);
      const scanError = unreadableCount > 0
        ? "Some local recordings could not be read."
        : cleanupFailureCount > 0 ? "Uploaded audio could not be removed from this device." : "";
      publish(caregiverId, { pendingCount: recordings.length, unreadableCount, cleanupFailureCount, error: scanError });
      let hadError = unreadableCount > 0 || cleanupFailureCount > 0;
      let unfinishedStatus = null;
      for (const recording of recordings) {
        if (controller.signal.aborted) return;
        publish(caregiverId, { status: "uploading", progress: null, completedId: null });
        try {
          const native = recording.format === "standalone" ? SegmentedAudio : NativeAudio;
          const finalized = await transferNativeRecording(
            recording,
            caregiverId,
            native,
            recordingsApi,
            controller.signal,
            (progress) => publish(caregiverId, { progress })
          );
          if (finalized) {
            publish(caregiverId, {
              pendingCount: Math.max(0, getNativeRecordingSyncState(caregiverId).pendingCount - 1),
              completedId: recording.id,
            });
          } else {
            unfinishedStatus = recording.stopped ? "processing" : "uploading";
          }
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
        status: hadError ? "pending" : (unfinishedStatus || "idle"),
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
