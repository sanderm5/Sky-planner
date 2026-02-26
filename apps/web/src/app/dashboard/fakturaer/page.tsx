import { requireAuth } from '@/lib/auth';
import { FakturaerManager } from '@/components/dashboard-pages/FakturaerManager';

export const metadata = { title: 'Fakturaer' };

export default async function FakturaerPage() {
  await requireAuth();

  return <FakturaerManager />;
}
