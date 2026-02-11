import { useState } from "react";
import records from "../data/records.json";
import diary from "../data/parentDiary.json";
import DatePicker from "../components/DatePicker.jsx";

export default function ParentDiary() {
  const [diaryDate, setDiaryDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const hasSubmitted = diary.submittedDates.includes(diaryDate);

  return (
    <div className="grid gap-6">
      <section>
        <DatePicker
          label="Date"
          selectedDate={diaryDate}
          onChange={setDiaryDate}
          availableDates={records.availableDates}
          allowAll
          markedDates={diary.submittedDates}
          useAvailabilityStyles={false}
        />
      </section>

      <section className="card p-6">
        <p className="text-sm font-semibold text-ink-700">Caregiver Instruction</p>
        <ul className="mt-3 grid gap-2 text-sm text-ink-600">
          {diary.instructions.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </section>

      {hasSubmitted ? (
        <section className="card p-6 text-center">
          <p className="text-lg font-semibold">You already submitted this day.</p>
          <p className="mt-2 text-sm text-ink-500">Thank you for keeping track.</p>
        </section>
      ) : (
        <form className="card p-6">
          <div className="grid gap-8">
            {diary.sections.map((section, sectionIndex) =>
              section.questions.map((question, questionIndex) => {
                const number =
                  diary.sections
                    .slice(0, sectionIndex)
                    .reduce((total, item) => total + item.questions.length, 0) +
                  questionIndex +
                  1;

                return (
                  <QuestionBlock key={question.id} question={question} number={number} />
                );
              })
            )}
          </div>
          <button type="button" className="btn-primary mt-8 w-full">
            Submit
          </button>
        </form>
      )}
    </div>
  );
}

function QuestionBlock({ question, number }) {
  return (
    <div className="grid gap-3">
      <label className="text-sm font-semibold text-ink-700">
        {number}. {question.label}
      </label>
      {question.type === "checkbox" && (
        <div className="grid gap-2">
          {question.options.map((option) => {
            if (typeof option === "string") {
              return (
                <label key={option} className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" className="h-4 w-4 rounded border-ink-300" />
                  {option}
                </label>
              );
            }

            return (
              <div key={option.label} className="grid gap-2">
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" className="h-4 w-4 rounded border-ink-300" />
                  {option.label}
                </label>
                <input className="input" placeholder="Please specify" />
              </div>
            );
          })}
        </div>
      )}
      {question.type === "radio" && (
        <div className="grid gap-2">
          {question.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-ink-700">
              <input type="radio" name={question.id} className="h-4 w-4 border-ink-300" />
              {option}
            </label>
          ))}
        </div>
      )}
      {question.type === "textarea" && (
        <textarea className="input min-h-[140px]" placeholder="Write here" />
      )}
      {question.followup && (
        <div className="grid gap-2">
          <p className="text-xs text-ink-500">{question.followup}</p>
          <textarea className="input min-h-[120px]" placeholder="Write here" />
        </div>
      )}
    </div>
  );
}
