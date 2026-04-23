import { useState } from "react";
import profileData from "../data/profile.json";

export default function ProfileModal({ open, onClose }) {
  const [themes] = useState(profileData.themes);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-card sm:rounded-[32px]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">Child Profile</h2>
          <button type="button" onClick={onClose} className="btn-ghost">
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-6">
          <div className="flex items-center gap-4">
            <img
              src={profileData.childPhoto}
              alt="Child"
              className="h-20 w-20 rounded-2xl object-cover"
            />
            <div>
              <p className="text-sm text-ink-500">Child name</p>
              <p className="text-xl font-semibold">{profileData.childName}</p>
              <p className="mt-1 text-sm text-ink-500">Day</p>
              <p className="text-sm font-semibold text-ink-700">{profileData.dayProgress}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="section-title">Themes</p>
              <span className="text-xs text-ink-500">Read only</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {themes.map((theme) => (
                <span
                  key={theme}
                  className="flex items-center gap-2 rounded-full border border-ink-200 bg-ink-100 px-3 py-1 text-sm"
                >
                  {theme}
                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed text-ink-300"
                    aria-label={`Remove ${theme}`}
                  >
                    −
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input
                value=""
                readOnly
                className="input flex-1"
                placeholder="Editing disabled"
              />
              <button
                type="button"
                className="btn-primary opacity-50"
                disabled
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
