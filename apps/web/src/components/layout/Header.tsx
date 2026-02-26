'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const navLinks = [
  { href: '/funksjoner', label: 'Funksjoner' },
  { href: '/priser', label: 'Priser' },
  { href: '/demo', label: 'Demo' },
  { href: '/faq', label: 'FAQ' },
  { href: '/kontakt', label: 'Kontakt' },
];

export default function Header() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        !menuButtonRef.current?.contains(e.target as Node) &&
        !mobileMenuRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [closeMenu]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isMenuOpen) {
        closeMenu();
        menuButtonRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen, closeMenu]);

  // Close menu on route change
  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  return (
    <>
      <style jsx>{`
        .logo-icon .bar {
          transform-origin: bottom center;
          transition: transform 0.3s ease, opacity 0.3s ease;
        }

        .group:hover .logo-icon .bar-1 {
          transform: scaleY(1.15);
          opacity: 0.7;
        }

        .group:hover .logo-icon .bar-2 {
          transform: scaleY(1.1);
          opacity: 0.9;
        }

        .group:hover .logo-icon .bar-3 {
          transform: scaleY(1.05);
        }

        .logo-icon .trend-line {
          stroke-dasharray: 2 3;
          stroke-dashoffset: 0;
          animation: dash 2s linear infinite;
        }

        @keyframes dash {
          to {
            stroke-dashoffset: -20;
          }
        }
      `}</style>

      <header className="fixed top-0 left-0 right-0 z-50 bg-dark-900/95 backdrop-blur-sm border-b border-dark-800/50">
        <nav className="container-wide flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8" aria-label="Hovednavigasjon">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group" aria-label="Skyplanner - Gå til forsiden">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center shadow-glow group-hover:shadow-glow-lg transition-shadow">
              <svg className="w-5 h-5 logo-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <rect className="bar bar-1" x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5"/>
                <rect className="bar bar-2" x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75"/>
                <rect className="bar bar-3" x="21" y="6" width="5" height="22" rx="1" fill="white"/>
                <path className="trend-line" d="M6 16L15 9L24 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3"/>
              </svg>
            </div>
            <span className="text-xl font-bold text-white group-hover:text-primary-400 transition-colors">Skyplanner</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'text-white bg-dark-800/50'
                    : 'text-dark-300 hover:text-white hover:bg-dark-800/30'
                )}
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/login" className="btn-ghost">
              Logg inn
            </Link>
            <Link href="/auth/registrer" className="btn-primary text-sm px-4 py-2">
              Prøv gratis
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-dark-300 hover:text-white hover:bg-dark-800/50 transition-colors"
            ref={menuButtonRef}
            aria-label="Åpne meny"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            onClick={() => setIsMenuOpen((prev) => !prev)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </nav>

        {/* Mobile Menu */}
        <div
          id="mobile-menu"
          ref={mobileMenuRef}
          className={clsx(
            'md:hidden absolute top-16 left-0 right-0 bg-dark-900/98 backdrop-blur-sm border-b border-dark-800/50',
            !isMenuOpen && 'hidden'
          )}
        >
          <div className="px-4 py-4 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'block px-4 py-3 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'text-white bg-dark-800/50'
                    : 'text-dark-300 hover:text-white hover:bg-dark-800/30'
                )}
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {link.label}
              </Link>
            ))}
            <hr className="border-dark-700/50 my-3" />
            <Link href="/auth/login" className="block px-4 py-3 rounded-lg text-sm font-medium text-dark-300 hover:text-white hover:bg-dark-800/30">
              Logg inn
            </Link>
            <Link href="/auth/registrer" className="block px-4 py-3 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 text-center">
              Prøv gratis
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
