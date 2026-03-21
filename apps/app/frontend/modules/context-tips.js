// CONTEXT TIPS - Simplified (guidance toggle only)
// ========================================

// Check if guidance is enabled (global helper used by multiple modules)
function isGuidanceEnabled() {
  return localStorage.getItem('skyplanner_guidanceEnabled') !== 'false';
}

// Stubs — kept for backward compatibility with callers
const contextTips = { tips: [], shownTips: [], currentTipIndex: 0, tipOverlay: null };
function initContextTips() {}
function showContextTips() {}
function showTip() {}
function dismissCurrentTip() {}
function showNextTip() {}
function skipAllTips() {}
function resetContextTips() {}
function markTipAsShown() {}

// Feature tours — stubbed out
function showFeatureTourIfNeeded() {}
function showMiniTour() {}
function showMiniTourTip() {}
function dismissMiniTourTip() {}
function skipMiniTour() {}
function completeMiniTour() {}
function resetFeatureTours() {}
