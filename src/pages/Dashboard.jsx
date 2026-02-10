import { useState } from "react";
import records from "../data/records.json";
import Calendar from "../components/Calendar.jsx";

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(records.selectedDate);

  const displayDate = selectedDate
    ? new Date(selectedDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "Select a date";

  return (
    <div className="grid gap-6">
      <section>
        <p className="section-title">Date</p>
        <p className="mt-2 text-2xl font-display">{displayDate}</p>
        <div className="mt-4">
          <Calendar
            availableDates={records.availableDates}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
          />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <p className="section-title">Photo</p>
          <span className="text-xs text-ink-500">Hardcoded for now</span>
        </div>
        <img
          src={records.photo}
          alt="Child and ELLA"
          className="mt-4 h-48 w-full rounded-2xl object-cover"
        />
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
        <p className="mt-3 text-sm text-ink-700">{records.highlight}</p>
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
