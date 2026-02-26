import type { Metadata } from 'next';
import { Suspense } from 'react';
import Verify2FAForm from '@/components/auth/Verify2FAForm';

export const metadata: Metadata = {
  title: 'Tofaktorverifisering',
};

export default function Verify2FAPage() {
  return (
    <Suspense>
      <Verify2FAForm />
    </Suspense>
  );
}
