'use client';

import { useState, useEffect } from 'react';

const screenshots = [
  {
    src: '/screenshots/screenshot-map-detail.jpg',
    alt: 'Kundekart med markører',
    title: 'Oversiktlig kundekart',
    description: 'Se alle kunder på et interaktivt kart med smarte klynger, fargede markører og filtrering.',
  },
  {
    src: '/screenshots/screenshot-customer-list.jpg',
    alt: 'Kundeliste med detaljer',
    title: 'Detaljert kundeoversikt',
    description: 'Søk og filtrer i kundelisten med full oversikt over kontaktinfo, avtaler og servicehistorikk.',
  },
  {
    src: '/screenshots/screenshot-weekplan.jpg',
    alt: 'Ukeplanlegging',
    title: 'Effektiv ukeplanlegging',
    description: 'Planlegg uken med drag-and-drop, se kundedetaljer og optimaliser rekkefølgen automatisk.',
  },
  {
    src: '/screenshots/screenshot-calendar.jpg',
    alt: 'Kalender med avtaler',
    title: 'Kalender og avtaler',
    description: 'Hold oversikt over alle avtaler i en oversiktlig kalendervisning med direkte tilgang til kundeinformasjon.',
  },
  {
    src: '/screenshots/screenshot-route-planning.jpg',
    alt: 'Ruteplanlegging',
    title: 'Smart ruteplanlegging',
    description: 'Optimaliser kjøreruter automatisk basert på geografi, tid og kapasitet — spar tid og drivstoff.',
  },
  {
    src: '/screenshots/screenshot-teamchat.jpg',
    alt: 'Teamchat',
    title: 'Teamkommunikasjon',
    description: 'Koordiner med teamet direkte i appen — del oppdateringer og hold alle informert.',
  },
];

export default function Showcase() {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (lightbox) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [lightbox]);

  return (
    <>
      <section className="section relative overflow-hidden" id="showcase">
        {/* Atmospheric glow */}
        <div className="absolute top-1/4 -left-32 w-[400px] h-[400px] bg-gradient-radial from-primary-500/[0.05] to-transparent rounded-full filter blur-[100px] pointer-events-none" aria-hidden="true"></div>
        <div className="absolute bottom-1/3 -right-32 w-[350px] h-[350px] bg-gradient-radial from-accent-frost/[0.04] to-transparent rounded-full filter blur-[100px] pointer-events-none" aria-hidden="true"></div>
        <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4" data-animate="fade-up">
              Se Sky Planner i aksjon
            </h2>
            <p className="text-lg text-dark-300 max-w-2xl mx-auto" data-animate="fade-up" data-animate-delay="100">
              Et kraftig verktøy designet for å gjøre hverdagen enklere for servicebedrifter
            </p>
          </div>

          <div className="space-y-32">
            {screenshots.map((screenshot, index) => (
              <div key={screenshot.src} className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-16`}>
                {/* Screenshot */}
                <div className="lg:flex-[2] w-full" data-animate={index % 2 === 0 ? 'fade-right' : 'fade-left'}>
                  <div className={`relative ${index % 2 === 0 ? 'screenshot-tilt-left' : 'screenshot-tilt-right'}`}>
                    <button
                      className="screenshot-3d-alt border border-dark-700/50 cursor-zoom-in w-full"
                      onClick={() => setLightbox({ src: screenshot.src, alt: screenshot.alt })}
                      aria-label={`Forstørr: ${screenshot.alt}`}
                    >
                      <img
                        src={screenshot.src}
                        alt={screenshot.alt}
                        loading="lazy"
                        className="w-full h-auto"
                      />
                    </button>
                  </div>
                </div>

                {/* Text */}
                <div className="lg:flex-1 text-center lg:text-left" data-animate={index % 2 === 0 ? 'fade-left' : 'fade-right'} data-animate-delay="200">
                  <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                    {screenshot.title}
                  </h3>
                  <p className="text-lg text-dark-300 mb-6">
                    {screenshot.description}
                  </p>
                  <div className="flex items-center justify-center lg:justify-start gap-2 text-primary-400">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="font-medium">Inkludert i alle planer</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Lightbox */}
      <div
        className={`showcase-lightbox${lightbox ? ' active' : ''}`}
        onClick={() => setLightbox(null)}
      >
        {lightbox && (
          <img
            src={lightbox.src}
            alt={lightbox.alt}
          />
        )}
        <p className="showcase-lightbox-hint">Klikk hvor som helst for å lukke</p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .screenshot-tilt-left .screenshot-3d-alt {
          transform: perspective(1200px) rotateX(5deg) rotateY(8deg);
        }

        .screenshot-tilt-right .screenshot-3d-alt {
          transform: perspective(1200px) rotateX(5deg) rotateY(-8deg);
        }

        .screenshot-3d-alt {
          border-radius: 1rem;
          overflow: hidden;
          transition: transform 0.6s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.6s ease;
          box-shadow:
            0 30px 60px -15px rgba(0, 0, 0, 0.5),
            0 0 50px rgba(var(--accent-rgb), 0.15),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }

        .screenshot-tilt-left .screenshot-3d-alt:hover {
          transform: perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1.03);
          box-shadow:
            0 40px 80px -20px rgba(0, 0, 0, 0.6),
            0 0 80px rgba(var(--accent-rgb), 0.25);
        }

        .screenshot-tilt-right .screenshot-3d-alt:hover {
          transform: perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1.03);
          box-shadow:
            0 40px 80px -20px rgba(0, 0, 0, 0.6),
            0 0 80px rgba(var(--accent-rgb), 0.25);
        }

        /* Glow under image */
        .screenshot-tilt-left::before,
        .screenshot-tilt-right::before {
          content: '';
          position: absolute;
          bottom: -20px;
          left: 10%;
          right: 10%;
          height: 40px;
          background: radial-gradient(ellipse at center, rgba(var(--accent-rgb), 0.3) 0%, transparent 70%);
          filter: blur(20px);
          z-index: -1;
          transition: opacity 0.5s ease;
        }

        .screenshot-tilt-left:hover::before,
        .screenshot-tilt-right:hover::before {
          opacity: 0.8;
        }

        /* Lightbox */
        .showcase-lightbox {
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

        .showcase-lightbox.active {
          opacity: 1;
          visibility: visible;
        }

        .showcase-lightbox img {
          max-width: 95vw;
          max-height: 90vh;
          object-fit: contain;
          border-radius: 1rem;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
          transform: scale(0.9);
          transition: transform 0.3s ease;
          pointer-events: none;
        }

        .showcase-lightbox.active img {
          transform: scale(1);
        }

        .showcase-lightbox-hint {
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.875rem;
          margin-top: 1rem;
          pointer-events: none;
        }
      `}} />
    </>
  );
}
