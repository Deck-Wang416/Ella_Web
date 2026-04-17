export default function DailyConditionInitModal({
  open,
  date,
  loading = false,
  errorText = "",
  onSelect,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-card">
        <div className="grid gap-3 text-center">
          <p className="section-title">Create Daily</p>
          <h2 className="font-display text-2xl">Choose Today&apos;s Mode</h2>
          <p className="text-sm text-ink-500">
            No daily record exists for {date}. Select which mode to initialize.
          </p>
        </div>

        <div className="mt-6 grid gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => onSelect("robot")}
            className={`btn-primary w-full ${loading ? "opacity-50" : ""}`}
          >
            Robot
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => onSelect("parent")}
            className={`btn-ghost w-full ${loading ? "opacity-50" : ""}`}
          >
            Parent
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="text-sm text-ink-500 transition hover:text-ink-700"
          >
            Cancel
          </button>
        </div>

        {errorText && (
          <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorText}
          </p>
        )}
      </div>
    </div>
  );
}
