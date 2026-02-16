import { useEffect, useMemo, useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function Calendar({
  availableDates,
  selectedDate,
  onSelect,
  allowAll = false,
  markedDates = [],
  useAvailabilityStyles = true,
  helperText,
  showHelperText = true,
}) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const markedSet = useMemo(() => new Set(markedDates), [markedDates]);
  const [monthCursor, setMonthCursor] = useState(() => {
    const base = parseLocalDate(selectedDate) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    const base = parseLocalDate(selectedDate);
    if (!base) return;
    setMonthCursor(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [selectedDate]);

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

          const key = formatLocalDate(date);
          const isAvailable = availableSet.has(key);
          const isSelected = selectedDate === key;
          const isSelectable = allowAll || isAvailable;
          const isMarked = markedSet.has(key);

          const baseClass = useAvailabilityStyles
            ? isAvailable
              ? "text-ink-900 hover:bg-ink-100"
              : "text-ink-300 hover:text-ink-500"
            : "text-ink-700 hover:bg-ink-100";

          return (
            <button
              key={key}
              type="button"
              onClick={() => isSelectable && onSelect(key)}
              className={`relative h-9 w-9 rounded-full text-sm font-semibold transition ${
                isSelected ? "bg-brand-500 text-white" : baseClass
              } ${isSelectable ? "" : "cursor-not-allowed"}`}
              disabled={!isSelectable}
            >
              {date.getDate()}
              {isMarked && (
                <span className="absolute -bottom-2.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand-500" />
              )}
            </button>
          );
        })}
      </div>
      {showHelperText &&
        (helperText ? (
          <p className="mt-4 text-xs text-ink-500">{helperText}</p>
        ) : useAvailabilityStyles ? (
          <p className="mt-4 text-xs text-ink-500">
            Dates in black have stories recorded. Grey dates have no records and cannot be selected.
          </p>
        ) : (
          <p className="mt-4 text-xs text-ink-500">
            All dates are selectable. Dates with a blue dot have submitted questionnaires.
          </p>
        ))}
    </div>
  );
}
