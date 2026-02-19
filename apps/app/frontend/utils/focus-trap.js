// ========================================
// FOCUS TRAP - Tilgjengelighet for modaler
// Fanger Tab-navigasjon innenfor en container
// og returnerer fokus til utløser-element ved lukking
// ========================================

const FocusTrap = {
  _previouslyFocused: null,

  _getFocusable(container) {
    return [...container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);
  },

  activate(containerEl) {
    this._previouslyFocused = document.activeElement;

    const focusable = this._getFocusable(containerEl);
    if (focusable.length > 0) {
      setTimeout(() => focusable[0].focus(), 50);
    }

    containerEl._trapHandler = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = this._getFocusable(containerEl);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    containerEl.addEventListener('keydown', containerEl._trapHandler);
  },

  deactivate(containerEl) {
    if (containerEl && containerEl._trapHandler) {
      containerEl.removeEventListener('keydown', containerEl._trapHandler);
      delete containerEl._trapHandler;
    }
    if (this._previouslyFocused && this._previouslyFocused.focus) {
      this._previouslyFocused.focus();
      this._previouslyFocused = null;
    }
  }
};
