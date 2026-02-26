'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function ScrollAnimationObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Wait for next frame to ensure all DOM elements are rendered
    const rafId = requestAnimationFrame(() => {
      const elements = document.querySelectorAll('[data-animate]:not(.is-visible)');

      if (reducedMotion) {
        elements.forEach((el) => el.classList.add('is-visible'));
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
      );

      elements.forEach((el) => observer.observe(el));

      // Store cleanup ref
      (window as unknown as Record<string, IntersectionObserver>).__scrollObserver = observer;
    });

    return () => {
      cancelAnimationFrame(rafId);
      const obs = (window as unknown as Record<string, IntersectionObserver>).__scrollObserver;
      if (obs) {
        obs.disconnect();
        delete (window as unknown as Record<string, IntersectionObserver>).__scrollObserver;
      }
    };
  }, [pathname]);

  return null;
}
