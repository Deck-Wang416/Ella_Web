import { useEffect, useMemo, useState } from "react";
import DatePicker from "../components/DatePicker.jsx";
import {
  formatTodayDate,
  getDailyByDate,
  listDailySummaries,
  nearestDate,
} from "../lib/dailyApi.js";

export default function Dashboard() {
  const [summaries, setSummaries] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  const availableDates = useMemo(
    () => summaries.filter((item) => item.hasInteraction).map((item) => item.date),
    [summaries]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const list = await listDailySummaries();
      if (cancelled) return;
      setSummaries(list);

      const today = formatTodayDate();
      const initial = nearestDate(today, availableDatesFromList(list));
      setSelectedDate(initial);
    }

    init().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) {
      setDailyData(null);
      return;
    }

    let cancelled = false;
    async function load() {
      const json = await getDailyByDate(selectedDate);
      if (cancelled) return;
      setDailyData(json);
      setPhotoIndex(0);
    }

    load().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const photos = dailyData?.dashboard?.photos || [];
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

  return (
    <div className="grid gap-6">
      <section>
        <DatePicker
          label="Date"
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          availableDates={availableDates}
        />
      </section>

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
    </div>
  );
}

function availableDatesFromList(list) {
  return list.filter((item) => item.hasInteraction).map((item) => item.date);
}
