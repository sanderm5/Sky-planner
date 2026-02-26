import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { PersonvernSettings } from '@/components/dashboard-pages/PersonvernSettings';

export const metadata = { title: 'Personvern' };

export default async function PersonvernPage() {
  const { isAdmin } = await requireAuth();

  const appUrl = process.env.APP_API_URL || (process.env.NODE_ENV === 'production'
    ? 'https://skyplannerapp-production.up.railway.app'
    : 'http://localhost:3000');

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">Personvern og databehandling.</p>
      </div>

      <SettingsNav />

      <PersonvernSettings
        isCurrentUserAdmin={isAdmin}
        appUrl={appUrl}
      />
    </>
  );
}
