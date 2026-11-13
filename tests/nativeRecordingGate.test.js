import assert from "node:assert/strict";
import test from "node:test";
import { hasUnacceptedNativeRecording } from "../src/lib/nativeRecordingGate.js";

const caregiverId = 6;
const saved = { id: "local-1", date: "2026-11-11", stopped: true, sessionId: "rec-1" };

function fixture(recordings, status = "recording") {
  return {
    native: { async getPendingUploads() { return { recordings }; } },
    api: { async getRecordingSession() { return { status, caregiverId, date: saved.date }; } },
  };
}

test("allows a new recording when no local audio is waiting", async () => {
  const { native, api } = fixture([]);
  assert.equal(await hasUnacceptedNativeRecording(caregiverId, native, api), false);
});

test("blocks a new recording while earlier audio is still uploading", async () => {
  const { native, api } = fixture([saved]);
  assert.equal(await hasUnacceptedNativeRecording(caregiverId, native, api), true);
});

test("allows a new recording after complete, without waiting for merge", async () => {
  const { native, api } = fixture([saved], "completed");
  assert.equal(await hasUnacceptedNativeRecording(caregiverId, native, api), false);
});

test("blocks an unsent local recording and an unverifiable remote session", async () => {
  const { native, api } = fixture([{ ...saved, sessionId: null }]);
  assert.equal(await hasUnacceptedNativeRecording(caregiverId, native, api), true);
  const second = fixture([saved]);
  second.api.getRecordingSession = async () => { throw new Error("offline"); };
  assert.equal(await hasUnacceptedNativeRecording(caregiverId, second.native, second.api), true);
});
