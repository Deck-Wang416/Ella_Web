import assert from "node:assert/strict";
import test from "node:test";
import { reconcileIOSRecording } from "../src/lib/iosRecordingTransfer.js";

const recording = {
  id: "10000000-0000-0000-0000-000000000001",
  date: "2026-11-14",
  sessionId: "rec_test",
  uploadCompleted: true,
};

test("iOS waits for native completion and verified merge before local cleanup", async () => {
  const accepted = [];
  const deleted = [];
  const native = { deleteUploadedRecording: async (value) => deleted.push(value) };
  const api = { getRecordingSession: async () => ({
    caregiverId: 6, date: recording.date, chunkFormat: "standalone", status: "completed",
    mergeStatus: "pending", finalAudio: null,
  }) };

  assert.equal(await reconcileIOSRecording({ ...recording, uploadCompleted: false }, 6, native, api,
    undefined, (id) => accepted.push(id)), false);
  assert.deepEqual(accepted, []);

  assert.equal(await reconcileIOSRecording(recording, 6, native, api, undefined,
    (id) => accepted.push(id)), false);
  assert.deepEqual(deleted, []);
  api.getRecordingSession = async () => ({
    caregiverId: 6, date: recording.date, chunkFormat: "standalone", status: "completed",
    mergeStatus: "completed", finalAudio: { storagePath: "audio/recording.m4a" },
  });
  assert.equal(await reconcileIOSRecording(recording, 6, native, api, undefined,
    (id) => accepted.push(id)), true);
  assert.deepEqual(deleted, [{ caregiverId: 6, id: recording.id, sessionId: recording.sessionId }]);
});

test("iOS refuses cleanup for a mismatched session", async () => {
  const native = { deleteUploadedRecording: async () => assert.fail("must not delete") };
  const api = { getRecordingSession: async () => ({
    caregiverId: 7, date: recording.date, chunkFormat: "standalone", status: "completed",
  }) };
  await assert.rejects(reconcileIOSRecording(recording, 6, native, api, undefined, () => {}), /does not match/);
});

test("iOS surfaces a native upload error without treating it as a completed recording", async () => {
  await assert.rejects(
    reconcileIOSRecording({ ...recording, uploadCompleted: false, uploadError: "Chunk rejected" }, 6,
      {}, {}, undefined, () => assert.fail("must not accept")),
    /Chunk rejected/
  );
});
