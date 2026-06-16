import { useEffect, useMemo, useState } from "react";
import { useBeforeUnload } from "react-router-dom";
import DatePicker from "../components/DatePicker.jsx";
import {
  formatTodayDate,
  getDailyByDate,
  listDailySummaries,
  ApiError,
} from "../lib/dailyApi.js";
import ParentAudioRecorder from "../components/ParentAudioRecorder.jsx";
import { useCaregiver } from "../context/CaregiverContext.jsx";
import { useProfile } from "../context/ProfileContext.jsx";
import ExperimentBlockedState from "../components/ExperimentBlockedState.jsx";
import profileData from "../data/profile.json";
import { updateProfileByCaregiver } from "../lib/profileApi.js";

export default function Dashboard() {
  const { caregiverId } = useCaregiver();
  const { loadingProfile, profile, profileError, profileStatus, refreshProfile } = useProfile();
  const [summaries, setSummaries] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [themes, setThemes] = useState(profileData.themes);
  const [savedThemes, setSavedThemes] = useState(profileData.themes);
  const [themeDraft, setThemeDraft] = useState("");
  const [savingThemes, setSavingThemes] = useState(false);
  const [themeError, setThemeError] = useState("");
  const today = formatTodayDate();
  const isActivePeriod =
    profileStatus?.key === "robot-active" || profileStatus?.key === "parent-active";
  const isThemeDirty = JSON.stringify(themes) !== JSON.stringify(savedThemes);

  const availableDates = useMemo(
    () => (
      [...new Set([
        ...summaries.filter((item) => item.dashboardSelectable).map((item) => item.date),
        today,
      ])]
    ),
    [summaries, today]
  );

  useEffect(() => {
    if (!isActivePeriod) {
      setSummaries([]);
      setSelectedDate(today);
      setDailyData(null);
      setLoadingSummaries(false);
      setLoadingDaily(false);
      setErrorText("");
      return;
    }

    let cancelled = false;

    async function init() {
      setLoadingSummaries(true);
      try {
        const list = await listDailySummaries(caregiverId);
        if (cancelled) return;
        setSummaries(list);
        setSelectedDate(today);
        setErrorText("");
      } catch (error) {
        if (cancelled) return;
        setErrorText("Failed to load date list.");
      } finally {
        if (!cancelled) setLoadingSummaries(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [caregiverId, isActivePeriod, today]);

  useEffect(() => {
    if (!isActivePeriod) {
      setDailyData(null);
      setLoadingDaily(false);
      return;
    }

    if (!selectedDate) {
      setDailyData(null);
      setLoadingDaily(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoadingDaily(true);
      try {
        const json = await getDailyByDate(selectedDate, caregiverId);
        if (cancelled) return;
        setDailyData(json);
        setPhotoIndex(0);
        setErrorText("");
      } catch (error) {
        if (cancelled) return;
        setDailyData(null);
        if (error instanceof ApiError && error.status === 404) {
          setErrorText("No dashboard record for this date.");
          return;
        }
        if (error instanceof ApiError && error.status >= 500) {
          setErrorText("Service is temporarily unavailable. Please try again later.");
          return;
        }
        setErrorText("Failed to load dashboard data.");
      } finally {
        if (!cancelled) setLoadingDaily(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [caregiverId, isActivePeriod, selectedDate]);

  const activeCondition = dailyData?.condition || "robot";
  const dashboard = dailyData?.dashboard || {};
  const photos = activeCondition === "robot" ? dailyData?.dashboard?.photos || [] : [];
  const book = activeCondition === "parent" ? dashboard.book || null : null;
  const weeklyProgress = dashboard.weeklyProgress || null;
  const shouldProtectThemeChanges = isThemeDirty;

  useEffect(() => {
    if (Array.isArray(profile?.themes)) {
      setThemes(profile.themes);
      setSavedThemes(profile.themes);
      return;
    }
    setThemes(profileData.themes);
    setSavedThemes(profileData.themes);
  }, [profile]);

  useEffect(() => {
    if (photos.length <= 1) return;
    const timer = setInterval(() => {
      setPhotoIndex((prev) => (prev + 1) % photos.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [photos.length]);

  function confirmRecorderLeave(message) {
    if (!recorderBusy) return true;
    return window.confirm(message);
  }

  function confirmThemeLeave(message) {
    if (!shouldProtectThemeChanges) return true;
    return window.confirm(message);
  }

  function handleRemoveTheme(themeToRemove) {
    const confirmed = window.confirm(`Remove "${themeToRemove}" from themes?`);
    if (!confirmed) return;
    setThemes((current) => current.filter((theme) => theme !== themeToRemove));
  }

  function handleAddTheme() {
    const nextTheme = themeDraft.trim();
    if (!nextTheme) return;
    setThemes((current) => (current.includes(nextTheme) ? current : [...current, nextTheme]));
    setThemeDraft("");
  }

  async function saveThemes() {
    if (!caregiverId) {
      setThemeError("Unable to save themes right now.");
      return;
    }

    setSavingThemes(true);
    setThemeError("");

    try {
      await updateProfileByCaregiver(caregiverId, { themes });
      setSavedThemes(themes);
      await refreshProfile();
    } catch {
      setThemeError("Unable to save themes right now.");
    } finally {
      setSavingThemes(false);
    }
  }

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!shouldProtectThemeChanges) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const nextUrl = new URL(href, window.location.origin);
      const currentUrl = new URL(window.location.href);
      const isSameRoute =
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;
      if (isSameRoute) return;

      const confirmed = window.confirm(
        "You have unsaved theme changes. If you leave now, new changes will be lost."
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [shouldProtectThemeChanges]);

  useBeforeUnload((event) => {
    if (!shouldProtectThemeChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (loadingProfile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/65 backdrop-blur-[1px]">
        <div className="rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg">
          Loading...
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <section className="card p-5 text-sm text-red-600">
        Service is temporarily unavailable. Please try again later.
      </section>
    );
  }

  if (!isActivePeriod) {
    return (
      <ExperimentBlockedState
        title={profileStatus?.title || "Your testing has not begun yet."}
        description={
          profileStatus?.description || "Please come back when your assigned testing period begins."
        }
      />
    );
  }

  return (
    <div className="relative grid gap-6">
      {(loadingSummaries || loadingDaily) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/65 backdrop-blur-[1px]">
          <div className="rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg">
            Loading...
          </div>
        </div>
      )}

      <section>
        <DatePicker
          label="Date"
          selectedDate={selectedDate}
          onChange={(nextDate) => {
            if (!confirmRecorderLeave("Recording is still in progress. If you switch date now, the current recording may stop before it finishes uploading. Continue?")) {
              return;
            }
            if (!confirmThemeLeave("You have unsaved theme changes. If you switch date, new changes will be lost.")) {
              return;
            }
            setSelectedDate(nextDate);
          }}
          availableDates={availableDates}
          showHelperText={false}
        />
      </section>

      {errorText && (
        <section className="card p-5 text-sm text-red-600">{errorText}</section>
      )}

      <WeeklyProgressCard condition={activeCondition} weeklyProgress={weeklyProgress} />

      {activeCondition === "parent" ? (
        <>
          <ParentAudioRecorder
            caregiverId={caregiverId}
            date={selectedDate}
            enabled
            onRecorderBusyChange={setRecorderBusy}
          />
          <section className="card p-5">
            <p className="section-title">Book for today</p>
            <div className="mt-4">
              <div className="inline-flex rounded-full border border-ink-200 bg-ink-100 px-3 py-1 text-sm">
              {book || "No book recorded for this date."}
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <p className="section-title">Photo</p>
              {photos.length > 0 && (
                <span className="text-xs text-ink-500">
                  {photoIndex + 1}/{photos.length}
                </span>
              )}
            </div>
            <div className="relative mt-4">
              {photos.length > 0 ? (
                <img
                  src={photos[photoIndex]}
                  alt="Child and ELLA"
                  className="h-48 w-full rounded-2xl object-cover"
                />
              ) : (
                <div className="flex h-48 items-center justify-center rounded-2xl bg-ink-100 text-sm text-ink-500">
                  No photo for this date.
                </div>
              )}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setPhotoIndex((prev) => (prev - 1 + photos.length) % photos.length)
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-2xl font-light text-ink-500 transition hover:text-ink-700"
                    aria-label="Previous photo"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoIndex((prev) => (prev + 1) % photos.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl font-light text-ink-500 transition hover:text-ink-700"
                    aria-label="Next photo"
                  >
                    &gt;
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="card p-5">
            <p className="section-title">Themes</p>
            <div className="mt-4 flex flex-wrap gap-2">
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
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddTheme();
                  }
                }}
                className="input flex-1"
                placeholder="Add a theme"
                disabled={savingThemes}
              />
              <button
                type="button"
                className={`btn-ghost h-10 w-24 shrink-0 px-4 py-0 ${!themeDraft.trim() || savingThemes ? "opacity-50" : ""}`}
                disabled={!themeDraft.trim() || savingThemes}
                onClick={handleAddTheme}
              >
                Add
              </button>
            </div>
            <div className="mt-4">
              <button
                type="button"
                className={`btn-primary h-11 w-full px-4 py-0 ${!isThemeDirty || savingThemes ? "opacity-50" : ""}`}
                disabled={!isThemeDirty || savingThemes}
                onClick={() => void saveThemes()}
              >
                {savingThemes ? "Saving..." : "Save"}
              </button>
            </div>
            {themeError && <p className="mt-3 text-sm text-red-500">{themeError}</p>}
          </section>
        </>
      )}

    </div>
  );
}

function WeeklyProgressCard({ condition, weeklyProgress }) {
  if (!weeklyProgress) return null;

  const startDate = weeklyProgress.startDate || null;
  const endDate = weeklyProgress.endDate || null;
  const hasReachedTarget = hasMetWeeklyTarget(
    weeklyProgress.currentValue,
    weeklyProgress.targetValue
  );
  const currentValue = formatWeeklyCurrentValue(condition, weeklyProgress.currentValue);
  const goalLabel = formatWeeklyTargetValue(weeklyProgress.targetValue, weeklyProgress.unit);

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="section-title">Weekly progress</p>
        {hasReachedTarget && (
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
            Goal reached
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-2xl font-semibold text-ink-900">
          {currentValue} / {goalLabel}
        </p>
        {(startDate || endDate) && (
          <p className="text-sm text-ink-500">
            {startDate || "—"} to {endDate || "—"}
          </p>
        )}
      </div>
    </section>
  );
}

function hasMetWeeklyTarget(currentValue, targetValue) {
  const current = Number(currentValue);
  const target = Number(targetValue);

  if (Number.isNaN(current) || Number.isNaN(target)) return false;
  return current >= target;
}

function formatWeeklyCurrentValue(condition, rawValue) {
  if (rawValue == null || Number.isNaN(Number(rawValue))) return "0";

  const numeric = Number(rawValue);
  if (condition === "robot") return String(Math.round(numeric));
  return numeric % 1 === 0 ? String(numeric.toFixed(0)) : String(numeric.toFixed(1));
}

function formatWeeklyTargetValue(targetValue, unit) {
  if (targetValue == null || Number.isNaN(Number(targetValue))) {
    return unit ? `0 ${unit}` : "0";
  }

  const numeric = Number(targetValue);
  const formatted = numeric % 1 === 0 ? String(numeric.toFixed(0)) : String(numeric.toFixed(1));
  return unit ? `${formatted} ${unit}` : formatted;
}
