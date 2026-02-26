import { requireAuth } from '@/lib/auth';
import * as db from '@skyplanner/database';
import { initDb } from '@/lib/db';
import { BrukereManager } from '@/components/dashboard-pages/BrukereManager';

export const metadata = { title: 'Brukere' };

export default async function BrukerePage() {
  const { user, organization, isAdmin } = await requireAuth();

  initDb();

  // Fetch users
  const users = await db.getKlienterByOrganization(organization.id);

  // Serialize users for client component
  const serializedUsers = users.map((u: any) => ({
    id: u.id,
    navn: u.navn,
    epost: u.epost,
    telefon: u.telefon || null,
    aktiv: u.aktiv,
    rolle: u.rolle || 'leser',
  }));

  return (
    <BrukereManager
      users={serializedUsers}
      currentUserId={user.id}
      isCurrentUserAdmin={isAdmin}
      maxBrukere={organization.max_brukere}
    />
  );
}
