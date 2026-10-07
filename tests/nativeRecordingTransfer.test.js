import assert from "node:assert/strict";
import test from "node:test";
import { transferNativeRecording } from "../src/lib/nativeRecordingTransfer.js";

function setup({ size = 7, chunkSize = 3 } = {}) {
  const audio = Uint8Array.from({ length: size }, (_, index) => index + 1);
  const manifest = { sessionId: null, nextChunkIndex: 0, uploaded: false };
  const calls = { created: 0, uploaded: [], completed: [], deleted: 0 };
  const recording = {
    id: "10000000-0000-0000-0000-000000000001",
    date: "2026-09-29",
    format: "standalone",
    segmentCount: Math.ceil(size / chunkSize),
    stopped: true,
    durationSeconds: 6.3,
    ...manifest,
  };
  let remoteStatus = "recording";
  let mergeStatus = "completed";
  const native = {
    async setUploadSession({ sessionId }) { manifest.sessionId = sessionId; },
    async resetUploadSession() { Object.assign(manifest, { sessionId: null, nextChunkIndex: 0 }); },
    async readUploadChunk() {
      const offset = manifest.nextChunkIndex * chunkSize;
      const data = audio.subarray(offset, offset + chunkSize);
      return {
        base64: Buffer.from(data).toString("base64"),
        byteCount: data.length,
        chunkIndex: manifest.nextChunkIndex,
      };
    },
    async confirmUploadChunk({ sessionId, chunkIndex }) {
      assert.equal(sessionId, manifest.sessionId);
      assert.equal(chunkIndex, manifest.nextChunkIndex);
      manifest.nextChunkIndex += 1;
    },
    async deleteUploadedRecording({ sessionId }) {
      assert.equal(sessionId, manifest.sessionId);
      assert.equal(manifest.nextChunkIndex, recording.segmentCount);
      assert.equal(remoteStatus, "completed");
      manifest.uploaded = true;
      calls.deleted += 1;
    },
  };
  const api = {
    async createRecordingSession(date, caregiverId, options) {
      assert.equal(options.chunkFormat, "standalone");
      calls.created += 1;
      return { sessionId: "rec_test", caregiverId, date };
    },
    async getRecordingSession() {
      return {
        sessionId: "rec_test", caregiverId: 1, date: recording.date,
        chunkFormat: "standalone", status: remoteStatus,
        mergeStatus, finalAudio: mergeStatus === "completed" ? { storagePath: "audio/test/recording.m4a" } : null,
      };
    },
    async uploadRecordingChunk(sessionId, index, blob) {
      calls.uploaded.push({ index, bytes: [...new Uint8Array(await blob.arrayBuffer())], type: blob.type });
      return { sessionId, chunkIndex: index };
    },
    async completeRecordingSession(sessionId, finalChunkIndex, durationSeconds) {
      calls.completed.push({ finalChunkIndex, durationSeconds });
      remoteStatus = "completed";
      return { sessionId, status: "completed", mergeStatus: "pending" };
    },
  };
  return {
    recording, manifest, native, api, calls,
    setRemoteStatus: (status) => { remoteStatus = status; },
    setMergeStatus: (status) => { mergeStatus = status; },
  };
}

test("uploads ordered standalone WAV segments, then completes with duration", async () => {
  const fixture = setup();
  await transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(fixture.calls.uploaded.flatMap(({ bytes }) => bytes), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(fixture.calls.uploaded.every(({ type }) => type === "audio/wav"));
  assert.deepEqual(fixture.calls.completed, [{ finalChunkIndex: 2, durationSeconds: 7 }]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("failed chunk keeps durable progress and resumes without creating a second session", async () => {
  const fixture = setup();
  let failIndexOne = true;
  const upload = fixture.api.uploadRecordingChunk;
  fixture.api.uploadRecordingChunk = async (...args) => {
    if (args[1] === 1 && failIndexOne) throw Object.assign(new Error("offline"), { status: 400 });
    return upload(...args);
  };
  await assert.rejects(transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api), /offline/);
  assert.equal(fixture.manifest.nextChunkIndex, 1);
  assert.equal(fixture.manifest.nextChunkIndex, 1);
  assert.equal(fixture.calls.completed.length, 0);
  assert.equal(fixture.calls.deleted, 0);

  failIndexOne = false;
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1, 2]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("completed remote session is reconciled without calling complete twice", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.manifest.nextChunkIndex = 3;
  fixture.setRemoteStatus("completed");
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.completed.length, 0);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("missing server session restarts upload from the saved local file", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "stale";
  fixture.manifest.nextChunkIndex = 1;
  const getSession = fixture.api.getRecordingSession;
  fixture.api.getRecordingSession = async (sessionId) => {
    if (sessionId === "stale") throw Object.assign(new Error("missing"), { status: 404 });
    return getSession(sessionId);
  };
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1, 2]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("cancelled remote session never reuploads retained local audio", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.manifest.nextChunkIndex = 1;
  fixture.setRemoteStatus("cancelled");

  await assert.rejects(
    transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api),
    /cancelled/
  );
  assert.equal(fixture.manifest.sessionId, "rec_test");
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.uploaded.length, 0);
  assert.equal(fixture.calls.deleted, 0);
});

test("does not upload to a session owned by another caregiver", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.api.getRecordingSession = async () => ({ caregiverId: 2, date: fixture.recording.date, chunkFormat: "standalone", status: "recording" });
  await assert.rejects(
    transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api),
    /different caregiver/
  );
  assert.equal(fixture.calls.uploaded.length, 0);
  assert.equal(fixture.calls.deleted, 0);
});

