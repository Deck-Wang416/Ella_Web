import { getApiBase } from "./apiBase.js";
import { ApiError } from "./dailyApi.js";

const API_BASE = getApiBase();
const CHILD_ID = 1;

async function requestJson(url, options) {
  const response = await fetch(url, options);
  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      (data && (data.message || data.error || data.detail)) ||
      `Request failed (${response.status})`;
    throw new ApiError(response.status, message, data);
  }

  return data;
}

export async function createRecordingSession(date, caregiverId, options = {}) {
  return requestJson(`${API_BASE}/recordings/sessions`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      date,
      caregiverId,
      childId: CHILD_ID,
      chunkFormat: options.chunkFormat || "byte_stream",
    }),
  });
}

export async function getRecordingSession(sessionId, options = {}) {
  return requestJson(`${API_BASE}/recordings/sessions/${encodeURIComponent(sessionId)}`, {
    signal: options.signal,
  });
}

export async function uploadRecordingChunk(sessionId, chunkIndex, blob, options = {}) {
  if (!sessionId) {
    throw new Error("Missing recording session id.");
  }
  const mimeType = blob.type || "audio/webm";
  const url =
    `${API_BASE}/recordings/sessions/${encodeURIComponent(sessionId)}/chunks` +
    `?chunkIndex=${chunkIndex}&mimeType=${encodeURIComponent(mimeType)}`;

  return requestJson(url, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": mimeType,
    },
    body: blob,
  });
}

export async function completeRecordingSession(sessionId, finalChunkIndex, durationSeconds, options = {}) {
  return requestJson(`${API_BASE}/recordings/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      finalChunkIndex,
      durationSeconds,
    }),
  });
}
