/**
 * Client-side utility to read the CSRF token from the __csrf cookie.
 * Use this in Client Components for fetch requests.
 */
export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match?.[1] ?? '';
}