test("a lost local acknowledgement safely resends the same chunk index", async () => {
  const fixture = setup();
  const confirm = fixture.native.confirmUploadChunk;
  let loseAck = true;
  fixture.native.confirmUploadChunk = async (...args) => {
    if (loseAck) {
      loseAck = false;
      throw new Error("local write failed");
    }
    return confirm(...args);
  };
  await assert.rejects(transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api), /local write failed/);
  assert.equal(fixture.manifest.nextChunkIndex, 0);
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 0, 1, 2]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("zero segments never create an empty server session", async () => {
  const fixture = setup({ size: 0 });
  assert.equal(await transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api), false);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.deleted, 0);
});

test("old byte-stream recordings are not accepted by the native transfer", async () => {
  const fixture = setup();
  await assert.rejects(
    transferNativeRecording({ ...fixture.recording, format: "byte_stream" }, 1, fixture.native, fixture.api),
    /metadata is invalid/
  );
  assert.equal(fixture.calls.created, 0);
});

test("failed completion retains local audio until the server confirms it", async () => {
  const fixture = setup();
  const complete = fixture.api.completeRecordingSession;
  let fail = true;
  const accepted = [];
  fixture.api.completeRecordingSession = async (...args) => {
    if (fail) throw Object.assign(new Error("server unavailable"), { status: 503 });
    return complete(...args);
  };
  await assert.rejects(
    transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api, undefined,
      (recordingId) => accepted.push(recordingId)),
    /server unavailable/
  );
  assert.equal(fixture.manifest.nextChunkIndex, fixture.recording.segmentCount);
  assert.equal(fixture.calls.deleted, 0);
  assert.deepEqual(accepted, []);

  fail = false;
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.equal(fixture.calls.deleted, 1);
});

test("completed session retains local audio until the final merged file exists", async () => {
  const fixture = setup();
  fixture.setMergeStatus("pending");
  const accepted = [];
  const first = await transferNativeRecording(
    fixture.recording, 1, fixture.native, fixture.api, undefined,
    (recordingId) => accepted.push(recordingId)
  );
  assert.equal(first, false);
  assert.equal(fixture.calls.deleted, 0);
  assert.deepEqual(accepted, [fixture.recording.id]);

  fixture.setMergeStatus("completed");
  const second = await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(second, true);
  assert.equal(fixture.calls.deleted, 1);
  assert.equal(fixture.calls.completed.length, 1);
});

test("upload acceptance is restored from a completed session after reopening", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.manifest.nextChunkIndex = fixture.recording.segmentCount;
  fixture.setRemoteStatus("completed");
  fixture.setMergeStatus("pending");
  const accepted = [];

  const finalized = await transferNativeRecording(
    { ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api,
    undefined, (recordingId) => accepted.push(recordingId)
  );

  assert.equal(finalized, false);
  assert.deepEqual(accepted, [fixture.recording.id]);
  assert.equal(fixture.calls.completed.length, 0);
  assert.equal(fixture.calls.deleted, 0);
});

test("verified merge permits cleanup after a lost local final acknowledgement", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.manifest.nextChunkIndex = 2;
  fixture.setRemoteStatus("completed");
  fixture.native.deleteUploadedRecording = async ({ sessionId }) => {
    assert.equal(sessionId, fixture.manifest.sessionId);
    fixture.calls.deleted += 1;
  };
  const finalized = await transferNativeRecording(
    { ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api
  );
  assert.equal(finalized, true);
  assert.equal(fixture.calls.deleted, 1);
  assert.equal(fixture.calls.uploaded.length, 0);
});

test("failed merge retains local audio", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.setRemoteStatus("completed");
  fixture.setMergeStatus("failed");
  await assert.rejects(
    transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api),
    (error) => error.discardable === false && error.code === "merge_failed"
  );
  assert.equal(fixture.calls.deleted, 0);
});

