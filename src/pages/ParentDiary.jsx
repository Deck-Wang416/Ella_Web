import { useEffect, useMemo, useState } from "react";
import { useBeforeUnload } from "react-router-dom";
import DatePicker from "../components/DatePicker.jsx";
import {
  formatTodayDate,
  getDailyByDate,
  listDailySummaries,
  nearestDate,
  updateDailyByDate,
} from "../lib/dailyApi.js";

export default function ParentDiary() {
  const [summaries, setSummaries] = useState([]);
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [diaryDate, setDiaryDate] = useState(null);
  const [dailyData, setDailyData] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [savedValues, setSavedValues] = useState({});
  const [showToast, setShowToast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const list = await listDailySummaries();
      if (cancelled) return;
      setSummaries(list);
      setSummariesLoaded(true);
      const today = formatTodayDate();
      setDiaryDate(today);
    }

    init().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!diaryDate || !summariesLoaded) {
      setLoadingDaily(true);
      setDailyData(null);
      setFormValues({});
      return;
    }

    let cancelled = false;
    async function load() {
      setLoadingDaily(true);
      try {
        const json = await getDailyByDate(diaryDate);
        if (cancelled) return;
        const initialResponses = json.diary?.submitted ? json.diary?.responses || {} : {};
        const sanitized = sanitizeResponses(initialResponses, json.diary?.questions || []);
        setDailyData(json);
        setFormValues(sanitized);
        setSavedValues(sanitized);
      } catch (error) {
        const templateDate = nearestDate(
          diaryDate,
          summaries.map((item) => item.date)
        );
        let template = null;
        if (templateDate) {
          template = await getDailyByDate(templateDate);
        }

        if (cancelled) return;
        const empty = createEmptyDailyData(diaryDate, template);
        setDailyData(empty);
        setFormValues({});
        setSavedValues({});
      } finally {
        if (!cancelled) setLoadingDaily(false);
      }
    }

    load().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
    };
  }, [diaryDate, summariesLoaded]);

  const submittedDates = useMemo(
    () => summaries.filter((item) => item.submitted).map((item) => item.date),
    [summaries]
  );
  const availableDates = useMemo(() => summaries.map((item) => item.date), [summaries]);
  const hasSubmitted = Boolean(dailyData?.diary?.submitted);
  const isDirty = JSON.stringify(formValues) !== JSON.stringify(savedValues);

  useEffect(() => {
    window.__ellaDiaryDirty = isDirty;
  }, [isDirty]);

  useEffect(() => {
    return () => {
      window.__ellaDiaryDirty = false;
    };
  }, []);

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!isDirty) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      const nextUrl = new URL(href, window.location.origin);
      const currentUrl = new URL(window.location.href);
      const isSameRoute =
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash;
      if (isSameRoute) return;

      const confirmed = window.confirm(
        "You have unsaved changes. If you leave now, new changes will be lost."
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [isDirty]);

  useBeforeUnload((event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const canSubmit = Object.values(formValues).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return String(value || "").trim().length > 0;
  });

  async function saveDiary() {
    if (!dailyData || !diaryDate || !canSubmit || saving) return;
    setSaving(true);

    try {
      const nowIso = new Date().toISOString();
      const sanitized = sanitizeResponses(formValues, questions);
      const nextDiary = {
        ...dailyData.diary,
        submitted: true,
        submittedAt: dailyData.diary.submittedAt || nowIso,
        updatedAt: nowIso,
        responses: sanitized,
      };
      const nextData = {
        ...dailyData,
        diary: nextDiary,
      };

      await updateDailyByDate(diaryDate, nextData);
      setDailyData(nextData);
      setFormValues(sanitized);
      setSavedValues(sanitized);
      setSummaries((prev) =>
        prev.some((item) => item.date === diaryDate)
          ? prev.map((item) =>
              item.date === diaryDate ? { ...item, submitted: true } : item
            )
          : [...prev, { date: diaryDate, hasInteraction: false, submitted: true }].sort(
              (a, b) => a.date.localeCompare(b.date)
            )
      );

      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  }

  const instructions = dailyData?.diary?.instructions || [];
  const questions = dailyData?.diary?.questions || [];

  return (
    <div className="relative grid gap-6">
      {showToast && (
        <div className="fixed right-5 top-5 z-50 rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg">
          Saved successfully.
        </div>
      )}

      <section>
        <DatePicker
          label="Date"
          selectedDate={diaryDate}
          onChange={(nextDate) => {
            if (!isDirty) {
              setDiaryDate(nextDate);
              return;
            }
            const confirmed = window.confirm(
              "You have unsaved changes. If you switch date, new changes will be lost."
            );
            if (confirmed) {
              setDiaryDate(nextDate);
            }
          }}
          availableDates={availableDates}
          allowAll
          markedDates={submittedDates}
          useAvailabilityStyles={false}
        />
      </section>

      <div className="relative grid gap-6">
        {loadingDaily && (
          <div className="absolute inset-0 z-20 flex items-start justify-center rounded-3xl bg-white/70 pt-16 backdrop-blur-[1px]">
            <div className="rounded-2xl border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 shadow-sm">
              Loading questionnaire...
            </div>
          </div>
        )}

        <section className="card p-6">
          <p className="text-sm font-semibold text-ink-700">Caregiver Instruction</p>
          <ul className="mt-3 grid gap-2 text-sm text-ink-600">
            {instructions.map((item) => (
              <li key={item}>• {renderInstruction(item)}</li>
            ))}
          </ul>
        </section>

        {hasSubmitted && (
          <section className="card p-6 text-center">
            <p className="text-lg font-semibold">You already submitted this day.</p>
            <p className="mt-2 text-sm text-ink-500">You can still edit and save changes.</p>
          </section>
        )}

        <form className="card p-6" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-8">
            {questions.map((question, index) => (
              <QuestionBlock
                key={question.id}
                question={question}
                number={index + 1}
                value={formValues[question.id]}
                followupValue={formValues[`${question.id}_followup`]}
                onChange={(nextValue) =>
                  setFormValues((prev) => {
                    const next = { ...prev, [question.id]: nextValue };
                    const followupKey = `${question.id}_followup`;
                    if (
                      question.followup &&
                      !shouldShowFollowup(question.followup, nextValue) &&
                      followupKey in next
                    ) {
                      delete next[followupKey];
                    }
                    return next;
                  })
                }
                onFollowupChange={(nextValue) =>
                  setFormValues((prev) => ({ ...prev, [`${question.id}_followup`]: nextValue }))
                }
              />
            ))}
          </div>
          <button
            type="button"
            className={`btn-primary mt-8 w-full ${!canSubmit || saving || loadingDaily ? "opacity-50" : ""}`}
            disabled={!canSubmit || saving || loadingDaily}
            onClick={saveDiary}
          >
            {hasSubmitted ? "Save changes" : "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}

function createEmptyDailyData(date, template) {
  return {
    date,
    dashboard: {
      hasInteraction: false,
      photos: [],
      words: [],
      highlight: [],
      ask: [],
    },
    diary: {
      submitted: false,
      submittedAt: null,
      updatedAt: null,
      instructions: template?.diary?.instructions || [],
      questions: template?.diary?.questions || [],
      responses: {},
    },
  };
}

function sanitizeResponses(responses, questions) {
  const next = { ...(responses || {}) };

  questions.forEach((question) => {
    if (!question.followup) return;
    const followupKey = `${question.id}_followup`;
    const answer = next[question.id];
    if (!shouldShowFollowup(question.followup, answer)) {
      delete next[followupKey];
    }
  });

  return next;
}

function QuestionBlock({
  question,
  number,
  value,
  followupValue,
  onChange,
  onFollowupChange,
}) {
  const toggleCheckbox = (option) => {
    const current = Array.isArray(value) ? value : [];
    if (current.includes(option)) {
      onChange(current.filter((item) => item !== option));
    } else {
      onChange([...current, option]);
    }
  };

  const showFollowup = shouldShowFollowup(question.followup, value);

  return (
    <div className="grid gap-3">
      <label className="text-sm font-semibold text-ink-700">
        {number}. {question.label}
      </label>

      {question.type === "checkbox" && (
        <div className="grid gap-2">
          {(question.options || []).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-ink-300"
                checked={Array.isArray(value) ? value.includes(option) : false}
                onChange={() => toggleCheckbox(option)}
              />
              {option}
            </label>
          ))}
        </div>
      )}

      {question.type === "radio" && (
        <div className="grid gap-2">
          {(question.options || []).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink-700">
              <input
                type="radio"
                name={question.id}
                className="h-4 w-4 border-ink-300"
                checked={value === option}
                onChange={() => onChange(option)}
              />
              {option}
            </label>
          ))}
        </div>
      )}

      {question.type === "textarea" && (
        <textarea
          className="input min-h-[140px]"
          placeholder="Write here"
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {showFollowup && (
        <div className="grid gap-2">
          <p className="text-xs text-ink-500">{question.followup.label}</p>
          <textarea
            className="input min-h-[120px]"
            placeholder="Write here"
            value={followupValue || ""}
            onChange={(event) => onFollowupChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function shouldShowFollowup(followup, answer) {
  if (!followup || !followup.showWhen) return false;

  const { operator, value } = followup.showWhen;
  if (operator === "equals") {
    return answer === value;
  }

  if (operator === "includesAny") {
    if (!Array.isArray(value)) return false;
    if (Array.isArray(answer)) return answer.some((item) => value.includes(item));
    if (typeof answer === "string") return value.includes(answer);
    return false;
  }

  return false;
}

function renderInstruction(text) {
  const highlights = ["once per day", "no right or wrong answers"];
  const lower = text.toLowerCase();
  const parts = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextIndex = -1;
    let nextLength = 0;

    highlights.forEach((phrase) => {
      const index = lower.indexOf(phrase, cursor);
      if (index !== -1 && (nextIndex === -1 || index < nextIndex)) {
        nextIndex = index;
        nextLength = phrase.length;
      }
    });

    if (nextIndex === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (nextIndex > cursor) {
      parts.push(text.slice(cursor, nextIndex));
    }

    parts.push(
      <strong key={`${nextIndex}-${nextLength}`} className="font-semibold text-ink-700">
        {text.slice(nextIndex, nextIndex + nextLength)}
      </strong>
    );

    cursor = nextIndex + nextLength;
  }

  return parts;
}
