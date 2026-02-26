// ========================================
// MODAL SYSTEM - Laila-vennlige dialoger
// Erstatter alert() og confirm() med store,
// lettleste norske dialoger
// ========================================

const ModalSystem = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'modal-system-container';
    this.container.innerHTML = `
      <div class="modal-system-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-system-title" style="
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 100000;
        justify-content: center;
        align-items: center;
        padding: 20px;
      ">
        <div class="modal-system-dialog" style="
          background: var(--color-bg-secondary, #1a1a1a);
          border-radius: 16px;
          max-width: 480px;
          width: 100%;
          padding: 32px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          border: 1px solid var(--color-border, #333);
        ">
          <div class="modal-system-icon" style="
            text-align: center;
            margin-bottom: 20px;
            font-size: 48px;
          "></div>
          <h2 class="modal-system-title" id="modal-system-title" style="
            font-size: 22px;
            font-weight: 600;
            color: var(--color-text-primary, #fff);
            margin: 0 0 16px 0;
            text-align: center;
            line-height: 1.4;
          "></h2>
          <p class="modal-system-message" style="
            font-size: 18px;
            color: var(--color-text-secondary, #a0a0a0);
            margin: 0 0 28px 0;
            text-align: center;
            line-height: 1.6;
          "></p>
          <div class="modal-system-buttons" style="
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
          "></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);
  },

  show(options) {
    this.init();
    const overlay = this.container.querySelector('.modal-system-overlay');
    const iconEl = this.container.querySelector('.modal-system-icon');
    const titleEl = this.container.querySelector('.modal-system-title');
    const messageEl = this.container.querySelector('.modal-system-message');
    const buttonsEl = this.container.querySelector('.modal-system-buttons');

    // Set icon based on type
    const icons = {
      success: '<span style="color: #4CAF50;">&#10004;</span>',
      error: '<span style="color: #DC2626;">&#10006;</span>',
      warning: '<span style="color: #FFC107;">&#9888;</span>',
      info: '<span style="color: #42A5F5;">&#8505;</span>',
      confirm: '<span style="color: #5E81AC;">&#63;</span>'
    };
    iconEl.innerHTML = icons[options.type] || icons.info;

    // Set title
    titleEl.textContent = options.title || '';
    titleEl.style.display = options.title ? 'block' : 'none';

    // Set message
    messageEl.textContent = options.message || '';

    // Create buttons
    buttonsEl.innerHTML = '';
    const buttonStyle = `
      min-height: 52px;
      padding: 14px 28px;
      font-size: 18px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 120px;
    `;

    if (options.buttons) {
      options.buttons.forEach((btn, index) => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.style.cssText = buttonStyle;

        if (btn.primary) {
          button.style.background = 'var(--color-accent, #5E81AC)';
          button.style.color = '#fff';
        } else {
          button.style.background = 'var(--color-bg-tertiary, #252525)';
          button.style.color = 'var(--color-text-primary, #fff)';
          button.style.border = '1px solid var(--color-border, #333)';
        }

        button.onclick = () => {
          this.hide();
          if (btn.onClick) btn.onClick();
        };

        // Focus first button for keyboard users
        if (index === 0) {
          setTimeout(() => button.focus(), 100);
        }

        buttonsEl.appendChild(button);
      });
    }

    // Show with animation
    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.2s';
      overlay.style.opacity = '1';
    });

    // Activate focus trap for accessibility
    const dialog = this.container.querySelector('.modal-system-dialog');
    if (dialog && typeof FocusTrap !== 'undefined') {
      FocusTrap.activate(dialog);
    }

    // Close on escape key (store reference for cleanup in hide())
    this._escHandler = (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  },

  hide() {
    // Deactivate focus trap and return focus
    const dialog = this.container?.querySelector('.modal-system-dialog');
    if (dialog && typeof FocusTrap !== 'undefined') {
      FocusTrap.deactivate(dialog);
    }
    // Clean up escape key listener to prevent memory leaks
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    const overlay = this.container?.querySelector('.modal-system-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 200);
    }
  }
};

// Vennlig melding (erstatter alert)
function showMessage(message, type = 'info', title = '') {
  const titles = {
    success: 'Fullfort',
    error: 'Feil',
    warning: 'Advarsel',
    info: 'Informasjon'
  };

  ModalSystem.show({
    type: type,
    title: title || titles[type] || '',
    message: message,
    buttons: [
      { text: 'OK', primary: true }
    ]
  });
}

// Vennlig bekreftelse (erstatter confirm) - returnerer Promise
function showConfirm(message, title = 'Bekreft') {
  return new Promise((resolve) => {
    ModalSystem.show({
      type: 'confirm',
      title: title,
      message: message,
      buttons: [
        {
          text: 'Nei',
          primary: false,
          onClick: () => resolve(false)
        },
        {
          text: 'Ja',
          primary: true,
          onClick: () => resolve(true)
        }
      ]
    });
  });
}

// Toast notification
function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toast
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <i aria-hidden="true" class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Remove after duration (0 = persistent, caller must remove manually)
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return toast;
}
