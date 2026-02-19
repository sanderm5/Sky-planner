// ========================================
// HTML ESCAPE UTILITY
// XSS protection - used in all template literals
// ========================================

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
