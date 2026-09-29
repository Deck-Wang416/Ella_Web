import assert from "node:assert/strict";
import test from "node:test";
import { transferNativeRecording } from "../src/lib/nativeRecordingTransfer.js";

function setup({ size = 7, chunkSize = 3 } = {}) {
  const audio = Uint8Array.from({ length: size }, (_, index) => index + 1);
  const manifest = { sessionId: null, uploadedBytes: 0, nextChunkIndex: 0, uploaded: false };
  const calls = { created: 0, uploaded: [], completed: [], deleted: 0 };
  const recording = {
    id: "10000000-0000-0000-0000-000000000001",
    date: "2026-09-29",
    sizeBytes: size,
    durationSeconds: 6.3,
    ...manifest,
  };
  let remoteStatus = "recording";
  const native = {
    async setUploadSession({ sessionId }) { manifest.sessionId = sessionId; },
    async resetUploadSession() { Object.assign(manifest, { sessionId: null, uploadedBytes: 0, nextChunkIndex: 0 }); },
    async readUploadChunk() {
      const data = audio.subarray(manifest.uploadedBytes, manifest.uploadedBytes + chunkSize);
      return {
        base64: Buffer.from(data).toString("base64"),
        byteCount: data.length,
        chunkIndex: manifest.nextChunkIndex,
      };
    },
    async confirmUploadChunk({ sessionId, chunkIndex, byteCount }) {
      assert.equal(sessionId, manifest.sessionId);
      assert.equal(chunkIndex, manifest.nextChunkIndex);
      manifest.uploadedBytes += byteCount;
      manifest.nextChunkIndex += 1;
    },
    async deleteUploadedRecording({ sessionId }) {
      assert.equal(sessionId, manifest.sessionId);
      assert.equal(manifest.uploadedBytes, size);
      assert.equal(remoteStatus, "completed");
      manifest.uploaded = true;
      calls.deleted += 1;
    },
  };
  const api = {
    async createRecordingSession(date, caregiverId) {
      calls.created += 1;
      return { sessionId: "rec_test", caregiverId, date };
    },
    async getRecordingSession() {
      return { sessionId: "rec_test", caregiverId: 1, date: recording.date, status: remoteStatus };
    },
    async uploadRecordingChunk(sessionId, index, blob) {
      calls.uploaded.push({ index, bytes: [...new Uint8Array(await blob.arrayBuffer())], type: blob.type });
      return { sessionId, chunkIndex: index };
    },
    async completeRecordingSession(sessionId, finalChunkIndex, durationSeconds) {
      calls.completed.push({ finalChunkIndex, durationSeconds });
      remoteStatus = "completed";
      return { sessionId, status: "completed" };
    },
  };
  return { recording, manifest, native, api, calls, setRemoteStatus: (status) => { remoteStatus = status; } };
}

test("uploads ordered M4A byte slices, then completes with duration", async () => {
  const fixture = setup();
  await transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(fixture.calls.uploaded.flatMap(({ bytes }) => bytes), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(fixture.calls.uploaded.every(({ type }) => type === "audio/mp4"));
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
  assert.equal(fixture.manifest.uploadedBytes, 3);
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
  fixture.manifest.uploadedBytes = fixture.recording.sizeBytes;
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
  fixture.manifest.uploadedBytes = 3;
  fixture.manifest.nextChunkIndex = 1;
  fixture.api.getRecordingSession = async () => { throw Object.assign(new Error("missing"), { status: 404 }); };
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 1, 2]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("does not upload to a session owned by another caregiver", async () => {
  const fixture = setup();
  fixture.manifest.sessionId = "rec_test";
  fixture.api.getRecordingSession = async () => ({ caregiverId: 2, date: fixture.recording.date, status: "recording" });
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
  assert.equal(fixture.manifest.uploadedBytes, 0);
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.deepEqual(fixture.calls.uploaded.map(({ index }) => index), [0, 0, 1, 2]);
  assert.equal(fixture.manifest.uploaded, true);
  assert.equal(fixture.calls.deleted, 1);
});

test("invalid local audio never creates an empty server session", async () => {
  const fixture = setup({ size: 0 });
  await assert.rejects(transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api), /metadata is invalid/);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.deleted, 0);
});

test("failed completion retains local audio until the server confirms it", async () => {
  const fixture = setup();
  const complete = fixture.api.completeRecordingSession;
  let fail = true;
  fixture.api.completeRecordingSession = async (...args) => {
    if (fail) throw Object.assign(new Error("server unavailable"), { status: 503 });
    return complete(...args);
  };
  await assert.rejects(transferNativeRecording(fixture.recording, 1, fixture.native, fixture.api), /server unavailable/);
  assert.equal(fixture.manifest.uploadedBytes, fixture.recording.sizeBytes);
  assert.equal(fixture.calls.deleted, 0);

  fail = false;
  await transferNativeRecording({ ...fixture.recording, ...fixture.manifest }, 1, fixture.native, fixture.api);
  assert.equal(fixture.calls.created, 1);
  assert.equal(fixture.calls.deleted, 1);
});
