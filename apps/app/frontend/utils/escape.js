// ========================================
// HTML & JS ESCAPE UTILITIES
// XSS protection - used in all template literals
// ========================================

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape a string for safe use inside JavaScript string literals in inline event handlers.
 * Use this instead of escapeHtml() when embedding values in onclick/onchange attributes.
 * Example: onclick="fn('${escapeJsString(userInput)}')"
 */
function escapeJsString(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\//g, '\\/');
}
