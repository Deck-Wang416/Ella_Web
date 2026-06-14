import { useEffect, useRef } from 'react';
import { ApiError, formatTodayDate, getDailyByDate } from '../lib/dailyApi.js';
import { getAppTimeParts } from '../lib/timezone.js';

const REMINDER_SLOTS = ['18:00', '21:00'];

function parseReminderSlot(slot) {
  const [hour, minute] = slot.split(':').map(Number);
  return { hour, minute };
}

function slotKey(caregiverId, date, slot) {
  return `ella_reminder_sent_${caregiverId}_${date}_${slot}`;
}

async function isTodaySubmitted(caregiverId) {
  const today = formatTodayDate();
  try {
    const json = await getDailyByDate(today, caregiverId);
    return Boolean(json?.diary?.submitted);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    return false;
  }
}

async function showReminder(slot, caregiverId) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const today = formatTodayDate();
  if (localStorage.getItem(slotKey(caregiverId, today, slot)) === '1') return;

  const submitted = await isTodaySubmitted(caregiverId);
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

  localStorage.setItem(slotKey(caregiverId, today, slot), '1');
}

export function useDiaryReminder(caregiverId, enabled = true) {
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);
  const startedForRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    if (!caregiverId) return;
    if (startedForRef.current === caregiverId) return;
    startedForRef.current = caregiverId;

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

    async function tick() {
      const { hour, minute } = getAppTimeParts(new Date());
      const slot = REMINDER_SLOTS.find((entry) => {
        const { hour: slotHour, minute: slotMinute } = parseReminderSlot(entry);
        return slotHour === hour && slotMinute === minute;
      });

      if (slot) {
        await showReminder(slot, caregiverId);
      }
    }

    function schedule() {
      const now = new Date();
      const delay = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());

      timeoutRef.current = window.setTimeout(() => {
        void tick();
        intervalRef.current = window.setInterval(() => {
          void tick();
        }, 60000);
      }, delay);
    }

    ensurePermission().finally(schedule);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [caregiverId, enabled]);
}
