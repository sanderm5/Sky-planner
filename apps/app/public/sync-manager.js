/**
 * Sky Planner - Sync Manager
 * Handles offline action queuing and background sync
 */
const SyncManager = {
  isOnline: navigator.onLine,
  statusListeners: [],
  bannerTimeout: null,

  init() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.updateStatusIndicator();
      this.showBanner('Tilkoblet - synkroniserer...', 'success');
      this.replayPendingActions();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateStatusIndicator();
      this.showBanner('Frakoblet - endringer lagres lokalt', 'warning');
    });

    // Listen for sync-complete from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'sync-complete') {
          this.showBanner('Synkronisering fullført', 'success');
          this.updateSyncBadge();
        }
      });
    }

    // Create status indicator
    this.createStatusIndicator();
    this.createBannerContainer();

    // Check for stale data periodically
    setInterval(() => this.checkStaleness(), 60000);
  },

  // === Offline Action Queue ===

  async queueOfflineAction(action) {
    if (!window.OfflineStorage) return;

    await OfflineStorage.queueAction({
      type: action.type,
      url: action.url,
      method: action.method || 'POST',
      body: action.body || null,
      headers: action.headers || { 'Content-Type': 'application/json' }
    });

    // Request background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('skyplanner-sync');
      } catch (err) {
        // Background sync not available, will retry on online event
      }
    }

    this.updateSyncBadge();
  },

  async replayPendingActions() {
    if (!window.OfflineStorage) return;

    const actions = await OfflineStorage.getPendingActions();
    if (!actions.length) return;

    for (const action of actions) {
      try {
        const response = await fetch(action.url, {
          method: action.method,
          headers: action.headers,
          body: action.body ? JSON.stringify(action.body) : undefined,
          credentials: 'include'
        });

        if (response.ok) {
          await OfflineStorage.markActionSynced(action.id);
        }
      } catch (err) {
        // Still offline, stop retrying
        break;
      }
    }

    this.updateSyncBadge();
    await OfflineStorage.setLastSyncTime();
  },

  // === Status Indicator ===

  createStatusIndicator() {
    // Removed — wifi indicator no longer shown in user bar
  },

  updateStatusIndicator() {
    // Removed — wifi indicator no longer shown in user bar
  },

  // === Banner Notifications ===

  createBannerContainer() {
    if (document.getElementById('syncBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'syncBanner';
    banner.className = 'sync-banner';
    banner.style.display = 'none';
    document.body.appendChild(banner);
  },

  showBanner(message, type) {
    const banner = document.getElementById('syncBanner');
    if (!banner) return;

    banner.textContent = message;
    banner.className = `sync-banner sync-banner-${type}`;
    banner.style.display = 'flex';

    // Auto-dismiss after 4 seconds
    if (this.bannerTimeout) clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.style.display = 'none';
    }, 4000);
  },

  // === Sync Badge ===

  async updateSyncBadge() {
    if (!window.OfflineStorage) return;

    const count = await OfflineStorage.getPendingActionCount();
    const badge = document.getElementById('syncPendingBadge');

    if (count > 0) {
      if (!badge) {
        // Create badge on the Work bottom tab
        const workTab = document.querySelector('.bottom-tab-item[data-bottom-tab="work"]');
        if (workTab) {
          const b = document.createElement('span');
          b.id = 'syncPendingBadge';
          b.className = 'bottom-tab-badge';
          b.style.background = '#eab308'; // Yellow for pending
          b.textContent = count;
          b.title = `${count} endring(er) venter på synkronisering`;
          workTab.appendChild(b);
        }
      } else {
        badge.textContent = count;
        badge.style.display = '';
      }
    } else if (badge) {
      badge.style.display = 'none';
    }
  },

  // === Staleness Check ===

  async checkStaleness() {
    if (!window.OfflineStorage || this.isOnline) return;

    const lastSync = await OfflineStorage.getLastSyncTime();
    if (!lastSync) return;

    const staleness = Date.now() - new Date(lastSync).getTime();
    const minutes = staleness / 60000;

    const existingBanner = document.getElementById('staleDataBanner');

    if (minutes > 240) {
      // > 4 hours - red warning
      this.showStalenessBanner('Dataene kan være utdaterte. Koble til internett for å oppdatere.', 'error');
    } else if (minutes > 30) {
      // > 30 min - yellow warning
      const timeStr = new Date(lastSync).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
      this.showStalenessBanner(`Sist oppdatert: ${timeStr}. Koble til for å oppdatere.`, 'warning');
    } else if (existingBanner) {
      existingBanner.style.display = 'none';
    }
  },

  showStalenessBanner(message, type) {
    let banner = document.getElementById('staleDataBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'staleDataBanner';
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    banner.className = `stale-data-banner stale-data-${type}`;
    banner.style.display = 'flex';
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  SyncManager.init();
});

// Make globally available
window.SyncManager = SyncManager;
