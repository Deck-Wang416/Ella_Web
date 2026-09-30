import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PushNotifications } from "@capacitor/push-notifications";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "../lib/platform.js";
import { allowNativePushSubscription, upsertNativePushSubscription } from "../lib/nativePushApi.js";

export function useNativePushSubscription(caregiverId) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeApp || !caregiverId) return undefined;
    let disposed = false;
    let registering = false;
    const listeners = [];
    allowNativePushSubscription(caregiverId);

    async function listen(event, callback, plugin = PushNotifications) {
      const listener = await plugin.addListener(event, callback);
      if (disposed) await listener.remove();
      else listeners.push(listener);
    }

    async function requestRegistration(prompt) {
      if (disposed || registering) return;
      registering = true;
      try {
        let permission = await PushNotifications.checkPermissions();
        if (prompt && permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
        if (!disposed && permission.receive === "granted") await PushNotifications.register();
      } catch (error) {
        if (!disposed) console.error("Unable to register native push:", error);
      } finally {
        registering = false;
      }
    }

    async function connect() {
      try {
        await listen("registration", ({ value }) => {
          if (disposed || !value) return;
          const platform = Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
          void upsertNativePushSubscription(caregiverId, platform, value).catch((error) => {
            console.error("Native push subscription failed:", error);
          });
        });
        await listen("registrationError", (error) => {
          if (!disposed) console.error("Native push registration failed:", error);
        });
        await listen("pushNotificationActionPerformed", ({ notification }) => {
          if (!disposed && (notification?.data?.type === "diary_reminder" ||
                            notification?.data?.url === "/parent-diary")) {
            navigate("/parent-diary");
          }
        });
        if (disposed) return;
        await requestRegistration(true);
        if (disposed) return;
        await listen("appStateChange", ({ isActive }) => {
          if (isActive) void requestRegistration(false);
        }, NativeApp);
        window.addEventListener("online", onOnline);
      } catch (error) {
        if (!disposed) console.error("Unable to set up native push:", error);
      }
    }

    function onOnline() {
      void requestRegistration(false);
    }

    void connect();
    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      listeners.forEach((listener) => { void listener.remove(); });
    };
  }, [caregiverId, navigate]);
}
