import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { formatAppDate } from "../lib/timezone.js";

const DateContext = createContext(null);
const STORAGE_KEY = "ella_selected_date";

export function DateProvider({ children }) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || formatAppDate(new Date());
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
