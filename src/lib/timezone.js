export const APP_TIMEZONE = "America/New_York";

function getFormatter(options) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    ...options,
  });
}

export function formatAppDate(date = new Date()) {
  const parts = getFormatter({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function getAppTimeParts(date = new Date()) {
  const parts = getFormatter({
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return { hour, minute };
}
