import { useEffect, useRef } from "react";
import {
  getSubscriptionsByCaregiver,
  upsertWebPushSubscription,
  urlBase64ToUint8Array,
} from "../lib/webPushApi.js";

const PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || "";

export async function ensureWebPushSubscription() {
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

  const result = await upsertWebPushSubscription(subscription);
  const verify = await getSubscriptionsByCaregiver(1);

  return { subscription, upsert: result, verify };
}

export function useWebPushSubscription() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    ensureWebPushSubscription().catch((error) => {
      console.error("Web push subscription setup failed:", error);
    });
  }, []);
}
