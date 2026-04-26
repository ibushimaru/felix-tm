/**
 * IndexedDB wrapper for Felix TM.
 * Replaces chrome.storage.local for TM/Glossary/Settings persistence.
 *
 * Schema:
 *   tm               — { id (auto), source, target, context, cmp, targetCmp, sourceLen, refcount }
 *   glossary         — { id (auto), term, translation, notes, cmp }
 *   rules            — { id (auto), source_pattern, target_template, enabled }
 *   settings         — { key, value }
 *   authorized_files — { spreadsheetId, name, authorizedAt }   (v3+)
 *
 * v3 added authorized_files: per-spreadsheet OAuth grants from the
 * Google Picker flow. Felix only allows Sheets API calls against
 * spreadsheets the user explicitly picked, satisfying the drive.file
 * scope's "files the app has been granted access to" semantics.
 */

const DB_NAME = 'FelixTM';
const DB_VERSION = 3;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // TM store with indexes
      if (!db.objectStoreNames.contains('tm')) {
        const tmStore = db.createObjectStore('tm', { keyPath: 'id', autoIncrement: true });
        tmStore.createIndex('cmp', 'cmp', { unique: false });
        tmStore.createIndex('sourceLen', 'sourceLen', { unique: false });
      }

      // Glossary store
      if (!db.objectStoreNames.contains('glossary')) {
        const glossStore = db.createObjectStore('glossary', { keyPath: 'id', autoIncrement: true });
        glossStore.createIndex('cmp', 'cmp', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Rules store (v2) — placement rules with regex
      if (!db.objectStoreNames.contains('rules')) {
        db.createObjectStore('rules', { keyPath: 'id', autoIncrement: true });
      }

      // Authorized files store (v3) — per-spreadsheet OAuth grants
      // from the Google Picker flow. Existence in this store is the
      // gate background.js uses before any Sheets API call.
      if (!db.objectStoreNames.contains('authorized_files')) {
        db.createObjectStore('authorized_files', { keyPath: 'spreadsheetId' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// === TM Operations ===

async function tmGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tm', 'readonly');
    const req = tx.objectStore('tm').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tmSaveAll(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tm', 'readwrite');
    const store = tx.objectStore('tm');
    store.clear();
    for (const entry of entries) {
      // Ensure sourceLen is set for index
      if (entry.cmp && !entry.sourceLen) entry.sourceLen = entry.cmp.length;
      store.put(entry);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function tmAdd(entry) {
  const db = await openDB();
  if (entry.cmp && !entry.sourceLen) entry.sourceLen = entry.cmp.length;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tm', 'readwrite');
    const req = tx.objectStore('tm').add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tmDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tm', 'readwrite');
    const req = tx.objectStore('tm').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function tmCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tm', 'readonly');
    const req = tx.objectStore('tm').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// === Glossary Operations ===

async function glossaryGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('glossary', 'readonly');
    const req = tx.objectStore('glossary').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function glossarySaveAll(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('glossary', 'readwrite');
    const store = tx.objectStore('glossary');
    store.clear();
    for (const entry of entries) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Rules Operations ===

async function rulesGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rules', 'readonly');
    const req = tx.objectStore('rules').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rulesSaveAll(entries) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rules', 'readwrite');
    const store = tx.objectStore('rules');
    store.clear();
    for (const entry of entries) store.put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Settings Operations ===

async function settingsGet() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').getAll();
    req.onsuccess = () => {
      const obj = {};
      for (const r of req.result) obj[r.key] = r.value;
      resolve(obj);
    };
    req.onerror = () => reject(req.error);
  });
}

async function settingsSave(settings) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    for (const [key, value] of Object.entries(settings)) {
      store.put({ key, value });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Authorized Files Operations (v3+) ===
//
// Felix's drive.file scope means the OAuth token can only access
// files the user explicitly granted via Google Picker. We persist
// the granted spreadsheet IDs locally so background.js can refuse
// requests against any spreadsheet not in this list (defense in
// depth on top of Google's own scope enforcement).

async function authorizedFilesGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('authorized_files', 'readonly');
    const req = tx.objectStore('authorized_files').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function authorizedFileAdd(spreadsheetId, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('authorized_files', 'readwrite');
    const req = tx.objectStore('authorized_files').put({
      spreadsheetId,
      name: name || '',
      authorizedAt: Date.now(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function authorizedFileForget(spreadsheetId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('authorized_files', 'readwrite');
    const req = tx.objectStore('authorized_files').delete(spreadsheetId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function authorizedFilesClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('authorized_files', 'readwrite');
    const req = tx.objectStore('authorized_files').clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// === Migration from chrome.storage.local ===

async function migrateFromChromeStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['felixTM', 'felixGlossary', 'felixSettings', '_idbMigrated'], async (data) => {
      if (data._idbMigrated) { resolve(false); return; }

      let migrated = false;

      if (data.felixTM && data.felixTM.length) {
        await tmSaveAll(data.felixTM);
        migrated = true;
        console.log(`[FelixTM] Migrated ${data.felixTM.length} TM entries to IndexedDB`);
      }

      if (data.felixGlossary && data.felixGlossary.length) {
        await glossarySaveAll(data.felixGlossary);
        migrated = true;
        console.log(`[FelixTM] Migrated ${data.felixGlossary.length} glossary entries to IndexedDB`);
      }

      if (data.felixSettings) {
        await settingsSave(data.felixSettings);
        migrated = true;
        console.log('[FelixTM] Migrated settings to IndexedDB');
      }

      // Mark migration done (keep old data as backup for now)
      chrome.storage.local.set({ _idbMigrated: true });
      resolve(migrated);
    });
  });
}
