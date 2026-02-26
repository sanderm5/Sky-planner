import type { Metadata } from 'next';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import ContactForm from '@/components/ContactForm';

export const metadata: Metadata = {
  title: 'Kontakt',
  description: 'Kontakt oss for spørsmål om Sky Planner. Vi hjelper deg gjerne.',
};

export default function KontaktPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="container-wide text-center">
          <Badge className="mb-6">Ta kontakt</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Vi hører gjerne fra deg
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Har du spørsmål om Sky Planner? Ønsker du en demo? Eller bare vil si hei?
            Fyll ut skjemaet under, så tar vi kontakt.
          </p>
        </div>
      </section>

      {/* Contact Form & Info */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="container-wide">
          <div className="grid lg:grid-cols-3 gap-12">
            {/* Contact Form */}
            <div className="lg:col-span-2">
              <GlassCard>
                <ContactForm />
              </GlassCard>
            </div>

            {/* Contact Info */}
            <div className="space-y-6">
              <GlassCard>
                <h3 className="font-semibold text-white mb-4">Kontakt oss</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-medium text-primary-400">SM</span>
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">Sander Martinsen</p>
                      <a href="tel:+4745140089" className="text-dark-400 hover:text-primary-400 text-sm block">+47 451 40 089</a>
                      <a href="mailto:sander@efffekt.no" className="text-dark-400 hover:text-primary-400 text-sm">sander@efffekt.no</a>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-medium text-primary-400">DB</span>
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">Daniel Barlag</p>
                      <a href="tel:+4798035064" className="text-dark-400 hover:text-primary-400 text-sm block">+47 980 35 064</a>
                      <a href="mailto:daniel@efffekt.no" className="text-dark-400 hover:text-primary-400 text-sm">daniel@efffekt.no</a>
                    </div>
                  </div>
                </div>
              </GlassCard>

              <GlassCard>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Bedrift</h3>
                    <p className="text-dark-300">Efffekt AS</p>
                    <p className="text-sm text-dark-400 mt-1">Org.nr: 937 019 793</p>
                  </div>
                </div>
              </GlassCard>

              <GlassCard>
                <h3 className="font-semibold text-white mb-3">Ofte stilte spørsmål</h3>
                <p className="text-dark-400 text-sm mb-4">
                  Kanskje finner du svaret du leter etter i vår FAQ.
                </p>
                <Link href="/faq" className="text-primary-400 hover:text-primary-300 text-sm font-medium">
                  Se FAQ &rarr;
                </Link>
              </GlassCard>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
