import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App as NativeApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import Header from "./Header.jsx";
import ProfileModal from "./ProfileModal.jsx";
import { useDiaryReminder } from "../hooks/useDiaryReminder.js";
import { useWebPushSubscription } from "../hooks/useWebPushSubscription.js";
import { useCaregiver } from "../context/CaregiverContext.jsx";
import { deactivateStoredSubscription } from "../lib/webPushApi.js";
import { deactivateNativePushSubscription } from "../lib/nativePushApi.js";
import { useProfile } from "../context/ProfileContext.jsx";
import { isNativeApp } from "../lib/platform.js";
import { nativeAudioSupported } from "../lib/nativeAudioApi.js";
import { SegmentedAudio } from "../lib/nativeSegmentedAudioApi.js";

export default function AppLayout({ active, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();
  const keyboardVisible = useRef(false);
  const { caregiverId, username, logout } = useCaregiver();
  const { loadingProfile, profileStatus, profile } = useProfile();
  const displayUsername = profile?.username || username;
  const reminderEnabled =
    !isNativeApp &&
    import.meta.env.VITE_ENABLE_LOCAL_REMINDER === "true" &&
    !loadingProfile &&
    (profileStatus?.key === "robot-active" || profileStatus?.key === "parent-active");
  useDiaryReminder(caregiverId, reminderEnabled);
  useWebPushSubscription(caregiverId);

  useEffect(() => {
    if (!isNativeApp) return undefined;
    let disposed = false;
    const listeners = [];
    async function listen(event, callback, plugin) {
      const listener = await plugin.addListener(event, callback);
      if (disposed) await listener.remove();
      else listeners.push(listener);
    }
    async function connect() {
      await listen("keyboardDidShow", () => { keyboardVisible.current = true; }, Keyboard);
      await listen("keyboardDidHide", () => { keyboardVisible.current = false; }, Keyboard);
      await listen("backButton", () => {
        if (keyboardVisible.current) {
          void Keyboard.hide();
        } else if (profileOpen) {
          setProfileOpen(false);
        } else if ((window.__ellaDiaryDirty || window.__ellaDashboardDirty) &&
                   !window.confirm("You have unsaved changes. If you leave now, new changes will be lost.")) {
          return;
        } else if (active === "parent-diary") {
          navigate("/dashboard");
        } else {
          void NativeApp.minimizeApp();
        }
      }, NativeApp);
    }
    void connect().catch((error) => console.error("Native navigation setup failed:", error));
    return () => {
      disposed = true;
      listeners.forEach((listener) => { void listener.remove(); });
    };
  }, [active, navigate, profileOpen]);

  async function handleLogout() {
    if (nativeAudioSupported && caregiverId) {
      try {
        const recording = await SegmentedAudio.getStatus({ caregiverId });
        if (recording.status === "recording") {
          if (!window.confirm("Stop and save the recording before logging out?")) return false;
          await SegmentedAudio.stop({ caregiverId });
        }
      } catch {
        window.alert("Unable to save the recording. Please try again before logging out.");
        return false;
      }
    }
    if (caregiverId) {
      try {
        await deactivateStoredSubscription(caregiverId);
        await deactivateNativePushSubscription(caregiverId);
      } catch (error) {
        console.error("Failed to deactivate subscription during logout:", error);
        window.alert("Unable to disconnect notifications. Please try logging out again.");
        return false;
      }
    }
    logout();
    return true;
  }

  return (
    <div className="min-h-screen">
      <Header
        active={active}
        username={displayUsername}
        onLogout={handleLogout}
        onOpenProfile={() => setProfileOpen(true)}
      />
      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        {children}
      </main>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
