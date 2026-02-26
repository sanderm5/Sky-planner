// Toggle map legend visibility
function toggleMapLegend() {
  const legend = document.getElementById('mapLegend');
  if (legend) {
    legend.classList.toggle('expanded');
  }
}

// Simple toast notification
// Initialize misc event listeners
function initMiscEventListeners() {
  // Excel/CSV Import functionality
  initExcelImport();

  // Map legend toggle
  const legendToggle = document.getElementById('legendToggle');
  if (legendToggle) {
    legendToggle.addEventListener('click', toggleMapLegend);
  }
}

/**
 * Enhanced Excel/CSV import functionality with wizard UI
 */
function initExcelImport() {
  // State
  const importState = {
    sessionId: null,
    previewData: null,
    columnMapping: {},
    categoryMapping: {},
    currentPage: 0,
    rowsPerPage: 50,
    validCategories: []
  };

  // Elements
  const dropzone = document.getElementById('importDropzone');
  const fileInput = document.getElementById('importFileInput');
  const steps = {
    step1: document.getElementById('importStep1'),
    step2: document.getElementById('importStep2'),
    step3: document.getElementById('importStep3'),
    step4: document.getElementById('importStep4')
  };

  if (!dropzone || !fileInput) return;

  // Step navigation
  function showStep(stepNum) {
    // Hide all steps
    Object.values(steps).forEach(step => {
      if (step) step.classList.add('hidden');
    });

    // Show target step
    const targetStep = steps[`step${stepNum}`];
    if (targetStep) targetStep.classList.remove('hidden');

    // Update step indicator
    document.querySelectorAll('.step-item').forEach(item => {
      const itemStep = parseInt(item.dataset.step);
      item.classList.remove('active', 'completed');
      if (itemStep < stepNum) item.classList.add('completed');
      if (itemStep === stepNum) item.classList.add('active');
    });
  }

  // File selection handlers
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('aria-label', 'Last opp fil. Dra og slipp, eller trykk for å velge fil.');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelect(fileInput.files[0]);
    }
  });

  async function handleFileSelect(file) {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      showNotification('Ugyldig filtype. Kun Excel (.xlsx, .xls) og CSV (.csv) er tillatt.', 'error');
      return;
    }

    // Show loading state
    dropzone.innerHTML = `
      <i aria-hidden="true" class="fas fa-spinner fa-spin"></i>
      <p>Analyserer fil...</p>
      <span class="import-formats">${file.name}</span>
    `;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await apiFetch('/api/kunder/import-excel/preview', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        importState.sessionId = data.sessionId;
        importState.previewData = data;
        importState.validCategories = data.validCategories || [];

        // Initialize column mapping from detected columns
        importState.columnMapping = {};
        data.columns.detected.forEach(col => {
          if (col.suggestedMapping) {
            importState.columnMapping[col.excelHeader] = col.suggestedMapping;
          }
        });

        renderColumnMapping(data);
        showStep(2);
      } else {
        throw new Error(data.error || 'Kunne ikke analysere filen');
      }
    } catch (error) {
      showNotification(error.message, 'error');
      resetDropzone();
    }
  }

  function resetDropzone() {
    dropzone.innerHTML = `
      <i aria-hidden="true" class="fas fa-cloud-upload-alt"></i>
      <p>Dra og slipp fil her, eller klikk for å velge</p>
      <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
    `;
    fileInput.value = '';
  }

  function resetImport() {
    importState.sessionId = null;
    importState.previewData = null;
    importState.columnMapping = {};
    importState.categoryMapping = {};
    importState.currentPage = 0;
    resetDropzone();
    showStep(1);
  }

  // Column mapping UI
  function renderColumnMapping(data) {
    const container = document.getElementById('columnMappingContainer');
    if (!container) return;

    const dbFields = [
      { value: '', label: '-- Ignorer --' },
      { value: 'navn', label: 'Navn *', required: true },
      { value: 'adresse', label: 'Adresse *', required: true },
      { value: 'postnummer', label: 'Postnummer' },
      { value: 'poststed', label: 'Poststed' },
      { value: 'telefon', label: 'Telefon' },
      { value: 'epost', label: 'E-post' },
      { value: 'kategori', label: 'Kategori' },
      { value: 'el_type', label: 'El-type' },
      { value: 'brann_system', label: 'Brannsystem' },
      { value: 'brann_driftstype', label: 'Driftstype' },
      { value: 'notater', label: 'Notater' },
      { value: 'lat', label: 'Breddegrad' },
      { value: 'lng', label: 'Lengdegrad' }
    ];

    container.innerHTML = data.columns.detected.map(col => `
      <div class="mapping-row">
        <div class="mapping-excel">
          <strong>${escapeHtml(col.excelHeader)}</strong>
          <span class="sample-values">${col.sampleValues.map(v => escapeHtml(v)).join(', ') || 'Ingen verdier'}</span>
        </div>
        <i aria-hidden="true" class="fas fa-arrow-right mapping-arrow"></i>
        <div class="mapping-db">
          <select class="column-select" data-excel="${escapeHtml(col.excelHeader)}">
            ${dbFields.map(f => `
              <option value="${f.value}" ${col.suggestedMapping === f.value ? 'selected' : ''}>
                ${f.label}
              </option>
            `).join('')}
          </select>
          ${col.confidence < 1 && col.suggestedMapping ?
            `<span class="confidence-badge">${Math.round(col.confidence * 100)}%</span>` : ''}
        </div>
      </div>
    `).join('');

    // Add change listeners
    container.querySelectorAll('.column-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const excelCol = e.target.dataset.excel;
        importState.columnMapping[excelCol] = e.target.value;
      });
    });
  }

  // Preview table
  function renderPreview(data) {
    const analysis = data.analysis;

    // Update summary cards
    document.getElementById('newCount').textContent = analysis.toCreate || 0;
    document.getElementById('updateCount').textContent = analysis.toUpdate || 0;
    document.getElementById('warningCount').textContent = analysis.warningRows || 0;
    document.getElementById('errorCount').textContent = analysis.errorRows || 0;

    // Update import button count
    const importableCount = (analysis.toCreate || 0) + (analysis.toUpdate || 0);
    document.getElementById('importCountLabel').textContent = importableCount;

    // Render category mapping if needed
    renderCategoryMapping(data.categoryAnalysis);

    // Render dynamic schema suggestions
    renderDynamicSchema(data.dynamicSchema);

    // Render preview table
    renderPreviewTable(data.previewData);
  }

  function renderCategoryMapping(categoryAnalysis) {
    const section = document.getElementById('categoryMappingSection');
    const list = document.getElementById('categoryMappingList');

    if (!categoryAnalysis || categoryAnalysis.unknown.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = categoryAnalysis.unknown.map(item => `
      <div class="category-mapping-row">
        <span class="original-value">"${escapeHtml(item.value)}"</span>
        <span class="occurrence-count">(${item.count} forekomster)</span>
        <select class="category-select" data-original="${escapeHtml(item.value)}">
          <option value="">-- Velg kategori --</option>
          ${importState.validCategories.map(cat => `
            <option value="${cat}">${cat}</option>
          `).join('')}
        </select>
      </div>
    `).join('');

    // Add change listeners
    list.querySelectorAll('.category-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const originalValue = e.target.dataset.original;
        importState.categoryMapping[originalValue] = e.target.value;
      });
    });
  }

  // Render dynamic schema suggestions from Excel analysis
  function renderDynamicSchema(dynamicSchema) {
    const section = document.getElementById('dynamicSchemaSection');
    const newCategoriesSection = document.getElementById('newCategoriesSection');
    const newFieldsSection = document.getElementById('newFieldsSection');
    const newFieldValuesSection = document.getElementById('newFieldValuesSection');

    if (!section || !dynamicSchema) {
      if (section) section.classList.add('hidden');
      return;
    }

    const hasNewCategories = dynamicSchema.newCategories && dynamicSchema.newCategories.length > 0;
    const hasNewFields = dynamicSchema.newFields && dynamicSchema.newFields.length > 0;
    const hasNewFieldValues = dynamicSchema.newFieldValues && Object.keys(dynamicSchema.newFieldValues).length > 0;

    // Hide if nothing to show
    if (!hasNewCategories && !hasNewFields && !hasNewFieldValues) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');

    // Initialize state for tracking selections
    importState.dynamicSchema = {
      selectedCategories: {},
      selectedFields: {},
      selectedFieldValues: {}
    };

    // Render new categories
    if (hasNewCategories) {
      newCategoriesSection.classList.remove('hidden');
      const list = document.getElementById('newCategoriesList');
      list.innerHTML = dynamicSchema.newCategories.map((cat, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newCat_${idx}" data-category="${escapeHtml(cat.name)}" checked>
          <div class="schema-item-color" style="background-color: ${cat.color}"></div>
          <div class="schema-item-icon">
            <i aria-hidden="true" class="fas ${cat.icon}"></i>
          </div>
          <div class="schema-item-info">
            <label for="newCat_${idx}" class="schema-item-name">${escapeHtml(cat.name)}</label>
            <div class="schema-item-meta">Intervall: ${cat.default_interval_months || 12} mnd</div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const catName = checkbox.dataset.category;
        importState.dynamicSchema.selectedCategories[catName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedCategories[catName] = e.target.checked;
        });
      });
    } else {
      newCategoriesSection.classList.add('hidden');
    }

    // Render new fields
    if (hasNewFields) {
      newFieldsSection.classList.remove('hidden');
      const list = document.getElementById('newFieldsList');
      list.innerHTML = dynamicSchema.newFields.map((field, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newField_${idx}" data-field="${escapeHtml(field.field_name)}" checked>
          <div class="schema-item-info">
            <label for="newField_${idx}" class="schema-item-name">${escapeHtml(field.display_name)}</label>
            <div class="schema-item-meta">
              <span class="schema-field-type">${field.field_type}</span>
              ${field.is_filterable ? '<span class="schema-field-type" style="background: #10B981;">Filtrerbart</span>' : ''}
            </div>
            ${field.options && field.options.length > 0 ? `
              <div class="schema-item-preview">
                ${field.options.slice(0, 5).map(opt => `
                  <span class="schema-item-preview-tag">${escapeHtml(opt.value || opt)}</span>
                `).join('')}
                ${field.options.length > 5 ? `<span class="schema-item-preview-tag">+${field.options.length - 5} mer</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFields[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFields[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldsSection.classList.add('hidden');
    }

    // Render new field values
    if (hasNewFieldValues) {
      newFieldValuesSection.classList.remove('hidden');
      const list = document.getElementById('newFieldValuesList');
      const entries = Object.entries(dynamicSchema.newFieldValues);

      list.innerHTML = entries.map(([fieldName, values], idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newValues_${idx}" data-field="${escapeHtml(fieldName)}" checked>
          <div class="schema-item-info">
            <label for="newValues_${idx}" class="schema-item-name">${escapeHtml(fieldName)}</label>
            <div class="schema-item-preview">
              ${values.slice(0, 5).map(v => `
                <span class="schema-item-preview-tag">${escapeHtml(v)}</span>
              `).join('')}
              ${values.length > 5 ? `<span class="schema-item-preview-tag">+${values.length - 5} mer</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFieldValues[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFieldValues[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldValuesSection.classList.add('hidden');
    }
  }

  function renderPreviewTable(rows) {
    const thead = document.getElementById('previewTableHead');
    const tbody = document.getElementById('previewTableBody');

    if (!rows || rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="5">Ingen data</td></tr>';
      return;
    }

    // Headers
    thead.innerHTML = `
      <tr>
        <th>Rad</th>
        <th>Status</th>
        <th>Navn</th>
        <th>Adresse</th>
        <th>Info</th>
      </tr>
    `;

    // Paginate
    const start = importState.currentPage * importState.rowsPerPage;
    const pageRows = rows.slice(start, start + importState.rowsPerPage);

    tbody.innerHTML = pageRows.map(row => {
      const statusClass = {
        'valid': 'status-new',
        'warning': 'status-warning',
        'error': 'status-error',
        'duplicate': 'status-update'
      }[row.status] || '';

      const statusIcon = {
        'valid': '<i aria-hidden="true" class="fas fa-plus-circle"></i>',
        'warning': '<i aria-hidden="true" class="fas fa-exclamation-triangle"></i>',
        'error': '<i aria-hidden="true" class="fas fa-times-circle"></i>',
        'duplicate': '<i aria-hidden="true" class="fas fa-sync-alt"></i>'
      }[row.status] || '';

      const statusText = {
        'valid': 'Ny',
        'warning': 'Advarsel',
        'error': 'Feil',
        'duplicate': 'Oppdateres'
      }[row.status] || row.status;

      return `
        <tr class="${statusClass}">
          <td>${row.rowNumber}</td>
          <td><span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span></td>
          <td>${escapeHtml(row.normalizedData?.navn || '-')}</td>
          <td>${escapeHtml(row.normalizedData?.adresse || '-')}</td>
          <td class="info-cell">
            ${row.issues.length > 0 ?
              `<span class="issues-tooltip" title="${row.issues.map(i => escapeHtml(i)).join('\n')}">
                <i aria-hidden="true" class="fas fa-info-circle"></i> ${row.issues.length} melding${row.issues.length > 1 ? 'er' : ''}
              </span>` : '-'}
          </td>
        </tr>
      `;
    }).join('');

    // Update pagination
    updatePagination(rows.length);
  }

  function updatePagination(totalRows) {
    const totalPages = Math.ceil(totalRows / importState.rowsPerPage);
    const currentPage = importState.currentPage + 1;

    document.getElementById('pageInfo').textContent = `Side ${currentPage} av ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = importState.currentPage === 0;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
  }

  // Pagination handlers
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (importState.currentPage > 0) {
      importState.currentPage--;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    const totalPages = Math.ceil(importState.previewData.previewData.length / importState.rowsPerPage);
    if (importState.currentPage < totalPages - 1) {
      importState.currentPage++;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  // Navigation buttons
  document.getElementById('backToStep1Btn')?.addEventListener('click', resetImport);

  document.getElementById('proceedToStep3Btn')?.addEventListener('click', () => {
    // Validate required mappings
    const hasNavn = Object.values(importState.columnMapping).includes('navn');
    const hasAdresse = Object.values(importState.columnMapping).includes('adresse');

    if (!hasNavn || !hasAdresse) {
      showNotification('Du må mappe minst "Navn" og "Adresse" kolonnene.', 'error');
      return;
    }

    renderPreview(importState.previewData);
    showStep(3);
  });

  document.getElementById('backToStep2Btn')?.addEventListener('click', () => {
    showStep(2);
  });

  // Execute import
  document.getElementById('startImportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('startImportBtn');
    btn.disabled = true;

    showStep(4);
    document.getElementById('importProgress').classList.remove('hidden');
    document.getElementById('importResult').classList.add('hidden');

    const progressFill = document.getElementById('importProgressFill');
    const progressText = document.getElementById('importProgressText');

    progressFill.style.width = '5%';
    progressText.textContent = 'Oppretter nye kategorier og felt...';

    try {
      // First, create selected dynamic schema items
      if (importState.dynamicSchema) {
        const dynamicSchema = importState.previewData?.dynamicSchema;

        // Create selected categories
        const selectedCategories = dynamicSchema?.newCategories?.filter(cat =>
          importState.dynamicSchema.selectedCategories[cat.name]
        ) || [];

        if (selectedCategories.length > 0) {
          progressText.textContent = `Oppretter ${selectedCategories.length} nye kategorier...`;
          for (const cat of selectedCategories) {
            try {
              await apiFetch('/api/service-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: cat.name,
                  icon: cat.icon || 'fa-wrench',
                  color: cat.color || '#5E81AC',
                  default_interval_months: cat.default_interval_months || 12,
                })
              });
            } catch (catError) {
              console.warn(`Could not create category ${cat.name}:`, catError);
            }
          }
          await loadOrganizationCategories();
          renderFilterPanelCategories();
        }

        progressFill.style.width = '10%';

        // Create selected fields
        const selectedFields = dynamicSchema?.newFields?.filter(field =>
          importState.dynamicSchema.selectedFields[field.field_name]
        ) || [];

        if (selectedFields.length > 0) {
          progressText.textContent = `Oppretter ${selectedFields.length} nye felt...`;
          try {
            await apiFetch('/api/fields/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: selectedFields })
            });
          } catch (fieldError) {
            console.warn('Could not create fields:', fieldError);
          }
        }

        progressFill.style.width = '15%';
      }

      progressFill.style.width = '20%';
      progressText.textContent = 'Starter kundeimport...';

      const response = await apiFetch('/api/kunder/import-excel/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: importState.sessionId,
          categoryMapping: importState.categoryMapping,
          geocodeAfterImport: document.getElementById('geocodeAfterImport')?.checked || false
        })
      });

      progressFill.style.width = '90%';
      progressText.textContent = 'Fullfører...';

      const data = await response.json();

      progressFill.style.width = '100%';

      // Show result
      setTimeout(() => {
        document.getElementById('importProgress').classList.add('hidden');
        document.getElementById('importResult').classList.remove('hidden');
        showImportResult(response.ok && data.success, data);

        if (response.ok && data.success) {
          loadCustomers();
        }
      }, 500);

    } catch (error) {
      document.getElementById('importProgress').classList.add('hidden');
      document.getElementById('importResult').classList.remove('hidden');
      showImportResult(false, { error: error.message });
    }

    btn.disabled = false;
  });

  function showImportResult(success, data) {
    const icon = document.getElementById('resultIcon');
    const title = document.getElementById('importResultTitle');

    if (success) {
      icon.innerHTML = '<i aria-hidden="true" class="fas fa-check-circle"></i>';
      icon.className = 'result-icon success';
      title.textContent = 'Import fullført!';

      document.getElementById('resultCreated').textContent = data.created || 0;
      document.getElementById('resultUpdated').textContent = data.updated || 0;
      document.getElementById('resultSkipped').textContent = data.skipped || 0;

      // Show errors if any
      const errorsSection = document.getElementById('resultErrors');
      const errorList = document.getElementById('errorList');
      if (data.errors && data.errors.length > 0) {
        errorsSection.classList.remove('hidden');
        errorList.innerHTML = data.errors.slice(0, 10).map(e =>
          `<li>Rad ${e.row}: ${escapeHtml(e.navn || '')} - ${escapeHtml(e.error)}</li>`
        ).join('');
        if (data.errors.length > 10) {
          errorList.innerHTML += `<li>... og ${data.errors.length - 10} flere</li>`;
        }
      } else {
        errorsSection.classList.add('hidden');
      }

      // Show geocoding note
      const noteEl = document.getElementById('resultNote');
      if (data.geocodingNote) {
        noteEl.textContent = data.geocodingNote;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    } else {
      icon.innerHTML = '<i aria-hidden="true" class="fas fa-times-circle"></i>';
      icon.className = 'result-icon error';
      title.textContent = 'Import feilet';

      document.getElementById('resultCreated').textContent = '0';
      document.getElementById('resultUpdated').textContent = '0';
      document.getElementById('resultSkipped').textContent = '0';

      const noteEl = document.getElementById('resultNote');
      noteEl.textContent = data.error || 'En ukjent feil oppstod.';
      noteEl.classList.remove('hidden');
    }
  }

  // Close result
  document.getElementById('closeImportResultBtn')?.addEventListener('click', resetImport);

  // Helper function
}
