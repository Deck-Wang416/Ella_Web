import { createContext, useContext, useEffect, useMemo, useState } from "react";

const DateContext = createContext(null);
const STORAGE_KEY = "ella_selected_date";

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DateProvider({ children }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || formatLocalDate(new Date());
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, selectedDate);
  }, [selectedDate]);

  const value = useMemo(() => ({ selectedDate, setSelectedDate }), [selectedDate]);

  return <DateContext.Provider value={value}>{children}</DateContext.Provider>;
}

export function useSelectedDate() {
  const context = useContext(DateContext);
  if (!context) {
    throw new Error("useSelectedDate must be used within DateProvider");
  }
  return context;
}
