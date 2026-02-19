import { useEffect, useMemo, useState } from "react";
import { useBeforeUnload } from "react-router-dom";
import DatePicker from "../components/DatePicker.jsx";
import {
  ApiError,
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
  const [errorText, setErrorText] = useState("");
  const today = formatTodayDate();

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const list = await listDailySummaries();
        if (cancelled) return;

        setSummaries(list);
        setSummariesLoaded(true);

        const selectableDates = list.filter((item) => item.diarySelectable).map((item) => item.date);
        const initial = selectableDates.includes(today)
          ? today
          : nearestDate(today, selectableDates);
        setDiaryDate(initial);
      } catch (error) {
        if (cancelled) return;
        setSummariesLoaded(true);
        setErrorText("Failed to load diary date list.");
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [today]);

  useEffect(() => {
    if (!summariesLoaded) {
      setLoadingDaily(true);
      setDailyData(null);
      setFormValues({});
      setSavedValues({});
      return;
    }

    if (!diaryDate) {
      setLoadingDaily(false);
      setDailyData(null);
      setFormValues({});
      setSavedValues({});
      return;
    }

    let cancelled = false;
    async function load() {
      setLoadingDaily(true);
      setErrorText("");

      try {
        const json = await getDailyByDate(diaryDate);
        if (cancelled) return;

        const initialResponses = json.diary?.responses || {};
        const sanitized = sanitizeResponses(initialResponses, json.diary?.questions || []);
        setDailyData(json);
        setFormValues(sanitized);
        setSavedValues(sanitized);
      } catch (error) {
        if (cancelled) return;

        setDailyData(null);
        setFormValues({});
        setSavedValues({});

        if (error instanceof ApiError) {
          if (error.status === 404) {
            setErrorText("No diary record for this date.");
          } else if (error.status === 400) {
            setErrorText("Invalid request parameters.");
          } else if (error.status === 422) {
            setErrorText("Invalid diary payload format.");
          } else if (error.status === 500) {
            setErrorText("Server error. Please try again.");
          } else {
            setErrorText(error.message || "Failed to load diary data.");
          }
        } else {
          setErrorText("Failed to load diary data.");
        }
      } finally {
        if (!cancelled) setLoadingDaily(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [diaryDate, summariesLoaded]);

  const selectedSummary = useMemo(
    () => summaries.find((item) => item.date === diaryDate) || null,
    [summaries, diaryDate]
  );

  const availableDates = useMemo(
    () => summaries.filter((item) => item.diarySelectable).map((item) => item.date),
    [summaries]
  );

  const markedDates = useMemo(
    () =>
      summaries
        .filter((item) => item.todayBlueDot === true)
        .map((item) => item.date),
    [summaries]
  );

  const hasSubmitted = Boolean(dailyData?.diary?.submitted);
  const isEditable = Boolean(selectedSummary?.diaryEditable ?? dailyData?.meta?.diaryEditable);
  const isDirty = JSON.stringify(formValues) !== JSON.stringify(savedValues);

  useEffect(() => {
    window.__ellaDiaryDirty = isEditable && isDirty;
  }, [isEditable, isDirty]);

  useEffect(() => {
    return () => {
      window.__ellaDiaryDirty = false;
    };
  }, []);

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!isDirty || !isEditable) return;

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
  }, [isDirty, isEditable]);

  useBeforeUnload((event) => {
    if (!isEditable || !isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const questions = dailyData?.diary?.questions || [];
  const instructions = dailyData?.diary?.instructions || [];

  const canSubmit =
    isEditable &&
    Object.values(formValues).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return String(value || "").trim().length > 0;
    });

  async function refreshSummaries() {
    const latest = await listDailySummaries();
    setSummaries(latest);
  }

  async function saveDiary() {
    if (!dailyData || !diaryDate || !canSubmit || saving) return;
    setSaving(true);

    try {
      const sanitized = sanitizeResponses(formValues, questions);
      const payload = {
        responses: sanitized,
        submitted: true,
      };

      const updated = await updateDailyByDate(diaryDate, payload);
      const nextResponses = sanitizeResponses(
        updated?.diary?.responses || {},
        updated?.diary?.questions || []
      );

      setDailyData(updated);
      setFormValues(nextResponses);
      setSavedValues(nextResponses);
      await refreshSummaries();

      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      setErrorText("");
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setErrorText("仅可编辑今天");
        } else if (error.status === 422) {
          setErrorText("请求字段不合法");
        } else if (error.status === 400) {
          setErrorText("参数错误");
        } else if (error.status === 500) {
          setErrorText("Server error. Please try again.");
        } else {
          setErrorText(error.message || "Failed to save diary.");
        }
      } else {
        setErrorText("Failed to save diary.");
      }
    } finally {
      setSaving(false);
    }
  }

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
            if (!isDirty || !isEditable) {
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
          markedDates={markedDates}
          useAvailabilityStyles
          helperText={<span><span className="text-brand-500">●</span> Today submitted</span>}
        />
      </section>

      {errorText && (
        <section className="card p-5 text-sm text-red-600">{errorText}</section>
      )}

      <div className="relative grid gap-6">
        {loadingDaily && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/65 backdrop-blur-[1px]">
            <div className="rounded-2xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg">
              Loading...
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
            {!isEditable && (
              <p className="mt-2 text-sm text-ink-500">Past submissions are view-only.</p>
            )}
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
                followupValues={formValues}
                onChange={(nextValue) =>
                  setFormValues((prev) => {
                    const next = { ...prev, [question.id]: nextValue };
                    const visibleKeys = new Set(getVisibleFollowupKeys(question, nextValue));
                    getAllFollowupKeys(question).forEach((followupKey) => {
                      if (!visibleKeys.has(followupKey) && followupKey in next) {
                        delete next[followupKey];
                      }
                    });
                    return next;
                  })
                }
                onFollowupChange={(responseKey, nextValue) =>
                  setFormValues((prev) => ({ ...prev, [responseKey]: nextValue }))
                }
                disabled={!isEditable || loadingDaily}
              />
            ))}
          </div>
          {isEditable && (
            <button
              type="button"
              className={`btn-primary mt-8 w-full ${!canSubmit || saving || loadingDaily ? "opacity-50" : ""}`}
              disabled={!canSubmit || saving || loadingDaily}
              onClick={saveDiary}
            >
              {hasSubmitted ? "Save changes" : "Submit"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function sanitizeResponses(responses, questions) {
  const next = { ...(responses || {}) };

  questions.forEach((question) => {
    const answer = next[question.id];
    const visibleKeys = new Set(getVisibleFollowupKeys(question, answer));
    getAllFollowupKeys(question).forEach((followupKey) => {
      if (!visibleKeys.has(followupKey)) {
        delete next[followupKey];
      }
    });
  });

  return next;
}

function QuestionBlock({
  question,
  number,
  value,
  followupValues,
  onChange,
  onFollowupChange,
  disabled,
}) {
  const toggleCheckbox = (option) => {
    const current = Array.isArray(value) ? value : [];
    if (current.includes(option)) {
      onChange(current.filter((item) => item !== option));
    } else {
      onChange([...current, option]);
    }
  };

  const visibleFollowups = getFollowups(question).filter((followup) =>
    shouldShowFollowup(followup, value)
  );

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
                disabled={disabled}
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
                disabled={disabled}
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
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {visibleFollowups.map((followup, index) => {
        const responseKey =
          followup.responseKey || `${question.id}_followup${index === 0 ? "" : `_${index + 1}`}`;
        return (
          <div key={responseKey} className="grid gap-2">
            <p className="text-xs text-ink-500">{followup.label}</p>
            <textarea
              className="input min-h-[120px]"
              placeholder="Write here"
              value={followupValues[responseKey] || ""}
              disabled={disabled}
              onChange={(event) => onFollowupChange(responseKey, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}

function getFollowups(question) {
  if (Array.isArray(question.followups)) return question.followups;
  if (question.followup) return [{ ...question.followup, responseKey: `${question.id}_followup` }];
  return [];
}

function getAllFollowupKeys(question) {
  return getFollowups(question).map(
    (followup, index) =>
      followup.responseKey || `${question.id}_followup${index === 0 ? "" : `_${index + 1}`}`
  );
}

function getVisibleFollowupKeys(question, answer) {
  return getFollowups(question)
    .filter((followup) => shouldShowFollowup(followup, answer))
    .map(
      (followup, index) =>
        followup.responseKey || `${question.id}_followup${index === 0 ? "" : `_${index + 1}`}`
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
