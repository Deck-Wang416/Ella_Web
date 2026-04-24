import { getApiBase } from "./apiBase.js";

const API_BASE = getApiBase();
const SUBSCRIPTION_ID_KEY_PREFIX = "ella_web_push_subscription_id";

function toSubscriptionPayload(subscription, caregiverId) {
  const json = subscription.toJSON();
  return {
    caregiver_id: caregiverId,
    platform: "web_push",
    endpointOrToken: json.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || "",
      auth: json.keys?.auth || "",
    },
  };
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
    const detail = data?.detail || data?.message || data?.error || "Request failed";
    const error = new Error(`${detail} (${response.status})`);
    error.status = response.status;
    error.url = url;
    error.responseBody = data;
    throw error;
  }

  return { url, status: response.status, data };
}

function getSubscriptionStorageKey(caregiverId) {
  return `${SUBSCRIPTION_ID_KEY_PREFIX}_${caregiverId}`;
}

function getStoredSubscriptionId(caregiverId) {
  return localStorage.getItem(getSubscriptionStorageKey(caregiverId));
}

function setStoredSubscriptionId(caregiverId, id) {
  if (!id) return;
  localStorage.setItem(getSubscriptionStorageKey(caregiverId), String(id));
}

function clearStoredSubscriptionId(caregiverId) {
  localStorage.removeItem(getSubscriptionStorageKey(caregiverId));
}

function getAllStoredSubscriptionIds() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(`${SUBSCRIPTION_ID_KEY_PREFIX}_`))
    .map((key) => {
      const caregiverId = Number(key.replace(`${SUBSCRIPTION_ID_KEY_PREFIX}_`, ""));
      const subscriptionId = localStorage.getItem(key);
      return Number.isFinite(caregiverId) && subscriptionId
        ? { caregiverId, subscriptionId }
        : null;
    })
    .filter(Boolean);
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function upsertWebPushSubscription(subscription, caregiverId) {
  const payload = toSubscriptionPayload(subscription, caregiverId);
  const storedId = getStoredSubscriptionId(caregiverId);

  if (storedId) {
    const putUrl = `${API_BASE}/subscriptions/${encodeURIComponent(storedId)}`;
    try {
      const updated = await requestJson(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStoredSubscriptionId(caregiverId, updated?.data?.id || storedId);
      return { ...updated, method: "PUT" };
    } catch (error) {
      console.error("[WebPush] PUT subscription failed:", {
        url: putUrl,
        status: error?.status,
        response: error?.responseBody || null,
        message: error?.message,
      });
      localStorage.removeItem(getSubscriptionStorageKey(caregiverId));
      if (error?.status && error.status !== 404) {
        throw error;
      }
    }
  }

  const postUrl = `${API_BASE}/subscriptions`;
  const created = await requestJson(postUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  setStoredSubscriptionId(caregiverId, created?.data?.id);
  return { ...created, method: "POST" };
}

export async function getSubscriptionsByCaregiver(caregiverId) {
  return requestJson(`${API_BASE}/subscriptions/${encodeURIComponent(caregiverId)}`);
}

export async function deactivateStoredSubscription(caregiverId) {
  const storedId = getStoredSubscriptionId(caregiverId);
  if (!storedId) return null;

  try {
    return await requestJson(`${API_BASE}/subscriptions/${encodeURIComponent(storedId)}`, {
      method: "DELETE",
    });
  } finally {
    clearStoredSubscriptionId(caregiverId);
  }
}

export async function deactivateOtherStoredSubscriptions(activeCaregiverId) {
  const entries = getAllStoredSubscriptionIds().filter(
    ({ caregiverId }) => caregiverId !== activeCaregiverId
  );

  for (const entry of entries) {
    await requestJson(`${API_BASE}/subscriptions/${encodeURIComponent(entry.subscriptionId)}`, {
      method: "DELETE",
    });
    clearStoredSubscriptionId(entry.caregiverId);
  }

  return entries.length;
}
