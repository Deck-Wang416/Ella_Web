import { getApiBase } from "./apiBase.js";

const API_BASE = getApiBase();
const TIMEZONE = "America/New_York";

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function withDailyQuery(path, caregiverId) {
  const tz = encodeURIComponent(TIMEZONE);
  const id = encodeURIComponent(caregiverId);
  const join = path.includes("?") ? "&" : "?";
  return `${API_BASE}${path}${join}timezone=${tz}&caregiver_id=${id}`;
}

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

export async function listDailySummaries(caregiverId) {
  const data = await requestJson(withDailyQuery("/daily/summaries", caregiverId));
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export async function getDailyByDate(date, caregiverId) {
  return requestJson(withDailyQuery(`/daily/${date}`, caregiverId));
}

export async function updateDailyByDate(date, payload, caregiverId) {
  return requestJson(withDailyQuery(`/daily/${date}`, caregiverId), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function initializeDailyByDate(date, condition, caregiverId) {
  return requestJson(withDailyQuery(`/daily/${date}/initialize`, caregiverId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ condition }),
  });
}

export function formatTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nearestDate(targetDate, dates) {
  if (!dates.length) return null;

  const toLocalDate = (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const target = toLocalDate(targetDate).getTime();
  let best = dates[0];
  let bestDiff = Math.abs(toLocalDate(best).getTime() - target);

  dates.forEach((dateStr) => {
    const diff = Math.abs(toLocalDate(dateStr).getTime() - target);
    if (diff < bestDiff) {
      best = dateStr;
      bestDiff = diff;
    }
  });

  return best;
}
