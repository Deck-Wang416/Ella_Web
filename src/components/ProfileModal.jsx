import { useMemo } from "react";
import profileData from "../data/profile.json";
import { useProfile } from "../context/ProfileContext.jsx";

export default function ProfileModal({ open, onClose }) {
  const { profile } = useProfile();
  const childName = profile?.username || "";
  const dayCount = profile?.dayCount ?? profileData.dayCount;

  const dayLabel = useMemo(() => {
    if (typeof dayCount === "number" && Number.isFinite(dayCount)) {
      return `${dayCount} Days`;
    }
    if (typeof dayCount === "string" && dayCount.trim()) {
      return dayCount;
    }
    return "Not available";
  }, [dayCount]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-card sm:rounded-[32px]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">Child Profile</h2>
          <button type="button" onClick={onClose} className="btn-ghost h-10 w-24 shrink-0 px-4 py-0">
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-6">
          <div>
            <p className="text-sm text-ink-500">Child name</p>
            <p className="mt-1 text-xl font-semibold">{childName || "Not available"}</p>
            <p className="mt-4 text-sm text-ink-500">Day progress</p>
            <p className="mt-1 text-sm font-semibold text-ink-700">{dayLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
