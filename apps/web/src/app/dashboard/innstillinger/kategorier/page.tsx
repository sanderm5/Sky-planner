import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { KategorierManager } from '@/components/dashboard-pages/KategorierManager';

export const metadata = { title: 'Kategorier' };

export default async function KategorierPage() {
  const { isAdmin } = await requireAuth();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">Administrer underkategorier for dine tjenester.</p>
      </div>

      <SettingsNav />

      <KategorierManager isAdmin={isAdmin} />
    </>
  );
}
