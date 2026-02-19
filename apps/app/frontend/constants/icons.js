// ========================================
// PREMIUM SVG ICONS FOR INDUSTRIES
// ========================================
/**
 * Premium SVG icons for map markers
 * Each icon is optimized for 42px display with 2px strokes
 * Uses currentColor for white on colored backgrounds
 */
const svgIcons = {
  // El-Kontroll - Lightning bolt with energy
  'el-kontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>`,

  // Brannvarsling - Elegant flame
  'brannvarsling': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
  </svg>`,

  // Borettslag/Sameie - Building with units
  'borettslag-sameie': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2"/>
    <path d="M9 22v-4h6v4"/>
    <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>
  </svg>`,

  // Renhold - Sparkle/clean
  'renhold': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v5m0 8v5M5.5 8.5l3.5 3.5m6 0l3.5-3.5M3 12h5m8 0h5"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>`,

  // Vaktmester - Gear/wrench combo
  'vaktmester': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>`,

  // HVAC/Ventilasjon - Fan with airflow
  'hvac-ventilasjon': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 9a9.5 9.5 0 005-7"/>
    <path d="M15 12a9.5 9.5 0 007 5"/>
    <path d="M12 15a9.5 9.5 0 00-5 7"/>
    <path d="M9 12a9.5 9.5 0 00-7-5"/>
  </svg>`,

  // Heis/Løfteutstyr - Elevator with arrows
  'heis-lofteutstyr': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <path d="M9 8l3-3 3 3"/>
    <path d="M9 16l3 3 3-3"/>
    <line x1="12" y1="5" x2="12" y2="19"/>
  </svg>`,

  // Sikkerhet/Vakt - Shield with checkmark
  'sikkerhet-vakt': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>`,

  // Skadedyrkontroll - Bug with strike
  'skadedyrkontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2l1.88 1.88"/>
    <path d="M14.12 3.88L16 2"/>
    <path d="M9 7.13v-1a3.003 3.003 0 116 0v1"/>
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"/>
    <path d="M12 20v-9"/>
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
    <path d="M6 13H2"/>
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
    <path d="M22 13h-4"/>
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
  </svg>`,

  // VVS/Rørlegger - Pipe with droplet
  'vvs-rorlegger': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 6a4 4 0 01-4-4"/>
    <path d="M6 6a4 4 0 014-4"/>
    <path d="M6 6v6a6 6 0 0012 0V6"/>
    <path d="M12 16v4"/>
    <path d="M8 20h8"/>
    <path d="M12 12a2 2 0 100-4 2 2 0 000 4z"/>
  </svg>`,

  // Takservice - House with roof emphasis
  'takservice': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12l9-9 9 9"/>
    <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10"/>
    <path d="M9 21v-6a2 2 0 012-2h2a2 2 0 012 2v6"/>
  </svg>`,

  // Hagearbeid - Stylized leaf
  'hagearbeid': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 019.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>`,

  // IT-Service - Monitor with code
  'it-service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
    <path d="M8 9l-2 2 2 2"/>
    <path d="M16 9l2 2-2 2"/>
  </svg>`,

  // Vinduspuss - Window with sparkle
  'vinduspuss': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="12" y1="3" x2="12" y2="21"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <path d="M18 6l-3 3"/>
    <path d="M16.5 4.5l1 1"/>
  </svg>`,

  // Avfallshåndtering - Recycle arrows
  'avfallshandtering': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 19H4.815a1.83 1.83 0 01-1.57-.881 1.785 1.785 0 01-.004-1.784L7.196 9.5"/>
    <path d="M11 19h8.203a1.83 1.83 0 001.556-.89 1.784 1.784 0 00-.004-1.775L16.8 9.5"/>
    <path d="M9.5 6.5l1.474-2.381A1.829 1.829 0 0112.54 3a1.78 1.78 0 011.578.885L17 9.5"/>
    <path d="M2.5 14.5L5 12l2.5 2.5"/>
    <path d="M16.5 12L19 14.5 21.5 12"/>
    <path d="M14 6l-2-3.5L10 6"/>
  </svg>`,

  // Vedlikehold Bygg - Hammer
  'vedlikehold-bygg': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 010-3L12 9"/>
    <path d="M17.64 15L22 10.64"/>
    <path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 00-3.94-1.64H9l.92.82A6.18 6.18 0 0112 8.4v1.56l2 2h2.47l2.26 1.91"/>
  </svg>`,

  // Serviceavtaler - Handshake
  'serviceavtaler-generell': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 17a4 4 0 01-8 0v-3a3 3 0 013-3h2"/>
    <path d="M13 17a4 4 0 008 0v-3a3 3 0 00-3-3h-2"/>
    <path d="M11.5 11L9 8.5 11 7l5 4.5"/>
    <path d="M17 8l-5.5 5.5"/>
    <path d="M6 10l1 3"/>
    <path d="M18 10l-1 3"/>
  </svg>`,

  // Generisk service - Wrench (skiftenøkkel)
  'service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>`
};

// ========================================
// PREMIUM COLOR PALETTES FOR INDUSTRIES
// ========================================
/**
 * Premium 3-color gradients for each industry
 * Each palette has: light (highlight), primary, dark (shadow)
 */
const industryPalettes = {
  'el-kontroll':         { light: '#FBBF24', primary: '#F59E0B', dark: '#D97706' },
  'brannvarsling':       { light: '#EF4444', primary: '#DC2626', dark: '#B91C1C' },
  'borettslag-sameie':   { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' },
  'renhold':             { light: '#22D3EE', primary: '#06B6D4', dark: '#0891B2' },
  'vaktmester':          { light: '#FCD34D', primary: '#F59E0B', dark: '#D97706' },
  'hvac-ventilasjon':    { light: '#38BDF8', primary: '#0EA5E9', dark: '#0284C7' },
  'heis-lofteutstyr':    { light: '#818CF8', primary: '#6366F1', dark: '#4F46E5' },
  'sikkerhet-vakt':      { light: '#3B82F6', primary: '#1E40AF', dark: '#1E3A8A' },
  'skadedyrkontroll':    { light: '#A3E635', primary: '#84CC16', dark: '#65A30D' },
  'vvs-rorlegger':       { light: '#22D3EE', primary: '#0891B2', dark: '#0E7490' },
  'takservice':          { light: '#A8A29E', primary: '#78716C', dark: '#57534E' },
  'hagearbeid':          { light: '#4ADE80', primary: '#22C55E', dark: '#16A34A' },
  'it-service':          { light: '#A78BFA', primary: '#8B5CF6', dark: '#7C3AED' },
  'vinduspuss':          { light: '#7DD3FC', primary: '#38BDF8', dark: '#0EA5E9' },
  'avfallshandtering':   { light: '#4ADE80', primary: '#16A34A', dark: '#15803D' },
  'vedlikehold-bygg':    { light: '#B45309', primary: '#92400E', dark: '#78350F' },
  'serviceavtaler-generell': { light: '#C4B5FD', primary: '#A855F7', dark: '#9333EA' },
  'service':                 { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' }
};
