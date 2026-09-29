import { useState } from "react";
import Header from "./Header.jsx";
import ProfileModal from "./ProfileModal.jsx";
import { useDiaryReminder } from "../hooks/useDiaryReminder.js";
import { useWebPushSubscription } from "../hooks/useWebPushSubscription.js";
import { useCaregiver } from "../context/CaregiverContext.jsx";
import { deactivateStoredSubscription } from "../lib/webPushApi.js";
import { useProfile } from "../context/ProfileContext.jsx";
import { isNativeApp } from "../lib/platform.js";
import { NativeAudio, nativeAudioSupported } from "../lib/nativeAudioApi.js";

export default function AppLayout({ active, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
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

  async function handleLogout() {
    if (nativeAudioSupported && caregiverId) {
      try {
        const recording = await NativeAudio.getStatus({ caregiverId });
        if (recording.status === "recording") {
          if (!window.confirm("Stop and save the recording before logging out?")) return;
          await NativeAudio.stop({ caregiverId });
        }
        await NativeAudio.stopPlayback();
      } catch {
        window.alert("Unable to save the recording. Please try again before logging out.");
        return;
      }
    }
    if (caregiverId) {
      try {
        await deactivateStoredSubscription(caregiverId);
      } catch (error) {
        console.error("Failed to deactivate subscription during logout:", error);
      }
    }
    logout();
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
