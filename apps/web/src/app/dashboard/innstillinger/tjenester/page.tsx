import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { TjenesterManager } from '@/components/dashboard-pages/TjenesterManager';

export const metadata = { title: 'Tjenestekategorier' };

export default async function TjenesterPage() {
  const { isAdmin } = await requireAuth();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">Administrer tjenestekategoriene dine.</p>
      </div>

      <SettingsNav />

      <TjenesterManager isAdmin={isAdmin} />
    </>
  );
}
