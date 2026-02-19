import { getApiBase } from "./apiBase.js";

const API_BASE = getApiBase();
const SUBSCRIPTION_ID_KEY = "ella_web_push_subscription_id";
const FIXED_CAREGIVER_ID = 1;

function toSubscriptionPayload(subscription) {
  const json = subscription.toJSON();
  return {
    caregiver_id: FIXED_CAREGIVER_ID,
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

function getStoredSubscriptionId() {
  return localStorage.getItem(SUBSCRIPTION_ID_KEY);
}

function setStoredSubscriptionId(id) {
  if (!id) return;
  localStorage.setItem(SUBSCRIPTION_ID_KEY, String(id));
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

export async function upsertWebPushSubscription(subscription) {
  const payload = toSubscriptionPayload(subscription);
  const storedId = getStoredSubscriptionId();

  if (storedId) {
    const putUrl = `${API_BASE}/subscriptions/${encodeURIComponent(storedId)}`;
    try {
      const updated = await requestJson(putUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStoredSubscriptionId(updated?.data?.id || storedId);
      return { ...updated, method: "PUT" };
    } catch (error) {
      console.error("[WebPush] PUT subscription failed:", {
        url: putUrl,
        status: error?.status,
        response: error?.responseBody || null,
        message: error?.message,
      });
      localStorage.removeItem(SUBSCRIPTION_ID_KEY);
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
  setStoredSubscriptionId(created?.data?.id);
  return { ...created, method: "POST" };
}

export async function getSubscriptionsByCaregiver(caregiverId = FIXED_CAREGIVER_ID) {
  return requestJson(`${API_BASE}/subscriptions/${encodeURIComponent(caregiverId)}`);
}
