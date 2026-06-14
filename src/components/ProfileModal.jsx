import { useEffect, useMemo, useState } from "react";
import profileData from "../data/profile.json";
import { useProfile } from "../context/ProfileContext.jsx";
import { updateProfileByCaregiver } from "../lib/profileApi.js";

export default function ProfileModal({ open, onClose }) {
  const { profile, refreshProfile } = useProfile();
  const [themes, setThemes] = useState(profileData.themes);
  const [themeDraft, setThemeDraft] = useState("");
  const [savingThemes, setSavingThemes] = useState(false);
  const [themeError, setThemeError] = useState("");

  const childName = profile?.childName || profileData.childName;
  const dayCount = profile?.dayCount ?? profileData.dayCount;
  const caregiverId = profile?.caregiverId;

  const dayLabel = useMemo(() => {
    if (typeof dayCount === "number" && Number.isFinite(dayCount)) {
      return `Day ${dayCount}`;
    }
    if (typeof dayCount === "string" && dayCount.trim()) {
      return dayCount;
    }
    return "Not available";
  }, [dayCount]);

  useEffect(() => {
    if (Array.isArray(profile?.themes)) {
      setThemes(profile.themes);
      return;
    }
    setThemes(profileData.themes);
  }, [profile]);

  if (!open) return null;

  async function saveThemes(nextThemes) {
    if (!caregiverId) {
      setThemeError("Unable to save themes right now.");
      return;
    }

    setSavingThemes(true);
    setThemeError("");

    try {
      await updateProfileByCaregiver(caregiverId, { themes: nextThemes });
      setThemes(nextThemes);
      await refreshProfile();
    } catch {
      setThemeError("Unable to save themes right now.");
    } finally {
      setSavingThemes(false);
    }
  }

  function handleRemoveTheme(themeToRemove) {
    const confirmed = window.confirm(`Remove theme "${themeToRemove}"?`);
    if (!confirmed) return;
    const nextThemes = themes.filter((theme) => theme !== themeToRemove);
    void saveThemes(nextThemes);
  }

  function handleAddTheme() {
    const nextTheme = themeDraft.trim();
    if (!nextTheme) return;
    const nextThemes = themes.includes(nextTheme) ? themes : [...themes, nextTheme];
    void saveThemes(nextThemes);
    setThemeDraft("");
  }

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
          <div className="rounded-3xl border border-ink-100 bg-ink-100/70 p-5">
            <p className="text-sm text-ink-500">Child name</p>
            <p className="mt-1 text-xl font-semibold">{childName}</p>
            <p className="mt-4 text-sm text-ink-500">Day</p>
            <p className="mt-1 text-sm font-semibold text-ink-700">{dayLabel}</p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="section-title">Themes</p>
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
                    onClick={() => handleRemoveTheme(theme)}
                    className="text-ink-400 transition hover:text-ink-700 disabled:cursor-not-allowed disabled:text-ink-300"
                    aria-label={`Remove ${theme}`}
                    disabled={savingThemes}
                  >
                    −
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input
                value={themeDraft}
                onChange={(event) => setThemeDraft(event.target.value)}
                className="input flex-1"
                placeholder="Add a theme"
                disabled={savingThemes}
              />
              <button
                type="button"
                className={`btn-primary ${!themeDraft.trim() || savingThemes ? "opacity-50" : ""}`}
                disabled={!themeDraft.trim() || savingThemes}
                onClick={handleAddTheme}
              >
                {savingThemes ? "Saving..." : "+"}
              </button>
            </div>
            {themeError && <p className="mt-3 text-sm text-red-500">{themeError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
