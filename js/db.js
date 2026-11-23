const DB_NAME = 'anglelab-pwa';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const p = db.createObjectStore('photos', { keyPath: 'id' });
        p.createIndex('sessionId', 'sessionId');
        p.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    let result;
    try { result = fn(t.objectStore(storeName)); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const DB = {
  async createSession(name) {
    const id = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const session = {
      id, name, notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await tx('sessions', 'readwrite', s => s.add(session));
    return session;
  },
  async listSessions() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
      req.onerror = () => reject(req.error);
    });
  },
  async getSession(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async renameSession(id, newName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction('sessions', 'readwrite');
      const s = t.objectStore('sessions');
      const g = s.get(id);
      g.onsuccess = () => {
        const sess = g.result;
        if (!sess) { reject(new Error('Session not found')); return; }
        sess.name = newName; sess.updatedAt = new Date().toISOString();
        s.put(sess);
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  async deleteSession(id) {
    const photos = await this.listPhotos(id);
    await Promise.all(photos.map(p => this.deletePhoto(p.id)));
    return tx('sessions', 'readwrite', s => s.delete(id));
  },
  async addPhoto(photo) {
    const id = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    photo.id = id;
    await tx('photos', 'readwrite', s => s.add(photo));
    return photo;
  },
  async listPhotos(sessionId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const idx = db.transaction('photos', 'readonly').objectStore('photos').index('sessionId');
      const req = idx.getAll(sessionId);
      req.onsuccess = () => resolve(req.result.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')));
      req.onerror = () => reject(req.error);
    });
  },
  async getPhoto(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('photos', 'readonly').objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async deletePhoto(id) { return tx('photos', 'readwrite', s => s.delete(id)); },
  async getSetting(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  },
  async setSetting(key, value) { return tx('settings', 'readwrite', s => s.put({ key, value })); }
};