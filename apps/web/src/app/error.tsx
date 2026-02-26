'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-red-500/10 rounded-full filter blur-[128px]"></div>

      <div className="container mx-auto px-6 text-center relative z-10">
        <div className="max-w-lg mx-auto">
          <p className="text-8xl font-bold text-red-500/30 mb-4">500</p>
          <h1 className="text-3xl font-bold text-white mb-4">Noe gikk galt</h1>
          <p className="text-dark-400 mb-8">
            Beklager, det oppstod en uventet feil. Prøv å laste siden på nytt.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/" className="btn-primary">Gå til forsiden</a>
            <button onClick={() => reset()} className="btn-ghost">Last inn på nytt</button>
          </div>
        </div>
      </div>
    </section>
  );
}
