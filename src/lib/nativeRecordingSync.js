import { nativeAudioSupported } from "./nativeAudioApi.js";
import { Capacitor } from "@capacitor/core";
import { SegmentedAudio } from "./nativeSegmentedAudioApi.js";
import * as recordingsApi from "./recordingsApi.js";
import { getApiBase } from "./apiBase.js";
import { reconcileIOSRecording } from "./iosRecordingTransfer.js";
import { transferNativeRecording } from "./nativeRecordingTransfer.js";

const listeners = new Set();
const running = new Map();
const snapshots = new Map();
const pausedCaregivers = new Set();
const acceptedIdsByCaregiver = new Map();
const iosNativeUpload = Capacitor.getPlatform() === "ios";

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
  return snapshots.get(caregiverId) ?? { status: "idle", pendingCount: 0, pendingUploadCount: 0, uploadCheckComplete: false, error: "" };
}

export function markNativeRecordingUploaded(caregiverId, recordingId) {
  const accepted = acceptedIdsByCaregiver.get(caregiverId) ?? new Set();
  if (accepted.has(recordingId)) return;
  accepted.add(recordingId);
  acceptedIdsByCaregiver.set(caregiverId, accepted);
  const pending = getNativeRecordingSyncState(caregiverId).pendingUploadCount;
  publish(caregiverId, { acceptedId: recordingId, pendingUploadCount: Math.max(0, pending - 1) });
}

export function cancelNativeRecordingSync(caregiverId) {
  running.get(caregiverId)?.controller.abort();
}

export async function pauseNativeRecordingSync(caregiverId) {
  pausedCaregivers.add(caregiverId);
  const active = running.get(caregiverId);
  active?.controller.abort();
  await active?.promise;
}

export function resumeNativeRecordingSync(caregiverId) {
  pausedCaregivers.delete(caregiverId);
  return syncNativeRecordings(caregiverId);
}

export async function syncNativeRecordings(caregiverId) {
  if (!nativeAudioSupported || !caregiverId || pausedCaregivers.has(caregiverId)) return;
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
      if (iosNativeUpload) {
        await SegmentedAudio.configureUploader({ caregiverId, apiBase: getApiBase() });
        await SegmentedAudio.syncUploads({ caregiverId });
      }
      const current = await SegmentedAudio.getPendingUploads({ caregiverId });
      const recordings = current.recordings || [];
      const acceptedIds = acceptedIdsByCaregiver.get(caregiverId) ?? new Set();
      acceptedIdsByCaregiver.set(caregiverId, acceptedIds);
      const localIds = new Set(recordings.map((recording) => recording.id));
      for (const id of acceptedIds) {
        if (!localIds.has(id)) acceptedIds.delete(id);
      }
      const pendingUploadCount = () => recordings.filter(
        (recording) => recording.stopped && !acceptedIds.has(recording.id)
      ).length;
      const unreadableCount = current.unreadableCount || 0;
      const cleanupFailureCount = current.cleanupFailureCount || 0;
      const scanError = unreadableCount > 0
        ? "Some local recordings could not be read."
        : cleanupFailureCount > 0 ? "Uploaded audio could not be removed from this device." : "";
      publish(caregiverId, {
        pendingCount: recordings.length,
        pendingUploadCount: pendingUploadCount(),
        uploadCheckComplete: true,
        unreadableCount,
        cleanupFailureCount,
        error: scanError,
      });
      let hadError = unreadableCount > 0 || cleanupFailureCount > 0;
      let unfinishedStatus = null;
      const failedRecordings = [];
      for (const recording of recordings) {
        if (controller.signal.aborted) return;
        publish(caregiverId, { status: "uploading", completedId: null });
        try {
          const finalized = await (iosNativeUpload ? reconcileIOSRecording : transferNativeRecording)(
            recording,
            caregiverId,
            SegmentedAudio,
            recordingsApi,
            controller.signal,
            (recordingId) => {
              acceptedIds.add(recordingId);
              publish(caregiverId, { acceptedId: recordingId, pendingUploadCount: pendingUploadCount() });
            }
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
          if (recording.stopped && !recording.uploadCompleted && error?.discardable !== false) {
            failedRecordings.push(recording);
          }
          publish(caregiverId, {
            status: "pending",
            error: error?.message || "Unable to upload saved audio.",
            failedRecordings: [...failedRecordings],
          });
          if (navigator.onLine === false) break;
        }
      }
      publish(caregiverId, {
        status: hadError ? "pending" : (unfinishedStatus || "idle"),
        completedId: null,
        error: hadError ? getNativeRecordingSyncState(caregiverId).error : "",
        failedRecordings,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        publish(caregiverId, { status: "pending", error: error?.message || "Unable to check saved audio.", failedRecordings: [] });
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
