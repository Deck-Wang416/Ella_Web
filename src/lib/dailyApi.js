const dailyCache = new Map();
let summariesCache = null;

export async function listDailySummaries() {
  if (summariesCache) return summariesCache;
  const response = await fetch('/api/daily');
  if (!response.ok) throw new Error('Failed to load daily list');
  const data = await response.json();
  summariesCache = data;
  return data;
}

export async function getDailyByDate(date) {
  if (dailyCache.has(date)) return dailyCache.get(date);
  const response = await fetch(`/api/daily/${date}`);
  if (!response.ok) throw new Error(`Failed to load daily data for ${date}`);
  const data = await response.json();
  dailyCache.set(date, data);
  return data;
}

export async function updateDailyByDate(date, payload) {
  const response = await fetch(`/api/daily/${date}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Failed to update daily data for ${date}`);
  const data = await response.json();
  dailyCache.set(date, payload);

  if (summariesCache) {
    const nextSummary = {
      date: payload.date,
      hasInteraction: Boolean(payload.dashboard?.hasInteraction),
      submitted: Boolean(payload.diary?.submitted),
    };
    const exists = summariesCache.some((item) => item.date === payload.date);
    summariesCache = exists
      ? summariesCache.map((item) => (item.date === payload.date ? nextSummary : item))
      : [...summariesCache, nextSummary].sort((a, b) => a.date.localeCompare(b.date));
  }

  return data;
}

export function formatTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nearestDate(targetDate, dates) {
  if (!dates.length) return null;

  const toLocalDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const target = toLocalDate(targetDate).getTime();
  let best = dates[0];
  let bestDiff = Math.abs(toLocalDate(best).getTime() - target);

  dates.forEach((dateStr) => {
    const diff = Math.abs(toLocalDate(dateStr).getTime() - target);
    if (diff < bestDiff) {
      best = dateStr;
      bestDiff = diff;
    }
  });

  return best;
}
