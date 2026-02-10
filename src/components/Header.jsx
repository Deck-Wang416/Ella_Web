import { Link } from "react-router-dom";

export default function Header({ active, onOpenProfile }) {
  return (
    <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <span className="text-lg font-bold">E</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-ink-500">ELLA</p>
            <p className="font-display text-lg">Parent Portal</p>
          </div>
        </div>
        <button type="button" onClick={onOpenProfile} className="btn-ghost">
          Child Profile
        </button>
      </div>
      <nav className="mx-auto flex w-full max-w-4xl gap-4 px-5 pb-4">
        <TabLink to="/dashboard" active={active === "dashboard"}>
          Dashboard
        </TabLink>
        <TabLink to="/parent-diary" active={active === "parent-diary"}>
          Parent Diary
        </TabLink>
      </nav>
    </header>
  );
}

function TabLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-brand-500 text-white shadow-lg shadow-brand-200/60"
          : "text-ink-700 hover:text-brand-600"
      }`}
    >
      {children}
    </Link>
  );
}
