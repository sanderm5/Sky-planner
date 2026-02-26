import Link from 'next/link';

export default function CTA() {
  return (
    <section className="section relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-800 -z-10"></div>
      <div className="absolute inset-0 opacity-10 -z-10" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>

      {/* Nordic light rays + stars */}
      <div className="cta-aurora" aria-hidden="true">
        <div className="cta-ray cta-ray-1"></div>
        <div className="cta-ray cta-ray-2"></div>
        <div className="cta-ray cta-ray-3"></div>
        <div className="cta-star" style={{ top: '15%', left: '8%', animationDelay: '0s' }}></div>
        <div className="cta-star" style={{ top: '25%', left: '45%', animationDelay: '-2s' }}></div>
        <div className="cta-star" style={{ top: '10%', left: '75%', animationDelay: '-4s' }}></div>
        <div className="cta-star" style={{ top: '60%', left: '20%', animationDelay: '-1.5s' }}></div>
        <div className="cta-star" style={{ top: '70%', left: '88%', animationDelay: '-3.5s' }}></div>
      </div>

      <div className="container-narrow text-center">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4" data-animate="fade-up">
          Klar til å effektivisere arbeidshverdagen?
        </h2>
        <p className="text-lg sm:text-xl text-primary-100 mb-8 max-w-xl mx-auto" data-animate="fade-up" data-animate-delay="100">
          Start gratis i dag og se hvor mye tid du kan spare med Sky Planner
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center" data-animate="fade-up" data-animate-delay="200">
          <Link
            href="/auth/registrer"
            className="inline-flex items-center justify-center rounded-xl bg-white px-8 py-4 text-lg font-semibold text-primary-600 shadow-lg shadow-black/20 transition-all hover:bg-primary-50 hover:scale-105"
          >
            Start gratis prøveperiode
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <Link
            href="/kontakt"
            className="inline-flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-white/20"
          >
            Kontakt salg
          </Link>
        </div>

        <p className="text-sm text-primary-200 mt-6" data-animate="fade-up" data-animate-delay="300">
          Ingen kredittkort påkrevd &bull; Full tilgang i 14 dager &bull; Avbryt når som helst
        </p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .cta-aurora {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: -5;
        }

        .cta-ray {
          position: absolute;
          width: 2px;
          height: 200%;
          top: -50%;
          filter: blur(30px);
          opacity: 0;
          animation: ctaRayShimmer 8s ease-in-out infinite;
        }

        .cta-ray-1 {
          left: 20%;
          width: 100px;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(255, 255, 255, 0.08) 30%,
            rgba(136, 192, 208, 0.12) 50%,
            rgba(255, 255, 255, 0.08) 70%,
            transparent 100%
          );
          transform: rotate(-15deg);
          animation-delay: 0s;
        }

        .cta-ray-2 {
          left: 55%;
          width: 80px;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(255, 255, 255, 0.06) 30%,
            rgba(94, 180, 140, 0.1) 50%,
            rgba(255, 255, 255, 0.06) 70%,
            transparent 100%
          );
          transform: rotate(10deg);
          animation-delay: -3s;
          animation-duration: 10s;
        }

        .cta-ray-3 {
          left: 80%;
          width: 60px;
          background: linear-gradient(
            180deg,
            transparent 0%,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(180, 142, 173, 0.08) 50%,
            rgba(255, 255, 255, 0.05) 70%,
            transparent 100%
          );
          transform: rotate(-8deg);
          animation-delay: -6s;
          animation-duration: 12s;
        }

        @keyframes ctaRayShimmer {
          0% {
            opacity: 0.15;
            transform: rotate(var(--ray-rotate, -15deg)) translateY(-5%);
          }
          50% {
            opacity: 0.4;
            transform: rotate(var(--ray-rotate, -15deg)) translateY(5%);
          }
          100% {
            opacity: 0.15;
            transform: rotate(var(--ray-rotate, -15deg)) translateY(-5%);
          }
        }

        .cta-ray-1 { --ray-rotate: -15deg; }
        .cta-ray-2 { --ray-rotate: 10deg; }
        .cta-ray-3 { --ray-rotate: -8deg; }

        .cta-star {
          position: absolute;
          width: 2px;
          height: 2px;
          background: rgba(255, 255, 255, 0.7);
          border-radius: 50%;
          animation: ctaTwinkle 3s ease-in-out infinite;
        }

        .cta-star::before {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          width: 6px;
          height: 6px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
          border-radius: 50%;
        }

        @keyframes ctaTwinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }

        @media (prefers-reduced-motion: reduce) {
          .cta-ray {
            animation: none;
            opacity: 0.25;
          }
          .cta-star {
            animation: none;
            opacity: 0.6;
          }
        }
      `}} />
    </section>
  );
}
