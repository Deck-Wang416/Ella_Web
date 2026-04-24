import { getApiBase } from "./apiBase.js";
import { ApiError, formatTodayDate } from "./dailyApi.js";

const API_BASE = getApiBase();

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

export async function getProfileByCaregiver(caregiverId) {
  return requestJson(`${API_BASE}/profiles/${encodeURIComponent(caregiverId)}`);
}

export async function updateProfileByCaregiver(caregiverId, payload) {
  return requestJson(`${API_BASE}/profiles/${encodeURIComponent(caregiverId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function compareDate(dateA, dateB) {
  return dateA.localeCompare(dateB);
}

function isInRange(date, range) {
  if (!range?.startDate || !range?.endDate) return false;
  return compareDate(range.startDate, date) <= 0 && compareDate(date, range.endDate) <= 0;
}

function formatModes(modes) {
  if (modes.length === 0) return "testing";
  if (modes.length === 1) {
    return {
      subject: `${modes[0]} testing`,
      periodLabel: "period",
      verb: "is",
    };
  }

  return {
    subject: `${modes.slice(0, -1).join(", ")} and ${modes[modes.length - 1]} testing`,
    periodLabel: "periods",
    verb: "are",
  };
}

export function deriveProfileStatus(profile, today = formatTodayDate()) {
  const robotRange = profile?.robot_condition_range || null;
  const parentRange = profile?.parent_condition_range || null;

  if (isInRange(today, robotRange)) {
    return { key: "robot-active", condition: "robot" };
  }

  if (isInRange(today, parentRange)) {
    return { key: "parent-active", condition: "parent" };
  }

  const validRanges = [
    robotRange ? { mode: "robot", ...robotRange } : null,
    parentRange ? { mode: "parent", ...parentRange } : null,
  ].filter(Boolean);

  if (!validRanges.length) {
    return {
      key: "before",
      title: "Your testing has not begun yet.",
      description: "Please come back when your assigned testing period begins.",
    };
  }

  const sortedByStart = [...validRanges].sort((a, b) => compareDate(a.startDate, b.startDate));
  const sortedByEnd = [...validRanges].sort((a, b) => compareDate(a.endDate, b.endDate));

  if (compareDate(today, sortedByStart[0].startDate) < 0) {
    const modes = formatModes(sortedByStart.map((item) => item.mode));
    return {
      key: "before",
      title: `Your ${modes.subject} has not begun yet.`,
      description: "Please come back when your assigned testing period begins.",
    };
  }

  if (
    robotRange &&
    parentRange &&
    compareDate(robotRange.endDate, today) < 0 &&
    compareDate(today, parentRange.startDate) < 0 &&
    compareDate(robotRange.startDate, parentRange.startDate) <= 0
  ) {
    return {
      key: "between",
      title: "Your robot testing is already finished, but your parent testing has not begun yet.",
      description: "Please come back when your next testing period begins.",
    };
  }

  if (
    robotRange &&
    parentRange &&
    compareDate(parentRange.endDate, today) < 0 &&
    compareDate(today, robotRange.startDate) < 0 &&
    compareDate(parentRange.startDate, robotRange.startDate) <= 0
  ) {
    return {
      key: "between",
      title: "Your parent testing is already finished, but your robot testing has not begun yet.",
      description: "Please come back when your next testing period begins.",
    };
  }

  if (compareDate(sortedByEnd[sortedByEnd.length - 1].endDate, today) < 0) {
    const modes = formatModes(sortedByEnd.map((item) => item.mode));
    return {
      key: "finished",
      title: `Your ${modes.subject} ${modes.periodLabel} ${modes.verb} finished.`,
      description: "This account is no longer in an active testing period.",
    };
  }

  return {
    key: "before",
    title: "Your testing has not begun yet.",
    description: "Please come back when your assigned testing period begins.",
  };
}
