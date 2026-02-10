import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
            <span className="text-lg font-bold">E</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-ink-500">ELLA</p>
            <p className="font-display text-lg">Parent Portal</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-5 py-12">
        <div>
          <h1 className="font-display text-3xl">Welcome back</h1>
          <p className="mt-2 text-sm text-ink-500">Please log in with the account provided by your team.</p>
        </div>
        <div className="card p-6">
          <label className="text-sm font-semibold text-ink-700">Username</label>
          <input className="input mt-2" placeholder="Enter username" />
          <label className="mt-4 text-sm font-semibold text-ink-700">Password</label>
          <input className="input mt-2" type="password" placeholder="Enter password" />
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="btn-primary mt-6 w-full"
          >
            Log in
          </button>
        </div>
      </main>
    </div>
  );
}
