'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Badge from '../ui/Badge';

export default function Hero() {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsLightboxOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isLightboxOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isLightboxOpen]);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-24 pb-16">
      {/* Nordic aurora background */}
      <div className="hero-aurora" aria-hidden="true">
        <div className="aurora-band aurora-band-1"></div>
        <div className="aurora-band aurora-band-2"></div>
        <div className="aurora-band aurora-band-3"></div>
        <div className="horizon-glow"></div>
        {/* Twinkling stars */}
        <div className="twinkle-star" style={{ top: '8%', left: '12%', animationDelay: '0s' }}></div>
        <div className="twinkle-star" style={{ top: '15%', left: '65%', animationDelay: '-2.5s' }}></div>
        <div className="twinkle-star twinkle-bright" style={{ top: '5%', left: '40%', animationDelay: '-1s' }}></div>
        <div className="twinkle-star" style={{ top: '22%', left: '85%', animationDelay: '-4s' }}></div>
        <div className="twinkle-star twinkle-bright" style={{ top: '30%', left: '25%', animationDelay: '-3s' }}></div>
        <div className="twinkle-star" style={{ top: '12%', left: '92%', animationDelay: '-5.5s' }}></div>
        <div className="twinkle-star" style={{ top: '35%', left: '55%', animationDelay: '-1.8s' }}></div>
        <div className="twinkle-star twinkle-bright" style={{ top: '18%', left: '78%', animationDelay: '-6s' }}></div>
      </div>

      <div className="container-wide relative z-10 px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr_1.3fr] gap-12 lg:gap-12 items-center">
          {/* Left: Text content */}
          <div className="text-left">
            <Badge className="mb-6" data-animate="fade-up">
              <svg className="w-3 h-3 mr-1.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              14 dagers gratis prøveperiode
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 text-balance" data-animate="fade-up" data-animate-delay="100">
              Ta full kontroll over
              <span className="gradient-text"> servicehverdagen</span>
            </h1>

            <p className="text-lg sm:text-xl text-dark-300 mb-8 text-balance" data-animate="fade-up" data-animate-delay="200">
              Spar opptil 10 timer i uken. Sky Planner gir deg full kontroll over kunder, ruter og avtaler – så du kan fokusere på det som faktisk tjener penger.
            </p>

            <ul className="space-y-3 mb-8 text-dark-300" data-animate="fade-up" data-animate-delay="300">
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-secondary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Se alle kunder på kartet – planlegg ruter med ett klikk</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-secondary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Automatiske påminnelser før kontrollfrister</span>
              </li>
              <li className="flex items-center gap-3">
                <svg className="w-5 h-5 text-secondary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Alt du trenger – samlet på ett sted</span>
              </li>
            </ul>

            <div className="flex flex-col sm:flex-row gap-4 mb-6" data-animate="fade-up" data-animate-delay="400">
              <Link href="/auth/registrer" className="btn-primary text-lg px-8 py-4">
                Kom i gang gratis
                <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <Link href="/demo" className="btn-secondary text-lg px-8 py-4">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Se demo
              </Link>
            </div>

            <p className="text-sm text-dark-400">
              Ingen kredittkort påkrevd. Klar på under 2 minutter.
            </p>
          </div>

          {/* Right: Screenshot */}
          <div className="relative lg:scale-110 lg:origin-left" data-animate="fade-left" data-animate-delay="200">
            <button
              className="screenshot-3d border border-dark-700/50 cursor-zoom-in w-full rounded-2xl overflow-hidden shadow-2xl shadow-primary-500/10"
              onClick={() => setIsLightboxOpen(true)}
              aria-label="Forstørr skjermbilde"
            >
              <img
                src="/screenshots/screenshot-map-overview.jpg"
                alt="Sky Planner - Interaktivt kart med kundeadministrasjon"
                className="w-full h-auto"
                loading="eager"
              />
            </button>
          </div>
        </div>

        {/* Trust badges */}
        <div className="mt-16 flex flex-wrap items-center justify-center lg:justify-start gap-8 text-dark-500" data-animate="fade-up">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-secondary-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm">GDPR-kompatibel</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-secondary-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span className="text-sm">Sikker datalagring</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-secondary-500" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
            <span className="text-sm">Norsk support</span>
          </div>
        </div>

        {/* Hero Lightbox */}
        {isLightboxOpen && (
          <div
            className="hero-lightbox active"
            onClick={() => setIsLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Forstørret skjermbilde"
          >
            <button
              className="lightbox-close"
              onClick={() => setIsLightboxOpen(false)}
              aria-label="Lukk"
              autoFocus
            >
              &times;
            </button>
            <img src="/screenshots/screenshot-map-overview.jpg" alt="Sky Planner - Interaktivt kart" />
            <p className="lightbox-hint">Trykk Escape eller klikk for å lukke</p>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .hero-lightbox {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(0, 0, 0, 0.95);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
          cursor: pointer;
        }

        .hero-lightbox.active {
          opacity: 1;
          visibility: visible;
        }

        .hero-lightbox img {
          max-width: 95vw;
          max-height: 90vh;
          object-fit: contain;
          border-radius: 1rem;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
          transform: scale(0.9);
          transition: transform 0.3s ease;
          pointer-events: none;
        }

        .hero-lightbox.active img {
          transform: scale(1);
        }

        .lightbox-close {
          position: absolute;
          top: 1rem;
          right: 1.5rem;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          font-size: 2rem;
          cursor: pointer;
          padding: 0.5rem;
          line-height: 1;
          z-index: 1;
          transition: color 0.2s;
        }

        .lightbox-close:hover,
        .lightbox-close:focus-visible {
          color: #fff;
          outline: 2px solid rgba(255, 255, 255, 0.5);
          outline-offset: 2px;
          border-radius: 4px;
        }

        .lightbox-hint {
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.875rem;
          margin-top: 1rem;
          pointer-events: none;
        }

        /* Nordic Aurora */
        .hero-aurora {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }

        .aurora-band {
          position: absolute;
          width: 150%;
          left: -25%;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0;
          animation: auroraWave 12s ease-in-out infinite;
        }

        .aurora-band-1 {
          top: 2%;
          height: 250px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(74, 222, 128, 0.12) 15%,
            rgba(94, 129, 172, 0.2) 30%,
            rgba(136, 192, 208, 0.25) 50%,
            rgba(74, 222, 128, 0.15) 70%,
            rgba(94, 129, 172, 0.1) 85%,
            transparent 100%
          );
          animation-delay: 0s;
        }

        .aurora-band-2 {
          top: 12%;
          height: 180px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(136, 192, 208, 0.15) 20%,
            rgba(180, 142, 173, 0.18) 45%,
            rgba(94, 129, 172, 0.2) 65%,
            rgba(74, 222, 128, 0.08) 85%,
            transparent 100%
          );
          animation-delay: -4s;
          animation-duration: 16s;
        }

        .aurora-band-3 {
          top: 22%;
          height: 140px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(74, 222, 128, 0.1) 25%,
            rgba(136, 192, 208, 0.16) 50%,
            rgba(180, 142, 173, 0.1) 75%,
            transparent 100%
          );
          animation-delay: -8s;
          animation-duration: 20s;
        }

        .horizon-glow {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 45%;
          background:
            radial-gradient(
              ellipse 60% 40% at 50% 100%,
              rgba(94, 129, 172, 0.1) 0%,
              transparent 65%
            ),
            radial-gradient(
              ellipse 40% 30% at 30% 100%,
              rgba(74, 222, 128, 0.05) 0%,
              transparent 50%
            );
        }

        /* Twinkling stars */
        .twinkle-star {
          position: absolute;
          width: 2px;
          height: 2px;
          background: rgba(216, 226, 236, 0.6);
          border-radius: 50%;
          animation: twinkle 4s ease-in-out infinite;
        }

        .twinkle-star::before {
          content: '';
          position: absolute;
          top: -1px;
          left: -1px;
          width: 4px;
          height: 4px;
          background: radial-gradient(circle, rgba(136, 192, 208, 0.4) 0%, transparent 70%);
          border-radius: 50%;
        }

        .twinkle-bright {
          width: 3px;
          height: 3px;
          background: rgba(136, 192, 208, 0.8);
        }

        .twinkle-bright::before {
          top: -2px;
          left: -2px;
          width: 7px;
          height: 7px;
          background: radial-gradient(circle, rgba(136, 192, 208, 0.5) 0%, transparent 70%);
        }

        @keyframes twinkle {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.4);
          }
        }

        @keyframes auroraWave {
          0% {
            opacity: 0.3;
            transform: translateX(-8%) scaleY(1);
          }
          25% {
            opacity: 0.7;
            transform: translateX(3%) scaleY(1.2);
          }
          50% {
            opacity: 0.5;
            transform: translateX(8%) scaleY(0.9);
          }
          75% {
            opacity: 0.8;
            transform: translateX(-3%) scaleY(1.15);
          }
          100% {
            opacity: 0.3;
            transform: translateX(-8%) scaleY(1);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .aurora-band {
            animation: none;
            opacity: 0.5;
          }
          .twinkle-star {
            animation: none;
            opacity: 0.6;
          }
        }
      `}} />
    </section>
  );
}
