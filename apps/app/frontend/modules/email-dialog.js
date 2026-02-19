// ========================================
// EMAIL DIALOG (Feature: email_templates)
// ========================================

let emailDialogState = {
  kundeId: null,
  templates: [],
  selectedTemplateId: null,
};

async function openEmailDialog(kundeId) {
  const customer = customers.find(c => c.id === kundeId);
  if (!customer) {
    showNotification('Kunde ikke funnet', 'error');
    return;
  }

  if (!customer.epost) {
    showNotification('Kunden har ingen e-postadresse', 'error');
    return;
  }

  emailDialogState.kundeId = kundeId;

  // Fetch templates
  try {
    const res = await apiFetch('/api/customer-emails/templates');
    emailDialogState.templates = res.data || [];
  } catch {
    showNotification('Kunne ikke hente e-postmaler', 'error');
    return;
  }

  renderEmailDialog(customer);
}

function renderEmailDialog(customer) {
  // Remove existing dialog
  const existing = document.querySelector('.email-dialog-overlay');
  if (existing) existing.remove();

  const templates = emailDialogState.templates;
  const firstTemplate = templates[0];
  emailDialogState.selectedTemplateId = firstTemplate?.id || null;

  const overlay = document.createElement('div');
  overlay.className = 'email-dialog-overlay';
  overlay.innerHTML = `
    <div class="email-dialog">
      <div class="email-dialog-header">
        <h3><i class="fas fa-envelope"></i> Send e-post</h3>
        <button class="email-dialog-close" onclick="closeEmailDialog()"><i class="fas fa-times"></i></button>
      </div>
      <div class="email-dialog-body">
        <div class="email-dialog-recipient">
          <label>Til:</label>
          <span>${escapeHtml(customer.navn)} &lt;${escapeHtml(customer.epost)}&gt;</span>
        </div>

        <div class="email-dialog-field">
          <label for="emailTemplateSelect">Velg mal:</label>
          <select id="emailTemplateSelect" class="email-dialog-select" onchange="onEmailTemplateChange()">
            ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.category)})</option>`).join('')}
          </select>
        </div>

        <div id="emailCustomFields" class="email-dialog-custom-fields" style="display:none">
          <div class="email-dialog-field">
            <label for="emailCustomSubject">Emne:</label>
            <input id="emailCustomSubject" type="text" class="email-dialog-input" placeholder="Skriv emne...">
          </div>
          <div class="email-dialog-field">
            <label for="emailCustomMessage">Melding:</label>
            <textarea id="emailCustomMessage" class="email-dialog-textarea" rows="4" placeholder="Skriv melding..."></textarea>
          </div>
        </div>

        <div class="email-dialog-preview-section">
          <button class="email-dialog-preview-btn" onclick="previewEmail()">
            <i class="fas fa-eye"></i> Forhåndsvis
          </button>
          <div id="emailPreviewContainer" class="email-preview-container" style="display:none">
            <div class="email-preview-subject" id="emailPreviewSubject"></div>
            <iframe id="emailPreviewFrame" class="email-preview-frame"></iframe>
          </div>
        </div>
      </div>
      <div class="email-dialog-footer">
        <button class="btn btn-secondary" onclick="closeEmailDialog()">Avbryt</button>
        <button class="btn btn-primary email-send-btn" onclick="sendEmailFromDialog()">
          <i class="fas fa-paper-plane"></i> Send e-post
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEmailDialog();
  });

  // Show custom fields for "generell" template
  onEmailTemplateChange();
}

function onEmailTemplateChange() {
  const select = document.getElementById('emailTemplateSelect');
  if (!select) return;
  emailDialogState.selectedTemplateId = Number(select.value);

  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  const customFields = document.getElementById('emailCustomFields');
  if (customFields) {
    customFields.style.display = template?.category === 'generell' ? 'block' : 'none';
  }

  // Hide preview when template changes
  const previewContainer = document.getElementById('emailPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
}

async function previewEmail() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;
  }

  try {
    const res = await apiFetch('/api/customer-emails/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    const previewContainer = document.getElementById('emailPreviewContainer');
    const subjectEl = document.getElementById('emailPreviewSubject');
    const frameEl = document.getElementById('emailPreviewFrame');

    if (previewContainer && subjectEl && frameEl) {
      previewContainer.style.display = 'block';
      subjectEl.textContent = `Emne: ${res.data.subject}`;
      // Write HTML into iframe for safe rendering
      const doc = frameEl.contentDocument || frameEl.contentWindow.document;
      doc.open();
      doc.write(res.data.html);
      doc.close();
    }
  } catch {
    showNotification('Kunne ikke generere forhåndsvisning', 'error');
  }
}

async function sendEmailFromDialog() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const sendBtn = document.querySelector('.email-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sender...';
  }

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;

    if (!customVariables.emne || !customVariables.melding) {
      showNotification('Fyll inn emne og melding', 'error');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send e-post';
      }
      return;
    }
  }

  try {
    await apiFetch('/api/customer-emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    showNotification('E-post sendt!', 'success');
    closeEmailDialog();

    // Refresh customers to update lifecycle colors
    await loadCustomers();
  } catch (err) {
    showNotification(err.message || 'Kunne ikke sende e-post', 'error');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send e-post';
    }
  }
}

function closeEmailDialog() {
  const overlay = document.querySelector('.email-dialog-overlay');
  if (overlay) overlay.remove();
  emailDialogState = { kundeId: null, templates: [], selectedTemplateId: null };
}
