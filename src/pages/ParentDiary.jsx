import { useState } from "react";
import records from "../data/records.json";
import diary from "../data/parentDiary.json";

export default function ParentDiary() {
  const [date] = useState(records.selectedDate);
  const hasSubmitted = diary.submittedDates.includes(date);
  const displayDate = new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  return (
    <div className="grid gap-6">
      <section>
        <p className="section-title">Parent diary</p>
        <p className="mt-2 text-2xl font-display">{displayDate}</p>
      </section>

      {hasSubmitted ? (
        <section className="card p-6 text-center">
          <p className="text-lg font-semibold">You already submitted this day.</p>
          <p className="mt-2 text-sm text-ink-500">Thank you for keeping track.</p>
        </section>
      ) : (
        <form className="card p-6">
          <div className="grid gap-5">
            {diary.questions.map((question) => (
              <div key={question.id}>
                <label className="text-sm font-semibold text-ink-700">
                  {question.label}
                </label>
                {question.type === "select" ? (
                  <select className="input mt-2">
                    <option value="">Select one</option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea className="input mt-2 min-h-[120px]" placeholder="Write here" />
                )}
              </div>
            ))}
          </div>
          <button type="button" className="btn-primary mt-6 w-full">
            Submit
          </button>
        </form>
      )}
    </div>
  );
}
