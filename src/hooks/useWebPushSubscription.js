import { useEffect, useRef } from "react";
import {
  getSubscriptionsByCaregiver,
  upsertWebPushSubscription,
  urlBase64ToUint8Array,
} from "../lib/webPushApi.js";

const PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || "";

export async function ensureWebPushSubscription(caregiverId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Web Push is not supported in this browser.");
  }
  if (!PUBLIC_KEY) {
    throw new Error("Missing VITE_WEB_PUSH_VAPID_PUBLIC_KEY.");
  }

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = "denied";
    }
  }
  if (permission !== "granted") {
    throw new Error("Notification permission not granted.");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_KEY),
    });
  }

  const result = await upsertWebPushSubscription(subscription, caregiverId);
  const verify = await getSubscriptionsByCaregiver(caregiverId);

  return { subscription, upsert: result, verify };
}

export function useWebPushSubscription(caregiverId) {
  const startedForRef = useRef(null);

  useEffect(() => {
    if (!caregiverId) return;
    if (startedForRef.current === caregiverId) return;
    startedForRef.current = caregiverId;

    ensureWebPushSubscription(caregiverId).catch((error) => {
      console.error("Web push subscription setup failed:", error);
    });
  }, [caregiverId]);
}
