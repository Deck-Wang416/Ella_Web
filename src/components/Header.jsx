import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function Header({ active, onOpenProfile }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [wiggle, setWiggle] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!wiggle) return;
    const timer = setTimeout(() => setWiggle(false), 450);
    return () => clearTimeout(timer);
  }, [wiggle]);

  return (
    <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-4">
          <img
            src="/assets/ella_logo.png"
            alt="ELLA logo"
            className="h-20 w-20 rounded-2xl object-contain"
          />
          <p className="text-lg uppercase tracking-[0.4em] text-ink-500">ELLA</p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((prev) => !prev);
              setWiggle(true);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white shadow-sm transition hover:border-brand-200"
            aria-label="Open profile menu"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full bg-ink-100 text-ink-600 ${wiggle ? "avatar-wiggle" : ""}`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="8" r="4" />
              </svg>
            </span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-3 w-44 rounded-2xl border border-ink-100 bg-white p-2 shadow-card">
              <button
                type="button"
                onClick={() => {
                  onOpenProfile();
                  setMenuOpen(false);
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink-700 transition hover:bg-ink-100"
              >
                Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/login");
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink-700 transition hover:bg-ink-100"
              >
                Logout
              </button>
            </div>
          )}
        </div>
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
