import type { Metadata } from 'next';
import { Suspense } from 'react';
import VerifyEmailContent from '@/components/auth/VerifyEmailContent';

export const metadata: Metadata = {
  title: 'Bekreft e-post',
};

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}
