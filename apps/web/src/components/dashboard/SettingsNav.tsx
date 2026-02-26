'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';

const settingsTabs = [
  { href: '/dashboard/innstillinger', label: 'Generelt' },
  { href: '/dashboard/innstillinger/tjenester', label: 'Tjenestekategorier' },
  { href: '/dashboard/innstillinger/kategorier', label: 'Kategorier' },
  { href: '/dashboard/innstillinger/integrasjoner', label: 'Integrasjoner' },
  { href: '/dashboard/innstillinger/api-nokler', label: 'API-nøkler' },
  { href: '/dashboard/innstillinger/webhooks', label: 'Webhooks' },
  { href: '/dashboard/innstillinger/sikkerhet', label: 'Sikkerhet' },
  { href: '/dashboard/innstillinger/personvern', label: 'Personvern' },
];

export function SettingsNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === '/dashboard/innstillinger') {
      return pathname === '/dashboard/innstillinger' || pathname === '/dashboard/innstillinger/';
    }
    return pathname.startsWith(href);
  }

  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {settingsTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={clsx(
            'px-4 py-2 rounded-xl font-medium text-sm transition-colors',
            isActive(tab.href)
              ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
              : 'bg-dark-800/50 text-dark-300 border border-dark-700 hover:bg-dark-700/50 hover:text-white'
          )}
          aria-current={isActive(tab.href) ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
