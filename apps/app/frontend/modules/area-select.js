// ========================================

// === AREA SELECT (dra-for-å-velge kunder på kartet) ===
let areaSelectMode = false;
let areaSelectRect = null;
let areaSelectStart = null;

function initAreaSelect() {
  if (!map) return;

  // Legg til flytende knapp over kartet
  const mapContainer = document.getElementById('sharedMapContainer');
  if (!mapContainer) return;
  const existingBtn = document.getElementById('areaSelectToggle');
  if (existingBtn) existingBtn.remove();
  const btn = document.createElement('button');
  btn.id = 'areaSelectToggle';
  btn.className = 'area-select-toggle-btn';
  btn.title = 'Velg område';
  btn.innerHTML = '<i class="fas fa-expand"></i>';
  btn.addEventListener('click', () => toggleAreaSelect());
  mapContainer.appendChild(btn);

  // Mouse events for area selection
  map.on('mousedown', onAreaSelectStart);
  map.on('mousemove', onAreaSelectMove);
  map.on('mouseup', onAreaSelectEnd);
}

function toggleAreaSelect() {
  areaSelectMode = !areaSelectMode;
  const btn = document.getElementById('areaSelectToggle');
  const mapEl = document.getElementById('map');

  if (areaSelectMode) {
    btn?.classList.add('active');
    mapEl.style.cursor = 'crosshair';
    map.dragging.disable();
    showToast('Dra over kunder for å velge dem', 'info');
  } else {
    btn?.classList.remove('active');
    mapEl.style.cursor = '';
    map.dragging.enable();
    if (areaSelectRect) {
      map.removeLayer(areaSelectRect);
      areaSelectRect = null;
    }
  }
}

function onAreaSelectStart(e) {
  if (!areaSelectMode) return;
  areaSelectStart = e.latlng;
  if (areaSelectRect) {
    map.removeLayer(areaSelectRect);
  }
  areaSelectRect = L.rectangle([e.latlng, e.latlng], {
    color: '#3b82f6',
    weight: 2,
    fillOpacity: 0.15,
    dashArray: '6, 4'
  }).addTo(map);
}

function onAreaSelectMove(e) {
  if (!areaSelectMode || !areaSelectStart || !areaSelectRect) return;
  areaSelectRect.setBounds(L.latLngBounds(areaSelectStart, e.latlng));
}

function onAreaSelectEnd(e) {
  if (!areaSelectMode || !areaSelectStart || !areaSelectRect) return;

  const bounds = areaSelectRect.getBounds();
  areaSelectStart = null;

  // Finn kunder innenfor rektangelet
  const selected = customers.filter(c =>
    c.lat && c.lng && bounds.contains(L.latLng(c.lat, c.lng))
  );

  if (selected.length === 0) {
    map.removeLayer(areaSelectRect);
    areaSelectRect = null;
    showToast('Ingen kunder i valgt område', 'info');
    return;
  }

  // Vis handlingsmeny (alltid vis valg)
  showAreaSelectMenu(selected, bounds.getCenter());
}

