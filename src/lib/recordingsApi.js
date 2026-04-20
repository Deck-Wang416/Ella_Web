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

export async function createRecordingSession(date, caregiverId) {
  return requestJson(`${API_BASE}/recordings/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      date,
      caregiverId,
      childId: CHILD_ID,
    }),
  });
}

export async function uploadRecordingChunk(sessionId, chunkIndex, blob) {
  if (!sessionId) {
    throw new Error("Missing recording session id.");
  }
  const mimeType = blob.type || "audio/webm";
  const url =
    `${API_BASE}/recordings/sessions/${encodeURIComponent(sessionId)}/chunks` +
    `?chunkIndex=${chunkIndex}&mimeType=${encodeURIComponent(mimeType)}`;

  return requestJson(url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
    },
    body: blob,
  });
}

export async function completeRecordingSession(sessionId, finalChunkIndex) {
  return requestJson(`${API_BASE}/recordings/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      finalChunkIndex,
    }),
  });
}