test("failed local cleanup of a completed session is not offered for cancellation", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.setRemoteStatus("completed");
  fixture.native.deleteUploadedRecording = async () => { throw new Error("file busy"); };
  await assert.rejects(
    transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api),
    (error) => error.discardable === false && /file busy/.test(error.message)
  );
});

test("standalone segments upload during recording and complete only after stop", async () => {
  const fixture = setup();
  const recording = { ...fixture.recording, format: "standalone", segmentCount: 2, stopped: false, durationSeconds: 6 };
  fixture.native.readUploadChunk = async () => ({
    base64: Buffer.from([1, 2, 3]).toString("base64"), byteCount: 3, chunkIndex: fixture.manifest.nextChunkIndex,
  });
  fixture.native.confirmUploadChunk = async ({ chunkIndex }) => {
    assert.equal(chunkIndex, fixture.manifest.nextChunkIndex);
    fixture.manifest.nextChunkIndex += 1;
  };
  fixture.native.deleteUploadedRecording = async () => { fixture.calls.deleted += 1; };
  fixture.api.createRecordingSession = async (date, caregiverId, options) => {
    assert.equal(options.chunkFormat, "standalone");
    fixture.calls.created += 1;
    return { sessionId: "rec_test", caregiverId, date };
  };
  let remoteStatus = "recording";
  fixture.api.getRecordingSession = async () => ({
    sessionId: "rec_test", caregiverId: 1, date: recording.date, chunkFormat: "standalone",
    status: remoteStatus, mergeStatus: "completed", finalAudio: { storagePath: "audio/test/recording.m4a" },
  });
  const complete = fixture.api.completeRecordingSession;
  fixture.api.completeRecordingSession = async (...args) => {
    const result = await complete(...args);
    remoteStatus = "completed";
    return result;
  };
  assert.equal(await transferNativeRecording(recording, 1, fixture.native, fixture.api), false);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1]);
  assert.equal(fixture.calls.completed.length, 0);

  assert.equal(await transferNativeRecording({ ...recording, ...fixture.manifest, segmentCount: 2, stopped: true },
    1, fixture.native, fixture.api), true);
  assert.deepEqual(fixture.calls.completed, [{ finalChunkIndex: 1, durationSeconds: 6 }]);
  assert.equal(fixture.calls.deleted, 1);
});

test("an auto-stopped recording retains unsent segments and completes after retry", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.manifest.nextChunkIndex = 1;
  const recording = {
    ...fixture.recording, ...fixture.manifest,
    format: "standalone", segmentCount: 3, stopped: true, durationSeconds: 8.4,
  };
  fixture.native.readUploadChunk = async () => ({
    base64: Buffer.from([1, 2, 3]).toString("base64"),
    byteCount: 3,
    chunkIndex: fixture.manifest.nextChunkIndex,
  });
  fixture.native.confirmUploadChunk = async ({ chunkIndex }) => {
    assert.equal(chunkIndex, fixture.manifest.nextChunkIndex);
    fixture.manifest.nextChunkIndex += 1;
  };
  fixture.native.deleteUploadedRecording = async () => { fixture.calls.deleted += 1; };
  let remoteStatus = "recording";
  fixture.api.getRecordingSession = async () => ({
    caregiverId: 1, date: recording.date, chunkFormat: "standalone", status: remoteStatus,
    mergeStatus: "completed", finalAudio: { storagePath: "audio/test/recording.m4a" },
  });
  const upload = fixture.api.uploadRecordingChunk;
  let fail = true;
  fixture.api.uploadRecordingChunk = async (...args) => {
    if (fail) throw Object.assign(new Error("upload unavailable"), { status: 400 });
    return upload(...args);
  };
  const complete = fixture.api.completeRecordingSession;
  fixture.api.completeRecordingSession = async (...args) => {
    const result = await complete(...args);
    remoteStatus = "completed";
    return result;
  };

  await assert.rejects(transferNativeRecording(recording, 1, fixture.native, fixture.api), (error) => {
    assert.match(error.message, /upload unavailable/);
    assert.equal(error.recordingSessionId, "rec_test");
    assert.equal(error.chunkIndex, 1);
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(fixture.manifest.nextChunkIndex, 1);
  assert.equal(fixture.calls.completed.length, 0);
  assert.equal(fixture.calls.deleted, 0);

  fail = false;
  assert.equal(await transferNativeRecording({ ...recording, ...fixture.manifest },
    1, fixture.native, fixture.api), true);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [1, 2]);
  assert.deepEqual(fixture.calls.completed, [{ finalChunkIndex: 2, durationSeconds: 9 }]);
  assert.equal(fixture.calls.deleted, 1);
});
