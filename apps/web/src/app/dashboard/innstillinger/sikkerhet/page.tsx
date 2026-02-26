import { requireAuth } from '@/lib/auth';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { SikkerhetManager } from '@/components/dashboard-pages/SikkerhetManager';

export default async function SikkerhetPage() {
  await requireAuth();

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">
          Administrer sikkerhet og tofaktorautentisering.
        </p>
      </div>

      <SettingsNav />

      <SikkerhetManager />
    </>
  );
}
