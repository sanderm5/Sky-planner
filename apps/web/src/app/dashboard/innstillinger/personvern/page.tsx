import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { PersonvernSettings } from '@/components/dashboard-pages/PersonvernSettings';

export const metadata = { title: 'Personvern' };

export default async function PersonvernPage() {
  const { isAdmin } = await requireAuth();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">Personvern og databehandling.</p>
      </div>

      <SettingsNav />

      <PersonvernSettings
        isCurrentUserAdmin={isAdmin}
      />
    </>
  );
}
