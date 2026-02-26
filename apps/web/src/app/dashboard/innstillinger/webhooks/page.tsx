import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { WebhooksManager } from '@/components/dashboard-pages/WebhooksManager';

export default async function WebhooksPage() {
  const { isAdmin } = await requireAuth();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">
          Administrer organisasjonsinnstillinger og integrasjoner.
        </p>
      </div>

      <SettingsNav />

      <WebhooksManager isAdmin={isAdmin} />
    </>
  );
}
