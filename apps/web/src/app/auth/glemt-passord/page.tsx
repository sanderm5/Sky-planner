import type { Metadata } from 'next';
import ForgotPasswordForm from '@/components/auth/ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Glemt passord',
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
