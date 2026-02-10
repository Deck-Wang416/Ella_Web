import { useMemo, useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function Calendar({ availableDates, selectedDate, onSelect }) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const [monthCursor, setMonthCursor] = useState(() => {
    const base = selectedDate ? new Date(selectedDate) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days = [];
  for (let i = 0; i < startWeekday; i += 1) {
    days.push(null);
  }
  for (let day = 1; day <= totalDays; day += 1) {
    days.push(new Date(year, month, day));
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold">
          {monthCursor.toLocaleString("en-US", { month: "long" })} {year}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMonthCursor(new Date(year, month - 1, 1))}
            className="btn-ghost px-3"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setMonthCursor(new Date(year, month + 1, 1))}
            className="btn-ghost px-3"
          >
            →
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 text-center text-xs text-ink-500">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-7 gap-2">
        {days.map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;

          const key = date.toISOString().slice(0, 10);
          const isAvailable = availableSet.has(key);
          const isSelected = selectedDate === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => isAvailable && onSelect(key)}
              className={`h-9 w-9 rounded-full text-sm font-semibold transition ${
                isSelected
                  ? "bg-brand-500 text-white"
                  : isAvailable
                  ? "text-ink-900 hover:bg-ink-100"
                  : "text-ink-300"
              }`}
              disabled={!isAvailable}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink-500">
        Dates in black have stories recorded. Grey dates are unavailable.
      </p>
    </div>
  );
}
