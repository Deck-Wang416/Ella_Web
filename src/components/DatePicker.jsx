import { useState } from "react";
import Calendar from "./Calendar.jsx";

export default function DatePicker({
  label,
  selectedDate,
  onChange,
  availableDates,
  allowAll = false,
  markedDates = [],
  useAvailabilityStyles = true
}) {
  const [open, setOpen] = useState(false);

  const displayDate = selectedDate
    ? new Date(
        Number(selectedDate.slice(0, 4)),
        Number(selectedDate.slice(5, 7)) - 1,
        Number(selectedDate.slice(8, 10))
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "Select a date";

  return (
    <div className="grid gap-3">
      {label && <p className="section-title">{label}</p>}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between rounded-2xl border border-ink-200 bg-white px-4 py-3 text-left shadow-sm"
      >
        <span className="font-display text-lg">{displayDate}</span>
        <span className={`text-ink-500 transition ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div>
          <Calendar
            availableDates={availableDates}
            selectedDate={selectedDate}
            allowAll={allowAll}
            markedDates={markedDates}
            useAvailabilityStyles={useAvailabilityStyles}
            onSelect={(date) => {
              onChange(date);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
