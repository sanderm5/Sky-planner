import { requireAuth } from '@/lib/auth';
import * as db from '@skyplanner/database';
import { initDb } from '@/lib/db';
import { SettingsNav } from '@/components/dashboard/SettingsNav';
import { OrgSettingsForm } from '@/components/dashboard-pages/OrgSettingsForm';

export default async function SettingsPage() {
  const { organization, isAdmin } = await requireAuth();

  initDb();

  const isFullMode = organization.app_mode === 'full';

  let currentIndustry: {
    id: number;
    name: string;
    slug: string;
    icon: string;
    color: string;
    description: string | null;
  } | null = null;

  if ((organization as any).industry_template_id) {
    const supabase = db.getSupabaseClient();
    const { data } = await supabase
      .from('industry_templates')
      .select('id, name, slug, icon, color, description')
      .eq('id', (organization as any).industry_template_id)
      .single();
    currentIndustry = data;
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Innstillinger</h1>
        <p className="text-dark-400">
          Administrer organisasjonsinnstillinger og branding.
        </p>
      </div>

      <SettingsNav />

      <OrgSettingsForm
        organization={organization}
        isAdmin={isAdmin}
        isFullMode={isFullMode}
        currentIndustry={currentIndustry}
      />
    </>
  );
}
