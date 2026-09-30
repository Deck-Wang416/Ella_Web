import { getApiBase } from "./apiBase.js";
import { isNativeApp } from "./platform.js";

const STORAGE_PREFIX = "ella_native_push_subscription_id";
const pendingUpserts = new Map();
const blockedCaregivers = new Set();

function storageKey(caregiverId) {
  return `${STORAGE_PREFIX}_${caregiverId}`;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.detail || `Subscription request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function upsert(caregiverId, platform, token) {
  if (blockedCaregivers.has(caregiverId)) return null;
  const payload = { caregiver_id: caregiverId, platform, endpointOrToken: token };
  const base = `${getApiBase()}/subscriptions`;
  const existingId = localStorage.getItem(storageKey(caregiverId));
  if (existingId) {
    try {
      const updated = await request(`${base}/${encodeURIComponent(existingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpointOrToken: token, active: true }),
      });
      localStorage.setItem(storageKey(caregiverId), String(updated.id));
      return updated;
    } catch (error) {
      if (error.status !== 404) throw error;
      localStorage.removeItem(storageKey(caregiverId));
    }
  }
  const created = await request(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  localStorage.setItem(storageKey(caregiverId), String(created.id));
  return created;
}

export function upsertNativePushSubscription(caregiverId, platform, token) {
  if (blockedCaregivers.has(caregiverId)) return Promise.resolve(null);
  const previous = pendingUpserts.get(caregiverId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => upsert(caregiverId, platform, token));
  pendingUpserts.set(caregiverId, pending);
  void pending.finally(() => {
    if (pendingUpserts.get(caregiverId) === pending) pendingUpserts.delete(caregiverId);
  }).catch(() => {});
  return pending;
}

export function allowNativePushSubscription(caregiverId) {
  blockedCaregivers.delete(caregiverId);
}

async function deactivate(caregiverId) {
  await pendingUpserts.get(caregiverId)?.catch(() => {});
  const key = storageKey(caregiverId);
  const id = localStorage.getItem(key);
  if (!id) return;
  try {
    await request(`${getApiBase()}/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  localStorage.removeItem(key);
}

export async function deactivateNativePushSubscription(caregiverId) {
  if (!isNativeApp) return;
  blockedCaregivers.add(caregiverId);
  try {
    await deactivate(caregiverId);
  } catch (error) {
    blockedCaregivers.delete(caregiverId);
    throw error;
  }
}

export async function deactivateOtherNativePushSubscriptions(caregiverId) {
  if (!isNativeApp) return;
  const others = Object.keys(localStorage)
    .filter((key) => key.startsWith(`${STORAGE_PREFIX}_`))
    .map((key) => Number(key.slice(STORAGE_PREFIX.length + 1)))
    .filter((id) => Number.isInteger(id) && id > 0 && id !== caregiverId);
  for (const id of others) {
    blockedCaregivers.add(id);
    await deactivate(id);
  }
}
