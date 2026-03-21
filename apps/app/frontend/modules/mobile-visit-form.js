// ============================================
// MOBILE VISIT FORM — Bottom sheet for logging visits
// ============================================

function mfShowVisitForm(kundeId) {
  const kunde = mfRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  // Claim presence while working on this customer
  if (typeof mfClaimCustomer === 'function') mfClaimCustomer(kundeId);

  const address = [kunde.adresse, kunde.poststed].filter(Boolean).join(', ');

  // Remove existing form if any
  const existing = document.querySelector('.mf-visit-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'mf-visit-overlay';
  overlay.innerHTML = `
    <div class="mf-visit-sheet">
      <div class="mf-visit-handle"></div>
      <div class="mf-visit-header">
        <div>
          <h3>${escapeHtml(kunde.navn)}</h3>
          <p>${escapeHtml(address)}</p>
        </div>
        <button class="mf-visit-close" aria-label="Lukk"><i class="fas fa-times" aria-hidden="true"></i></button>
      </div>

      <div class="mf-visit-body">
        <div class="mf-visit-field">
          <label for="mfVisitComment">Notater</label>
          <textarea id="mfVisitComment" rows="3" placeholder="Beskriv arbeidet som ble utf\u00f8rt..."></textarea>
        </div>

        <div class="mf-visit-field">
          <label for="mfVisitMaterials">Materialer brukt</label>
          <textarea id="mfVisitMaterials" rows="2" placeholder="F.eks. kabler, sikringer, sensorer..."></textarea>
        </div>

        <button class="mf-btn mf-btn-navigate mf-visit-nav-btn" data-action="mfNavigate" data-args='[${kunde.id}]'>
          <i class="fas fa-directions" aria-hidden="true"></i> Naviger hit
        </button>
      </div>

      <div class="mf-visit-footer">
        <button class="mf-btn mf-btn-complete mf-visit-submit" id="mfVisitSubmitBtn" data-kunde-id="${kunde.id}">
          <i class="fas fa-check-circle" aria-hidden="true"></i> Marker som fullf\u00f8rt
        </button>
      </div>
    </div>
  `;

  document.getElementById('mobileFieldView').appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('open');
  });

  // Close handlers
  const closeBtn = overlay.querySelector('.mf-visit-close');
  closeBtn.addEventListener('click', () => mfCloseVisitForm(overlay));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) mfCloseVisitForm(overlay);
  });

  // Submit handler
  const submitBtn = overlay.querySelector('#mfVisitSubmitBtn');
  submitBtn.addEventListener('click', () => mfSubmitVisit(kundeId, overlay));

  // Swipe down to close
  let touchStartY = 0;
  const sheet = overlay.querySelector('.mf-visit-sheet');
  sheet.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!touchStartY) return;
    const diff = touchStartY - e.touches[0].clientY;
    if (diff < -60) {
      mfCloseVisitForm(overlay);
      touchStartY = 0;
    }
  }, { passive: true });
}

function mfCloseVisitForm(overlay) {
  // Release presence claim
  const submitBtn = overlay.querySelector('#mfVisitSubmitBtn');
  const kundeId = submitBtn ? parseInt(submitBtn.dataset.kundeId, 10) : null;
  if (kundeId && typeof mfReleaseCustomer === 'function') mfReleaseCustomer(kundeId);

  overlay.classList.remove('open');
  setTimeout(() => overlay.remove(), 300);
}

async function mfSubmitVisit(kundeId, overlay) {
  const comment = document.getElementById('mfVisitComment')?.value?.trim() || '';
  const materialsRaw = document.getElementById('mfVisitMaterials')?.value?.trim() || '';
  const materials = materialsRaw ? materialsRaw.split(',').map(m => m.trim()).filter(Boolean) : [];

  const submitBtn = document.getElementById('mfVisitSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="mf-spinner-small"></div> Lagrer...';
  }

  const payload = {
    rute_id: mfRouteData.id,
    completed: true,
    comment: comment || undefined,
    materials_used: materials.length > 0 ? materials : undefined
  };

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/visit/${kundeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const json = await response.json();

    if (json.success) {
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(200);
      mfShowBanner('Bes\u00f8k registrert!', 'success');
      mfCloseVisitForm(overlay);
      mfLoadRoute();
    } else {
      throw new Error('Server error');
    }
  } catch (err) {
    // Offline: optimistic update + queue
    if (!navigator.onLine && window.SyncManager) {
      // Optimistic UI update
      if (mfRouteData.visits) {
        const existing = mfRouteData.visits.find(v => v.kunde_id === kundeId);
        if (existing) {
          existing.completed = true;
          existing.visited_at = new Date().toISOString();
          existing.comment = comment;
        } else {
          mfRouteData.visits.push({
            kunde_id: kundeId,
            completed: true,
            visited_at: new Date().toISOString(),
            comment: comment
          });
        }
      }
      mfRouteData.completed_count = (mfRouteData.completed_count || 0) + 1;

      // Queue for sync
      await SyncManager.queueOfflineAction({
        type: 'VISIT_CUSTOMER',
        url: `/api/todays-work/visit/${kundeId}`,
        method: 'POST',
        body: payload
      });

      // Update offline cache
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(mfCurrentDate, userId, mfRouteData).catch(() => {});
      }

      if (navigator.vibrate) navigator.vibrate(200);
      mfShowBanner('Bes\u00f8k registrert (synkes n\u00e5r du er online)', 'warning');
      mfCloseVisitForm(overlay);
      mfRenderRoute();
    } else {
      mfShowBanner('Kunne ikke registrere bes\u00f8k', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-check-circle" aria-hidden="true"></i> Marker som fullf\u00f8rt';
      }
    }
  }
}

// Expose globally
window.mfShowVisitForm = mfShowVisitForm;