function showAreaSelectMenu(selectedCustomersList, center) {
  // Fjern eksisterende meny
  document.getElementById('areaSelectMenu')?.remove();

  // Initialize weekplan if not yet (so button is always available)
  if (!weekPlanState.weekStart) {
    initWeekPlanState(new Date());
  }
  const wpDayActive = weekPlanState.activeDay;
  const wpDayLabel = wpDayActive ? weekDayLabels[weekDayKeys.indexOf(wpDayActive)] : '';
  const showWpButton = true;

  // Build weekplan day picker if no active day but tab is open
  let wpDayPickerHtml = '';
  if (showWpButton && !wpDayActive) {
    wpDayPickerHtml = `
      <div class="asm-day-picker" id="asmDayPicker" style="display:none;">
        ${weekDayKeys.map((key, i) => {
          const dayData = weekPlanState.days[key];
          if (!dayData) return '';
          const d = new Date(dayData.date);
          const label = weekDayLabels[i];
          const dateNum = d.getDate();
          return `<button class="asm-day-option" data-wp-day="${key}">${label} ${dateNum}.</button>`;
        }).join('')}
      </div>`;
  }

  // Collect area names for context
  const areas = [...new Set(selectedCustomersList.map(c => c.poststed).filter(Boolean))];
  const areaText = areas.length > 0 ? areas.slice(0, 2).join(', ') : '';

  const menu = document.createElement('div');
  menu.id = 'areaSelectMenu';
  menu.className = 'area-select-menu';
  menu.innerHTML = `
    <div class="area-select-menu-header">
      <div class="asm-title">
        <strong>${selectedCustomersList.length} kunder valgt</strong>
        ${areaText ? `<span class="asm-area">${escapeHtml(areaText)}</span>` : ''}
      </div>
      <button class="area-select-close" id="closeAreaMenu">&times;</button>
    </div>
    <div class="area-select-menu-actions">
      ${showWpButton ? `
        <button class="btn btn-small asm-btn asm-btn-weekplan" id="areaAddToWeekPlan">
          <i class="fas fa-clipboard-list"></i> ${wpDayActive ? `Legg til ${escapeHtml(wpDayLabel)}` : 'Legg til ukeplan'}
        </button>
        ${wpDayPickerHtml}
      ` : ''}
      ${splitViewOpen && splitViewState.activeDay ? `
        <button class="btn btn-small asm-btn asm-btn-calendar" id="areaAddToSplitDay" style="background:var(--color-primary);color:#fff;">
          <i class="fas fa-calendar-plus"></i> Legg til ${new Date(splitViewState.activeDay + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
        </button>
      ` : ''}
      <button class="btn btn-small asm-btn asm-btn-route" id="areaAddToRoute">
        <i class="fas fa-route"></i> Legg til rute
      </button>
      <button class="btn btn-small asm-btn asm-btn-calendar" id="areaAddToCalendar">
        <i class="fas fa-calendar-plus"></i> Legg i kalender
      </button>
      <button class="btn btn-small asm-btn asm-btn-check" id="areaMarkVisited">
        <i class="fas fa-check-circle"></i> Marker besøkt
      </button>
    </div>
  `;

  document.body.appendChild(menu);

  // Legg til ukeplan
  const wpBtn = document.getElementById('areaAddToWeekPlan');
  if (wpBtn) {
    wpBtn.addEventListener('click', () => {
      if (wpDayActive) {
        // Aktiv dag finnes — legg til direkte
        addCustomersToWeekPlan(selectedCustomersList);
        closeAreaSelectMenu();
        renderWeeklyPlan();
      } else {
        // Vis dag-picker
        const picker = document.getElementById('asmDayPicker');
        if (picker) {
          picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
        }
      }
    });

    // Dag-picker knapper
    const dayPicker = document.getElementById('asmDayPicker');
    if (dayPicker) {
      dayPicker.querySelectorAll('.asm-day-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const dayKey = btn.dataset.wpDay;
          weekPlanState.activeDay = dayKey;
          addCustomersToWeekPlan(selectedCustomersList);
          closeAreaSelectMenu();
          renderWeeklyPlan();
        });
      });
    }
  }

  // Legg til split-view aktiv dag — vis varighetssteg
  const splitDayBtn = document.getElementById('areaAddToSplitDay');
  if (splitDayBtn) {
    splitDayBtn.addEventListener('click', () => {
      const dato = splitViewState.activeDay;
      const datoLabel = new Date(dato + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' });
      const actionsDiv = menu.querySelector('.area-select-menu-actions');
      actionsDiv.innerHTML = `
        <div class="asm-duration-step" style="grid-column:1/-1;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Tidsbruk per kunde — ${escapeHtml(datoLabel)}</div>
          <div class="asm-duration-list" style="max-height:240px;overflow-y:auto;">
            ${selectedCustomersList.map((c, i) => {
              const defaultMin = c.estimert_tid || 30;
              return `
                <div class="asm-duration-row" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--color-border);">
                  <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.adresse || '')}">${escapeHtml(c.navn)}</span>
                  <input type="number" class="asm-duration-input" data-index="${i}" value="${defaultMin}" min="5" max="480" step="5"
                    style="width:60px;padding:3px 4px;border-radius:4px;border:1px solid var(--color-border);text-align:center;font-size:12px;background:var(--bg-primary);color:var(--color-text-primary);">
                  <span style="font-size:11px;color:var(--color-text-secondary);">min</span>
                </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="btn btn-small btn-secondary" id="asmDurationBack" style="flex:1;">
              <i class="fas fa-arrow-left"></i> Tilbake
            </button>
            <button class="btn btn-small btn-primary" id="asmDurationConfirm" style="flex:2;">
              <i class="fas fa-calendar-plus"></i> Opprett ${selectedCustomersList.length} avtaler
            </button>
          </div>
        </div>
      `;

      document.getElementById('asmDurationBack').addEventListener('click', () => {
        showAreaSelectMenu(selectedCustomersList, center);
      });

      document.getElementById('asmDurationConfirm').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('asmDurationConfirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Oppretter...';
        const inputs = actionsDiv.querySelectorAll('.asm-duration-input');
        let created = 0;
        for (let i = 0; i < selectedCustomersList.length; i++) {
          const c = selectedCustomersList[i];
          const varighet = inputs[i] ? Number.parseInt(inputs[i].value) || 30 : 30;
          try {
            const avtaleType = c.kategori || 'Kontroll';
            const response = await apiFetch('/api/avtaler', {
              method: 'POST',
              body: JSON.stringify({
                kunde_id: c.id,
                dato,
                type: avtaleType,
                beskrivelse: avtaleType,
                varighet,
                opprettet_av: localStorage.getItem('userName') || 'admin'
              })
            });
            if (response.ok) created++;
          } catch (err) {
            console.error('Error creating avtale from area select:', err);
          }
        }
        if (created > 0) {
          showToast(`${created} avtale${created !== 1 ? 'r' : ''} opprettet for ${datoLabel}`, 'success');
        }
        closeAreaSelectMenu();
        await loadAvtaler();
        renderCalendar();
        if (splitViewOpen) renderSplitWeekContent();
      });
    });
  }

  // Legg til rute
  document.getElementById('areaAddToRoute').addEventListener('click', () => {
    selectedCustomersList.forEach(c => selectedCustomers.add(c.id));
    updateSelectionUI();
    closeAreaSelectMenu();
    showToast(`${selectedCustomersList.length} kunder lagt til rute`, 'success');
  });

  // Legg i kalender - vis datepicker med tidspunkt
  document.getElementById('areaAddToCalendar').addEventListener('click', () => {
    const actionsDiv = menu.querySelector('.area-select-menu-actions');
    actionsDiv.innerHTML = `
      <div style="padding:4px 0;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Dato</label>
        <input type="date" id="areaCalDate" value="${new Date().toISOString().split('T')[0]}"
          style="width:100%;padding:6px;border-radius:4px;border:1px solid #ccc;box-sizing:border-box;">
      </div>
      <div style="padding:4px 0;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Type</label>
        <select id="areaCalType" style="width:100%;padding:6px;border-radius:4px;border:1px solid #ccc;box-sizing:border-box;">
          ${serviceTypeRegistry ? serviceTypeRegistry.renderCategoryOptions('Kontroll') : '<option>Kontroll</option>'}
        </select>
      </div>
      <div style="display:flex;gap:8px;padding-top:4px;">
        <button class="btn btn-small btn-secondary" id="areaCalBack" style="flex:1;">
          <i class="fas fa-arrow-left"></i> Tilbake
        </button>
        <button class="btn btn-small btn-primary" id="areaCalConfirm" style="flex:2;">
          Opprett ${selectedCustomersList.length} avtaler
        </button>
      </div>
    `;

    document.getElementById('areaCalBack').addEventListener('click', () => {
      // Gjenoppbygg opprinnelig meny
      showAreaSelectMenu(selectedCustomersList, center);
    });

    document.getElementById('areaCalConfirm').addEventListener('click', async () => {
      const dato = document.getElementById('areaCalDate').value;
      const type = document.getElementById('areaCalType').value || 'Kontroll';
      if (!dato) {
        showToast('Velg en dato', 'error');
        return;
      }
      const confirmBtn = document.getElementById('areaCalConfirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Oppretter...';
      let created = 0;
      let lastError = '';
      for (const c of selectedCustomersList) {
        try {
          // Bruk kundens kategori som type hvis mulig, ellers valgt type
          const avtaleType = c.kategori || type || undefined;
          const response = await apiFetch('/api/avtaler', {
            method: 'POST',
            body: JSON.stringify({
              kunde_id: c.id,
              dato,
              type: avtaleType,
              beskrivelse: avtaleType || 'Kontroll',
              opprettet_av: localStorage.getItem('userName') || 'admin'
            })
          });
          if (response.ok) {
            created++;
          } else {
            const errData = await response.json().catch(() => ({}));
            lastError = errData.error?.message || errData.error || response.statusText;
            console.error(`Avtale-feil for ${c.navn} (${response.status}):`, errData);
          }
        } catch (err) {
          console.error('Feil ved opprettelse av avtale:', err);
          lastError = err.message;
        }
      }
      if (created > 0) {
        showToast(`${created} avtaler opprettet for ${dato}`, 'success');
      } else {
        showToast(`Kunne ikke opprette avtaler: ${lastError}`, 'error');
      }
      closeAreaSelectMenu();
      // Oppdater kalender
      await loadAvtaler();
      renderCalendar();
    });
  });

  // Marker besøkt (bulk)
  document.getElementById('areaMarkVisited').addEventListener('click', () => {
    const ids = selectedCustomersList.map(c => c.id);
    closeAreaSelectMenu();
    bulkMarkVisited(ids);
  });

  // Lukk
  document.getElementById('closeAreaMenu').addEventListener('click', closeAreaSelectMenu);
}

function closeAreaSelectMenu() {
  document.getElementById('areaSelectMenu')?.remove();
  if (areaSelectRect) {
    map.removeLayer(areaSelectRect);
    areaSelectRect = null;
  }
  if (areaSelectMode) toggleAreaSelect(); // Gå ut av velg-modus kun hvis aktiv
}
