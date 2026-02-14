/**
 * Sky Planner - Offline Storage (IndexedDB)
 * Provides offline data caching for field workers
 */
const OfflineStorage = {
  db: null,
  DB_NAME: 'skyplanner-offline',
  DB_VERSION: 1,

  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.warn('OfflineStorage: Could not open database');
        resolve(null);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('syncQueue')) {
          const store = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('todaysRoute')) {
          db.createObjectStore('todaysRoute', { keyPath: 'cacheKey' });
        }

        if (!db.objectStoreNames.contains('customers')) {
          const custStore = db.createObjectStore('customers', { keyPath: 'id' });
          custStore.createIndex('organization_id', 'organization_id', { unique: false });
        }

        if (!db.objectStoreNames.contains('routes')) {
          db.createObjectStore('routes', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
    });
  },

  // === Today's Route ===

  async saveTodaysRoute(date, userId, routeData) {
    const db = await this.open();
    if (!db) return;

    const tx = db.transaction('todaysRoute', 'readwrite');
    const store = tx.objectStore('todaysRoute');
    store.put({
      cacheKey: `${date}_${userId}`,
      date,
      userId,
      data: routeData,
      cachedAt: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getTodaysRoute(date, userId) {
    const db = await this.open();
    if (!db) return null;

    const tx = db.transaction('todaysRoute', 'readonly');
    const store = tx.objectStore('todaysRoute');
    const request = store.get(`${date}_${userId}`);

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () => resolve(null);
    });
  },

  // === Customers ===

  async saveCustomers(customerList) {
    const db = await this.open();
    if (!db || !customerList?.length) return;

    const tx = db.transaction('customers', 'readwrite');
    const store = tx.objectStore('customers');

    for (const customer of customerList) {
      store.put(customer);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getCustomer(id) {
    const db = await this.open();
    if (!db) return null;

    const tx = db.transaction('customers', 'readonly');
    const store = tx.objectStore('customers');
    const request = store.get(id);

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  },

  async getAllCustomers() {
    const db = await this.open();
    if (!db) return [];

    const tx = db.transaction('customers', 'readonly');
    const store = tx.objectStore('customers');
    const request = store.getAll();

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  },

  // === Routes ===

  async saveRoutes(routeList) {
    const db = await this.open();
    if (!db || !routeList?.length) return;

    const tx = db.transaction('routes', 'readwrite');
    const store = tx.objectStore('routes');

    for (const route of routeList) {
      store.put(route);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAllRoutes() {
    const db = await this.open();
    if (!db) return [];

    const tx = db.transaction('routes', 'readonly');
    const store = tx.objectStore('routes');
    const request = store.getAll();

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  },

  // === Sync Queue ===

  async queueAction(action) {
    const db = await this.open();
    if (!db) return null;

    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const request = store.add({
      ...action,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async getPendingActions() {
    const db = await this.open();
    if (!db) return [];

    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    const index = store.index('status');
    const request = index.getAll('pending');

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  },

  async getPendingActionCount() {
    const actions = await this.getPendingActions();
    return actions.length;
  },

  async markActionSynced(id) {
    const db = await this.open();
    if (!db) return;

    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    store.delete(id);

    return new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },

  // === Meta ===

  async setMeta(key, value) {
    const db = await this.open();
    if (!db) return;

    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    store.put({ key, value, updatedAt: new Date().toISOString() });

    return new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  },

  async getMeta(key) {
    const db = await this.open();
    if (!db) return null;

    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const request = store.get(key);

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result?.value || null);
      request.onerror = () => resolve(null);
    });
  },

  async getLastSyncTime() {
    return this.getMeta('lastSyncTimestamp');
  },

  async setLastSyncTime() {
    return this.setMeta('lastSyncTimestamp', new Date().toISOString());
  }
};

// Initialize on load
OfflineStorage.open().catch(() => {});

// Make globally available
window.OfflineStorage = OfflineStorage;
