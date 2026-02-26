'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';

interface SidebarProps {
  organization: {
    id: number;
    navn: string;
    slug: string;
    plan_type: string;
    logo_url?: string;
    app_mode?: string;
  };
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.skyplanner.no';

export function Sidebar({ organization }: SidebarProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isEnterprise = organization.app_mode === 'full';

  const navItems = [
    { href: '/dashboard', label: 'Oversikt', icon: 'home' },
    { href: '/dashboard/brukere', label: 'Brukere', icon: 'users' },
    ...(!isEnterprise
      ? [
          { href: '/dashboard/abonnement', label: 'Abonnement', icon: 'credit-card' },
          { href: '/dashboard/fakturaer', label: 'Fakturaer', icon: 'document' },
        ]
      : []),
    { href: '/dashboard/innstillinger', label: 'Innstillinger', icon: 'cog' },
  ];

  function isActive(href: string): boolean {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/dashboard/';
    }
    return pathname.startsWith(href);
  }

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    document.body.classList.remove('overflow-hidden');
  }, []);

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
    document.body.classList.add('overflow-hidden');
  }, []);

  // Close sidebar on Escape
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && sidebarOpen) {
        closeSidebar();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [sidebarOpen, closeSidebar]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  // Expose openSidebar globally so the header menu-toggle can call it
  useEffect(() => {
    (window as any).__openSidebar = openSidebar;
    return () => {
      delete (window as any).__openSidebar;
    };
  }, [openSidebar]);

  return (
    <>
      <aside
        id="sidebar"
        className={clsx(
          'fixed inset-y-0 left-0 z-40 w-64 bg-dark-900/98 backdrop-blur-sm border-r border-dark-700/50',
          'transform transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo & Org Name */}
          <div className="p-6 border-b border-dark-700/50">
            <div className="flex items-center gap-3">
              {organization.logo_url ? (
                <>
                  <img
                    src={organization.logo_url}
                    alt={organization.navn}
                    className="w-10 h-10 rounded-xl object-cover bg-dark-700 border border-dark-600"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = 'none';
                      const fallback = img.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple items-center justify-center shadow-glow hidden">
                    <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                      <rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5" />
                      <rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75" />
                      <rect x="21" y="6" width="5" height="22" rx="1" fill="white" />
                      <path d="M6 16L15 9L24 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
                    </svg>
                  </div>
                </>
              ) : (
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center shadow-glow">
                  <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5" />
                    <rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75" />
                    <rect x="21" y="6" width="5" height="22" rx="1" fill="white" />
                    <path d="M6 16L15 9L24 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
                  </svg>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-semibold truncate font-sans">{organization.navn}</h2>
                <span className="text-xs text-dark-400 capitalize">{organization.plan_type}</span>
              </div>
            </div>

            {/* Close button (mobile) */}
            <button
              onClick={closeSidebar}
              className="absolute top-4 right-4 lg:hidden p-2 text-dark-400 hover:text-white"
              aria-label="Lukk meny"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Dashboard-navigasjon">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                  isActive(item.href)
                    ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                    : 'text-dark-300 hover:bg-dark-800/50 hover:text-white'
                )}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                <span className="w-5 h-5" aria-hidden="true">
                  {item.icon === 'home' && (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  )}
                  {item.icon === 'users' && (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  )}
                  {item.icon === 'credit-card' && (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  )}
                  {item.icon === 'document' && (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  {item.icon === 'cog' && (
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* Bottom Section */}
          <div className="p-4 border-t border-dark-700/50">
            <a
              href={APP_URL}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-dark-300 hover:bg-dark-800/50 hover:text-white transition-all duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="font-medium">Gå til appen</span>
              <svg className="w-4 h-4 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}
    </>
  );
}
