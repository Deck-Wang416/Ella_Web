export default function ModeSwitch({
  availableModes = [],
  selectedMode,
  onChange,
  disabled = false,
}) {
  if (!availableModes || availableModes.length <= 1) return null;

  return (
    <section className="card p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="section-title">Mode</p>
        <div className="inline-flex rounded-2xl bg-ink-100 p-1">
          {availableModes.map((mode) => {
            const active = selectedMode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled || active}
                onClick={() => onChange(mode)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize transition ${
                  active
                    ? "bg-white text-brand-600 shadow-sm"
                    : "text-ink-600 hover:text-ink-900"
                } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              >
                {mode}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
