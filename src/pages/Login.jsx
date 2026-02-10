import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-5 py-4">
          <img
            src="/assets/ella_logo.png"
            alt="ELLA logo"
            className="h-20 w-20 rounded-2xl object-contain"
          />
          <p className="text-lg uppercase tracking-[0.4em] text-ink-500">ELLA</p>
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
