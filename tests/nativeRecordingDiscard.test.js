import assert from "node:assert/strict";
import test from "node:test";
import { discardSavedRecording } from "../src/lib/nativeRecordingDiscard.js";

function setup({ sessionId = "rec_test", stopped = true } = {}) {
  const calls = [];
  const recording = { id: "local_test", sessionId, stopped };
  const native = {
    async getPendingUploads() { calls.push("scan"); return { recordings: [recording] }; },
    async discardRecording(target) { calls.push("discard"); assert.equal(target.id, recording.id); },
  };
  const api = {
    async cancelRecordingSession(id, caregiverId) {
      calls.push("cancel");
      assert.equal(id, sessionId);
      assert.equal(caregiverId, 1);
      return { sessionId: id, status: "cancelled" };
    },
  };
  const sync = {
    async pauseNativeRecordingSync() { calls.push("pause"); },
    resumeNativeRecordingSync() { calls.push("resume"); },
  };
  return { calls, native, api, sync, recording };
}

test("discards only the selected stopped recording after server cancellation", async () => {
  const fixture = setup();
  fixture.native.getPendingUploads = async () => ({ recordings: [
    { id: "other", sessionId: "rec_other", stopped: true }, fixture.recording,
  ] });
  await discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync);
  assert.deepEqual(fixture.calls, ["pause", "cancel", "discard", "resume"]);
});

test("failed server cancellation retains local audio", async () => {
  const fixture = setup();
  fixture.api.cancelRecordingSession = async () => { fixture.calls.push("cancel"); throw new Error("offline"); };
  await assert.rejects(discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync), /offline/);
  assert.deepEqual(fixture.calls, ["pause", "scan", "cancel", "resume"]);
});

test("active recordings cannot be discarded", async () => {
  const fixture = setup({ stopped: false });
  await assert.rejects(discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync), /no longer available/);
  assert.deepEqual(fixture.calls, ["pause", "scan", "resume"]);
});

test("a local-only recording can be discarded without a server session", async () => {
  const fixture = setup({ sessionId: null });
  await discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync);
  assert.deepEqual(fixture.calls, ["pause", "scan", "discard", "resume"]);
});

test("failed local deletion leaves the cancelled recording available to retry", async () => {
  const fixture = setup();
  let fails = true;
  fixture.native.discardRecording = async () => {
    fixture.calls.push("discard");
    if (fails) throw new Error("file busy");
  };
  await assert.rejects(discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync), /file busy/);
  fails = false;
  await discardSavedRecording(1, fixture.recording.id, fixture.native, fixture.api, fixture.sync);
  assert.deepEqual(fixture.calls, ["pause", "scan", "cancel", "discard", "resume",
    "pause", "scan", "cancel", "discard", "resume"]);
});
