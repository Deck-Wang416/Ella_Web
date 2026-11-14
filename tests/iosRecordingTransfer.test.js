import assert from "node:assert/strict";
import test from "node:test";
import { reconcileIOSRecording } from "../src/lib/iosRecordingTransfer.js";

const recording = {
  id: "10000000-0000-0000-0000-000000000001",
  date: "2026-11-14",
  sessionId: "rec_test",
  uploadCompleted: true,
  segmentCount: 2,
};

test("iOS accepts native completion without waiting for merge or requesting JS cleanup", async () => {
  const accepted = [];
  const api = { getRecordingSession: async () => ({
    caregiverId: 6, date: recording.date, chunkFormat: "standalone", status: "completed",
    mergeStatus: "pending", finalAudio: null, uploadedChunks: 2, lastChunkIndex: 1,
  }) };

  assert.equal(await reconcileIOSRecording({ ...recording, uploadCompleted: false }, 6, {}, api,
    undefined, (id) => accepted.push(id)), false);
  assert.deepEqual(accepted, []);

  assert.equal(await reconcileIOSRecording(recording, 6, {
    deleteUploadedRecording: async () => assert.fail("JS must not delete iOS audio"),
  }, api, undefined,
    (id) => accepted.push(id)), true);
  assert.deepEqual(accepted, [recording.id]);
});

test("iOS refuses cleanup for a mismatched session", async () => {
  const api = { getRecordingSession: async () => ({
    caregiverId: 7, date: recording.date, chunkFormat: "standalone", status: "completed",
  }) };
  await assert.rejects(reconcileIOSRecording(recording, 6, {}, api, undefined, () => {}), /does not match/);
});

test("iOS does not accept a completed session with missing chunks", async () => {
  const api = { getRecordingSession: async () => ({
    caregiverId: 6, date: recording.date, chunkFormat: "standalone", status: "completed",
    uploadedChunks: 1, lastChunkIndex: 0,
  }) };
  await assert.rejects(
    reconcileIOSRecording(recording, 6, {}, api, undefined, () => {}),
    /does not match/
  );
});

test("iOS surfaces a native upload error without treating it as a completed recording", async () => {
  await assert.rejects(
    reconcileIOSRecording({ ...recording, uploadCompleted: false, uploadError: "Chunk rejected" }, 6,
      {}, {}, undefined, () => assert.fail("must not accept")),
    /Chunk rejected/
  );
});
