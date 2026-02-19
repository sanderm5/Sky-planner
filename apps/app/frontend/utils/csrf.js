// ========================================
// CSRF TOKEN HELPER
// Gets CSRF token from cookie for API requests
// ========================================
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}
