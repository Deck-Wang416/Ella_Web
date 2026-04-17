import { useEffect, useRef } from 'react';
import { ApiError, formatTodayDate, getDailyByDate } from '../lib/dailyApi.js';

const REMINDER_SLOTS = ['18:00', '21:00'];

function parseSlot(slot) {
  const [h, m] = slot.split(':').map(Number);
  return { hour: h, minute: m };
}

function slotKey(date, slot) {
  return `ella_reminder_sent_${date}_${slot}`;
}

function nextSchedule(now) {
  const candidates = REMINDER_SLOTS
    .map((slot) => {
      const { hour, minute } = parseSlot(slot);
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return { slot, time: next };
    })
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  return candidates[0];
}

async function isTodaySubmitted() {
  const today = formatTodayDate();
  try {
    const json = await getDailyByDate(today);
    return Boolean(json?.diary?.submitted);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    return false;
  }
}

async function showReminder(slot) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const today = formatTodayDate();
  if (localStorage.getItem(slotKey(today, slot)) === '1') return;

  const submitted = await isTodaySubmitted();
  if (submitted) return;

  const registration = await navigator.serviceWorker?.ready;
  const title = 'Diary Reminder';
  const body = "Please complete today's Parent Diary questionnaire.";

  if (registration) {
    await registration.showNotification(title, {
      body,
      icon: '/assets/ella_logo_square.png',
      badge: '/assets/ella_logo_square.png',
      data: { url: '/parent-diary' },
    });
  } else {
    new Notification(title, { body });
  }

  localStorage.setItem(slotKey(today, slot), '1');
}

export function useDiaryReminder(enabled = true) {
  const timerRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    startedRef.current = true;

    if (!('Notification' in window)) return;

    async function ensurePermission() {
      if (Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // Ignore permission errors.
        }
      }
    }

    function schedule() {
      const now = new Date();
      const next = nextSchedule(now);
      const delay = Math.max(0, next.time.getTime() - now.getTime());

      timerRef.current = window.setTimeout(async () => {
        await showReminder(next.slot);
        schedule();
      }, delay);
    }

    ensurePermission().finally(schedule);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);
}
