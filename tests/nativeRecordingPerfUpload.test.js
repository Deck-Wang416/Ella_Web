import assert from "node:assert/strict";
import test from "node:test";
import { flushRecordingPerf, queueRecordingPerf } from "../src/lib/nativeRecordingPerfUpload.js";

function memoryStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  globalThis.window = { __API_BASE: "https://example.test/api" };
  return values;
}

test("uploads bounded diagnostic batches without audio and preserves sequence numbers", async () => {
  const values = memoryStorage();
  const batches = [];
  globalThis.fetch = async (_url, options) => {
    batches.push(JSON.parse(options.body).events);
    return { ok: true, json: async () => ({ accepted: batches.at(-1).length }) };
  };

  for (let index = 0; index < 21; index += 1) {
    queueRecordingPerf("recording-1", "chunk confirmed", { recordingId: "recording-1", chunkIndex: index });
  }
  await flushRecordingPerf("recording-1", "rec_1", 1, true);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 1]);
  assert.deepEqual(batches.flat().map((event) => event.seq), Array.from({ length: 21 }, (_, index) => index));
  assert.equal(JSON.parse(values.get("ella:recording-perf:recording-1")).events.length, 0);

  queueRecordingPerf("recording-1", "complete confirmed", { recordingId: "recording-1", completeMs: 30 });
  await flushRecordingPerf("recording-1", "rec_1", 1, true);
  assert.equal(batches.at(-1)[0].seq, 21);
  assert.equal(values.has("ella:recording-perf:recording-1"), false);
});

test("retains diagnostics after a failed upload for a later retry", async () => {
  const values = memoryStorage();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ detail: "Unavailable" }) });
  queueRecordingPerf("recording-failed", "chunk confirmed", { recordingId: "recording-failed", chunkIndex: 0 });
  await flushRecordingPerf("recording-failed", "rec_failed", 1, true);
  assert.equal(JSON.parse(values.get("ella:recording-perf:recording-failed")).events.length, 1);
});
