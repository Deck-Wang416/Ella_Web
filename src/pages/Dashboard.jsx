import { useEffect, useMemo, useState } from "react";
import DailyConditionInitModal from "../components/DailyConditionInitModal.jsx";
import DatePicker from "../components/DatePicker.jsx";
import {
  formatTodayDate,
  getDailyByDate,
  initializeDailyByDate,
  listDailySummaries,
  ApiError,
} from "../lib/dailyApi.js";
import ParentAudioRecorder from "../components/ParentAudioRecorder.jsx";
import { useCaregiver } from "../context/CaregiverContext.jsx";

export default function Dashboard() {
  const { caregiverId } = useCaregiver();
  const [summaries, setSummaries] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [errorText, setErrorText] = useState("");
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingDaily, setLoadingDaily] = useState(true);
  const [recorderBusy, setRecorderBusy] = useState(false);
  const [initModalOpen, setInitModalOpen] = useState(false);
  const [initErrorText, setInitErrorText] = useState("");
  const [initializingDaily, setInitializingDaily] = useState(false);
  const today = formatTodayDate();

  const availableDates = useMemo(
    () =>
      [...new Set([
        ...summaries.filter((item) => item.dashboardSelectable).map((item) => item.date),
        today,
      ])],
    [summaries, today]
  );

  useEffect(() => {
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
  }, [caregiverId, today]);

  useEffect(() => {
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
          if (selectedDate === today) {
            setInitModalOpen(true);
            setInitErrorText("");
            setErrorText("");
            return;
          }
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
  }, [caregiverId, selectedDate, today]);

  const activeCondition = dailyData?.condition || "robot";
  const photos = activeCondition === "robot" ? dailyData?.dashboard?.photos || [] : [];
  const words = dailyData?.dashboard?.words || [];
  const highlight = dailyData?.dashboard?.highlight || [];
  const ask = dailyData?.dashboard?.ask || [];

  useEffect(() => {
    if (photos.length <= 1) return;
    const timer = setInterval(() => {
      setPhotoIndex((prev) => (prev + 1) % photos.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [photos.length]);

  async function refreshDailyData() {
    if (!selectedDate) return;

    try {
      setLoadingDaily(true);
      const json = await getDailyByDate(selectedDate, caregiverId);
      setDailyData(json);
      setErrorText("");
    } catch (error) {
      if (error instanceof ApiError && error.status >= 500) {
        setErrorText("Service is temporarily unavailable. Please try again later.");
        return;
      }
      setErrorText("Failed to load dashboard data.");
    } finally {
      setLoadingDaily(false);
    }
  }

  async function initializeDaily(condition) {
    if (!selectedDate) return;
    setInitializingDaily(true);
    setInitErrorText("");

    try {
      await initializeDailyByDate(selectedDate, condition, caregiverId);
      const latest = await getDailyByDate(selectedDate, caregiverId);
      const summaryList = await listDailySummaries(caregiverId);
      setSummaries(summaryList);
      setDailyData(latest);
      setPhotoIndex(0);
      setInitModalOpen(false);
      setErrorText("");
    } catch (error) {
      if (error instanceof ApiError && error.status >= 500) {
        setInitErrorText("Service is temporarily unavailable. Please try again later.");
      } else {
        setInitErrorText("Unable to initialize daily record. Please try again.");
      }
    } finally {
      setInitializingDaily(false);
    }
  }

  function confirmRecorderLeave(message) {
    if (!recorderBusy) return true;
    return window.confirm(message);
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

      <DailyConditionInitModal
        open={initModalOpen}
        date={selectedDate}
        loading={initializingDaily}
        errorText={initErrorText}
        onClose={() => setInitModalOpen(false)}
        onSelect={initializeDaily}
      />

      <section>
        <DatePicker
          label="Date"
          selectedDate={selectedDate}
          onChange={(nextDate) => {
            if (!confirmRecorderLeave("Recording is still in progress. If you switch date now, the current recording may stop before it finishes uploading. Continue?")) {
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

      {activeCondition === "parent" ? (
        <ParentAudioRecorder
          caregiverId={caregiverId}
          date={selectedDate}
          enabled
          onRecorderBusyChange={setRecorderBusy}
        />
      ) : (
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
      )}

      <section className="card p-5">
        <p className="section-title">Words from today</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {words.length > 0 ? (
            words.map((word) => (
              <span key={word} className="rounded-full bg-ink-100 px-3 py-1 text-sm">
                {word}
              </span>
            ))
          ) : (
            <p className="text-sm text-ink-500">No words recorded for this date.</p>
          )}
        </div>
      </section>

      {activeCondition === "robot" && (
        <>
          <section className="card p-5">
            <p className="section-title">Highlight</p>
            <div className="mt-4 grid gap-3">
              {highlight.length > 0 ? (
                highlight.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-ink-200 bg-ink-100 px-4 py-3 text-sm"
                  >
                    {item}
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink-500">No highlights for this date.</p>
              )}
            </div>
          </section>

          <section className="card p-5">
            <p className="section-title">Ask</p>
            <div className="mt-4 grid gap-3">
              {ask.length > 0 ? (
                ask.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-ink-200 bg-ink-100 px-4 py-3 text-sm"
                  >
                    {item}
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink-500">No suggested questions for this date.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
