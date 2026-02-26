'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

interface DashboardHeaderProps {
  user: {
    id: number;
    navn: string;
    epost: string;
  };
  organization: {
    id: number;
    navn: string;
  };
}

export function DashboardHeader({ user, organization }: DashboardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Get initials from name
  const initials = user.navn
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [closeMenu]);

  // Close on Escape
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && menuOpen) {
        closeMenu();
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [menuOpen, closeMenu]);

  return (
    <header className="sticky top-0 z-20 bg-dark-900/95 backdrop-blur-sm border-b border-dark-700/50">
      <div className="flex items-center justify-between h-16 px-4 lg:px-8">
        {/* Mobile Menu Toggle */}
        <button
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).__openSidebar) {
              (window as any).__openSidebar();
            }
          }}
          className="lg:hidden p-2 text-dark-400 hover:text-white rounded-lg hover:bg-dark-800/50 transition-colors"
          aria-label="Åpne sidemeny"
          aria-expanded="false"
          aria-controls="sidebar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Spacer for desktop (title removed - pages handle their own headings) */}
        <div className="hidden lg:block" />

        {/* Right Side */}
        <div className="flex items-center gap-4">
          {/* Notifications (placeholder) */}
          <button
            className="p-2 text-dark-400 hover:text-white rounded-lg hover:bg-dark-800/50 transition-colors relative"
            aria-label="Varsler"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
          </button>

          {/* User Menu */}
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex items-center gap-3 p-2 rounded-xl hover:bg-dark-800/50 transition-colors"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-controls="user-menu"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center">
                <span className="text-sm font-semibold text-white">{initials}</span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-white">{user.navn}</p>
                <p className="text-xs text-dark-400">{organization.navn}</p>
              </div>
              <svg
                className="w-4 h-4 text-dark-400 hidden sm:block"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {menuOpen && (
              <div
                ref={menuRef}
                id="user-menu"
                role="menu"
                aria-label="Brukermeny"
                className="absolute right-0 mt-2 w-56 bg-dark-800 border border-dark-700 rounded-xl shadow-xl"
              >
                <div className="p-3 border-b border-dark-700">
                  <p className="text-sm font-medium text-white">{user.navn}</p>
                  <p className="text-xs text-dark-400">{user.epost}</p>
                </div>
                <div className="p-2">
                  <Link
                    href="/dashboard/innstillinger"
                    role="menuitem"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-700/50 rounded-lg transition-colors"
                    onClick={closeMenu}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Innstillinger
                  </Link>
                  <a
                    href="/api/auth/logout"
                    role="menuitem"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-dark-700/50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                    Logg ut
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
