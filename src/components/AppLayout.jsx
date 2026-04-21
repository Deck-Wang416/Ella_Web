import { useState } from "react";
import Header from "./Header.jsx";
import ProfileModal from "./ProfileModal.jsx";
import { useDiaryReminder } from "../hooks/useDiaryReminder.js";
import { useWebPushSubscription } from "../hooks/useWebPushSubscription.js";
import { useCaregiver } from "../context/CaregiverContext.jsx";
import { deactivateStoredSubscription } from "../lib/webPushApi.js";

export default function AppLayout({ active, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { caregiverId, username, logout } = useCaregiver();
  useDiaryReminder(caregiverId, import.meta.env.VITE_ENABLE_LOCAL_REMINDER === "true");
  useWebPushSubscription(caregiverId);

  async function handleLogout() {
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
        username={username}
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
