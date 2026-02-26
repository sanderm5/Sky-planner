import type { Metadata } from 'next';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import CTA from '@/components/sections/CTA';

export const metadata: Metadata = {
  title: 'Demo',
  description: 'Se Sky Planner i aksjon. Video-demonstrasjoner og interaktive previews av systemet.',
};

const featureVideos = [
  { title: 'Interaktivt kart', description: 'Se hvordan kartet fungerer' },
  { title: 'Ruteplanlegging', description: 'Optimaliser kjørerutene dine' },
  { title: 'Varsler og påminnelser', description: 'Aldri gå glipp av en frist' },
  { title: 'Kalender', description: 'Planlegg og organiser avtaler' },
  { title: 'Kundeadministrasjon', description: 'Hold oversikt over alle kunder' },
  { title: 'E-postvarsler', description: 'Automatiser kundekommunikasjon' },
];

function PlayIcon({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  if (size === 'sm') {
    return (
      <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center group-hover:scale-110 transition-transform">
        <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
      <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

export default function DemoPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="container-wide text-center">
          <Badge className="mb-6">Se det i aksjon</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Oppdag hva Sky Planner kan gjøre for deg
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Se hvordan andre bedrifter bruker Sky Planner til å effektivisere sin kundehåndtering
          </p>
        </div>
      </section>

      {/* Main Video */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="container-wide max-w-4xl">
          <GlassCard padding="none" className="overflow-hidden">
            <div
              className="aspect-video bg-gradient-to-br from-primary-500/20 to-accent-purple/20 flex items-center justify-center relative group cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label="Spill av demo-video"
            >
              {/* Play Button */}
              <div className="absolute inset-0 flex items-center justify-center">
                <PlayIcon size="lg" />
              </div>

              {/* Video Placeholder Text */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-dark-900/80 to-transparent">
                <p className="text-white font-medium">Introduksjon til Sky Planner</p>
                <p className="text-dark-300 text-sm">3:45 min</p>
              </div>
            </div>
          </GlassCard>

          <p className="text-center text-dark-400 mt-4">
            Video kommer snart. I mellomtiden kan du{' '}
            <Link href="/auth/registrer" className="text-primary-400 hover:text-primary-300">
              starte en gratis prøveperiode
            </Link>{' '}
            for å utforske selv.
          </p>
        </div>
      </section>

      {/* Feature Videos */}
      <section className="section bg-dark-950/30">
        <div className="container-wide">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Utforsk funksjonene</h2>
            <p className="text-dark-300">Korte videoer som viser hver funksjon i detalj</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featureVideos.map((video) => (
              <GlassCard key={video.title} padding="none" hover className="overflow-hidden group">
                <div className="aspect-video bg-gradient-to-br from-primary-500/10 to-accent-purple/10 flex items-center justify-center relative">
                  <PlayIcon size="sm" />
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-white mb-1">{video.title}</h3>
                  <p className="text-sm text-dark-400">{video.description}</p>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* Try it yourself */}
      <section className="section">
        <div className="container-narrow text-center">
          <GlassCard className="py-12">
            <svg className="w-16 h-16 text-primary-400 mx-auto mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h2 className="text-2xl font-bold text-white mb-4">
              Prøv det selv - gratis i 14 dager
            </h2>
            <p className="text-dark-300 mb-8 max-w-md mx-auto">
              Den beste måten å forstå Sky Planner på er å prøve det selv.
              Start en gratis prøveperiode og utforsk alle funksjonene.
            </p>
            <Link href="/auth/registrer" className="btn-primary text-lg px-8 py-4">
              Start gratis prøveperiode
              <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </GlassCard>
        </div>
      </section>

      <CTA />
    </>
  );
}
