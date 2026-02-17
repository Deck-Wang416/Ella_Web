import { useState } from "react";
import Header from "./Header.jsx";
import ProfileModal from "./ProfileModal.jsx";
import { useDiaryReminder } from "../hooks/useDiaryReminder.js";

export default function AppLayout({ active, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
  useDiaryReminder();

  return (
    <div className="min-h-screen">
      <Header active={active} onOpenProfile={() => setProfileOpen(true)} />
      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        {children}
      </main>
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
