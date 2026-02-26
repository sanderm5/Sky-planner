import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/10 rounded-full filter blur-[128px]"></div>

      <div className="container mx-auto px-6 text-center relative z-10">
        <div className="max-w-lg mx-auto">
          <p className="text-8xl font-bold text-primary-500/30 mb-4">404</p>
          <h1 className="text-3xl font-bold text-white mb-4">Side ikke funnet</h1>
          <p className="text-dark-400 mb-8">
            Beklager, siden du leter etter finnes ikke eller har blitt flyttet.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/" className="btn-primary">Gå til forsiden</Link>
            <Link href="/auth/login" className="btn-ghost">Logg inn</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
