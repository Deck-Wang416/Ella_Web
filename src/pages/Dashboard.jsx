import { useEffect, useMemo, useState } from "react";
import records from "../data/records.json";
import DatePicker from "../components/DatePicker.jsx";

export default function Dashboard() {
  const nearestDate = useMemo(() => {
    if (!records.availableDates.length) return null;
    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const toLocalDate = (dateStr) => {
      const [year, month, day] = dateStr.split("-").map(Number);
      return new Date(year, month - 1, day);
    };

    let best = records.availableDates[0];
    let bestDiff = Math.abs(
      toLocalDate(best).getTime() - todayMidnight.getTime()
    );

    records.availableDates.forEach((dateStr) => {
      const diff = Math.abs(
        toLocalDate(dateStr).getTime() - todayMidnight.getTime()
      );
      if (diff < bestDiff) {
        best = dateStr;
        bestDiff = diff;
      }
    });

    return best;
  }, []);

  const [selectedDate, setSelectedDate] = useState(() => nearestDate);
  const [photoIndex, setPhotoIndex] = useState(0);
  const photos = records.photos || [];

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
          availableDates={records.availableDates}
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
          <img
            src={photos[photoIndex]}
            alt="Child and ELLA"
            className="h-48 w-full rounded-2xl object-cover"
          />
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
          {records.words.map((word) => (
            <span key={word} className="rounded-full bg-ink-100 px-3 py-1 text-sm">
              {word}
            </span>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <p className="section-title">Highlight</p>
        <div className="mt-4 grid gap-3">
          {records.highlight.map((item) => (
            <div key={item} className="rounded-2xl border border-ink-200 bg-ink-100 px-4 py-3 text-sm">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <p className="section-title">Ask</p>
        <div className="mt-4 grid gap-3">
          {records.ask.map((item) => (
            <div key={item} className="rounded-2xl border border-ink-200 bg-ink-100 px-4 py-3 text-sm">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
