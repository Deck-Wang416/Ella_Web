import { getApiBase } from "./apiBase.js";

const KEY_PREFIX = "ella:recording-perf:";
const BATCH_SIZE = 20;
const pendingRequests = new Map();

async function uploadRecordingPerf(sessionId, events) {
  const response = await fetch(`${getApiBase()}/recordings/sessions/${encodeURIComponent(sessionId)}/perf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!response.ok) throw new Error(`Performance log upload failed (${response.status})`);
  return response.json();
}

function read(recordingId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${KEY_PREFIX}${recordingId}`));
    if (Number.isSafeInteger(saved?.nextSeq) && Array.isArray(saved.events)) return saved;
  } catch {
    // Diagnostics must never interfere with recording.
  }
  return { nextSeq: 0, events: [], sessionId: null, caregiverId: null, finished: false };
}

function write(recordingId, state) {
  try {
    const key = `${KEY_PREFIX}${recordingId}`;
    if (state.finished && !state.events.length) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    // Storage may be unavailable; keep recording independent of diagnostics.
    return false;
  }
}

export function queueRecordingPerf(recordingId, name, details) {
  const state = read(recordingId);
  state.events.push({ seq: state.nextSeq++, name, at: new Date().toISOString(), ...details });
  if (name === "complete confirmed") state.finished = true;
  write(recordingId, state);
}

export function flushRecordingPerf(recordingId, sessionId, caregiverId, force = false) {
  if (!sessionId) return Promise.resolve();
  if (pendingRequests.has(recordingId)) {
    return pendingRequests.get(recordingId).then((success) =>
      success && force ? flushRecordingPerf(recordingId, sessionId, caregiverId, true) : undefined);
  }
  const state = read(recordingId);
  if (!state.events.length) return Promise.resolve();
  if (state.sessionId && state.sessionId !== sessionId) {
    state.events = [];
    state.nextSeq = 0;
    state.finished = false;
  }
  state.sessionId = sessionId;
  state.caregiverId = caregiverId;
  write(recordingId, state);
  if (state.events.length < (force ? 1 : BATCH_SIZE)) return Promise.resolve();
  const events = state.events.slice(0, BATCH_SIZE);
  const request = uploadRecordingPerf(sessionId, events)
    .then((result) => {
      if (result?.accepted !== events.length) return false;
      const latest = read(recordingId);
      latest.events = latest.events.filter((event) => event.seq > events.at(-1).seq);
      return write(recordingId, latest);
    })
    .catch(() => false)
    .finally(() => pendingRequests.delete(recordingId));
  pendingRequests.set(recordingId, request);
  return force ? request.then((success) => success
    ? flushRecordingPerf(recordingId, sessionId, caregiverId, true) : undefined) : request;
}

export function flushSavedRecordingPerf(caregiverId) {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const recordingId = key.slice(KEY_PREFIX.length);
      const state = read(recordingId);
      if (state.caregiverId === caregiverId && state.sessionId && state.events.length) {
        void flushRecordingPerf(recordingId, state.sessionId, caregiverId, true);
      }
    }
  } catch {
    // Diagnostics must never interfere with app startup.
  }
}
