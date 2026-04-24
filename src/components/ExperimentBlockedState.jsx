export default function ExperimentBlockedState({ title, description }) {
  return (
    <section className="card flex min-h-[60vh] items-center justify-center p-8 text-center">
      <div className="max-w-xl">
        <p className="section-title">Testing Status</p>
        <h1 className="mt-3 font-display text-3xl">{title}</h1>
        <p className="mt-4 text-sm text-ink-500">{description}</p>
      </div>
    </section>
  );
}
