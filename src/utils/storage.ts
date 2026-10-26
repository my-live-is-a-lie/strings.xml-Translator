import { debugIgnored } from './debug';
// Persistent storage with three layers:
//  1. An in-memory cache, which is what synchronous getters read.
//  2. IndexedDB, which stores project data (no ~5 MB localStorage limit). Writes are debounced.
//  3. localStorage, only for "app_*" keys that index.html reads before React starts, and as a
//     fallback when IndexedDB is unavailable.
// API keys go through a separate vault: they are encrypted with AES-GCM using a non-extractable key
// kept in IndexedDB, so they are not readable as plain text in storage.
import { TranslationProject } from '../types';

const STORAGE_KEY = 'android_strings_translator_project_v1';
const RECENT_PROJECTS_KEY = 'android_strings_translator_recents_v1';

const DB_NAME = 'strings_translator_db';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const SECRET_STORE = 'secrets';
const CRYPTO_STORE = 'crypto';
const MASTER_KEY_ID = 'master';
const WRITE_DELAY_MS = 400;
const APP_PREFIX = 'app_';

const memoryStore = new Map<string, string>();
const pendingWrites = new Map<string, { produce: () => string; timer: ReturnType<typeof setTimeout> }>();
const secretCache = new Map<string, string>();
let lastCopiedClipboardText = '';
let dbRef: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;
let masterKeyPromise: Promise<CryptoKey | null> | null = null;
let vaultReady = false;

// ---------- IndexedDB helpers ----------

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of [KV_STORE, SECRET_STORE, CRYPTO_STORE]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(store: string, key: string, value: unknown): Promise<void> {
  if (!dbRef) return Promise.reject(new Error('IndexedDB unavailable'));
  return new Promise((resolve, reject) => {
    const tx = dbRef!.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function idbDelete(store: string, key: string): Promise<void> {
  if (!dbRef) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = dbRef!.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  if (!dbRef) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const req = dbRef!.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllEntries<T>(store: string): Promise<Array<{ key: string; value: T }>> {
  if (!dbRef) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const out: Array<{ key: string; value: T }> = [];
    const req = dbRef!.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push({ key: String(cursor.key), value: cursor.value as T });
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- Initialization ----------

/**
 * Opens IndexedDB, loads saved data into memory, moves legacy localStorage data over, and decrypts API keys.
 * Call once before rendering. Safe to call more than once.
 */
export function initStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      dbRef = await openDb();
      if (!dbRef) return; // Falls back to localStorage for everything
      await getMasterKey();

      for (const { key, value } of await idbGetAllEntries<string>(KV_STORE)) {
        if (!memoryStore.has(key)) memoryStore.set(key, value);
      }

      // Migrate project data that an older version left in localStorage into IndexedDB
      const legacyKeys: string[] = [];
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key || key.startsWith(APP_PREFIX) || memoryStore.has(key)) continue;
          const value = window.localStorage.getItem(key);
          if (value !== null) {
            memoryStore.set(key, value);
            legacyKeys.push(key);
          }
        }
      } catch (err) {
        debugIgnored('storage', err);
      }
      for (const key of legacyKeys) void persistKv(key, memoryStore.get(key)!);

      for (const { key, value } of await idbGetAllEntries<{ iv: string; data: string }>(SECRET_STORE)) {
        const plain = await decryptSecret(value).catch(() => null);
        if (plain !== null) secretCache.set(key, plain);
      }
    })().catch((err) => {
      console.error('Storage initialization failed; using localStorage only:', err);
    });
  }
  return initPromise;
}

// ---------- Key/value storage ----------

async function persistKv(key: string, value: string): Promise<void> {
  try {
    if (dbRef) {
      await idbPut(KV_STORE, key, value);
      // The value now lives in IndexedDB; drop the localStorage copy to free quota
      if (!key.startsWith(APP_PREFIX)) window.localStorage?.removeItem(key);
      return;
    }
  } catch (err) {
    console.error(`Failed to persist "${key}" to IndexedDB:`, err);
  }
  try {
    window.localStorage?.setItem(key, value);
  } catch (err) {
    debugIgnored('storage', err);
  }
}

function flushKey(key: string): void {
  const entry = pendingWrites.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingWrites.delete(key);
  try {
    const value = entry.produce();
    memoryStore.set(key, value);
    void persistKv(key, value);
  } catch (err) {
    console.error(`Failed to serialize "${key}":`, err);
  }
}

/** Writes all pending debounced values now. Called on page hide so nothing is lost when the tab closes. */
export function flushStoredWrites(): void {
  for (const key of [...pendingWrites.keys()]) flushKey(key);
}

/**
 * Schedules a write; `produce` runs only once, after the last call within `delayMs`, so large objects are
 * serialized once per burst of edits instead of on every keystroke.
 */
export function scheduleStoredWrite(key: string, produce: () => string, delayMs = WRITE_DELAY_MS): void {
  const existing = pendingWrites.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => flushKey(key), delayMs);
  pendingWrites.set(key, { produce, timer });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStoredWrites);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushStoredWrites();
  });
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    // In sandboxed cross-origin iframes, accessing window.localStorage throws SecurityError
    const storage = window.localStorage;
    if (!storage) return null;
    const probe = '__ls_probe__';
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function getStoredItem(key: string): string | null {
  if (pendingWrites.has(key)) flushKey(key);
  if (memoryStore.has(key)) return memoryStore.get(key) ?? null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val;
    }
  } catch (err) {
    debugIgnored('storage', err);
  }
  return null;
}

export function setStoredItem(key: string, value: string): void {
  if (pendingWrites.has(key)) pendingWrites.delete(key);
  memoryStore.set(key, value);
  if (key.startsWith(APP_PREFIX)) {
    try {
      window.localStorage?.setItem(key, value);
    } catch (err) {
      debugIgnored('storage', err);
    }
    return;
  }
  void persistKv(key, value);
}

export function removeStoredItem(key: string): void {
  pendingWrites.delete(key);
  memoryStore.delete(key);
  try {
    getSafeLocalStorage()?.removeItem(key);
  } catch (err) {
    debugIgnored('storage', err);
  }
  void idbDelete(KV_STORE, key).catch(() => undefined);
}

// ---------- API key vault (encrypted at rest) ----------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function getMasterKey(): Promise<CryptoKey | null> {
  if (!masterKeyPromise) {
    masterKeyPromise = (async () => {
      if (!globalThis.crypto?.subtle || !dbRef) return null;
      const existing = await idbGet<CryptoKey>(CRYPTO_STORE, MASTER_KEY_ID);
      if (existing) return existing;
      // extractable: false means script can use the key but cannot read its raw bytes
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idbPut(CRYPTO_STORE, MASTER_KEY_ID, key);
      return key;
    })()
      .then((key) => {
        vaultReady = key !== null;
        return key;
      })
      .catch(() => null);
  }
  return masterKeyPromise;
}

/** True once API keys can be stored encrypted (secure context with IndexedDB, after initStorage). */
export function isSecretVaultReady(): boolean {
  return vaultReady;
}

async function encryptSecret(plain: string): Promise<{ iv: string; data: string }> {
  const key = await getMasterKey();
  if (!key) throw new Error('Encryption unavailable');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptSecret(record: { iv: string; data: string }): Promise<string> {
  const key = await getMasterKey();
  if (!key) throw new Error('Encryption unavailable');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.data)
  );
  return new TextDecoder().decode(plain);
}

export function getSecret(id: string): string | undefined {
  return secretCache.get(id);
}

export function setSecret(id: string, value: string): void {
  if (secretCache.get(id) === value) return;
  secretCache.set(id, value);
  void (async () => {
    try {
      await idbPut(SECRET_STORE, id, await encryptSecret(value));
    } catch (err) {
      console.error('Failed to store encrypted API key:', err);
    }
  })();
}

export function deleteSecret(id: string): void {
  secretCache.delete(id);
  void idbDelete(SECRET_STORE, id).catch(() => undefined);
}

// ---------- Clipboard ----------

export async function copyTextToClipboard(text: string): Promise<boolean> {
  lastCopiedClipboardText = text;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    debugIgnored('storage', err);
  }

  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export async function readTextFromClipboard(): Promise<string | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (typeof text === 'string') {
        lastCopiedClipboardText = text;
        return text;
      }
    }
  } catch (err) {
    debugIgnored('storage', err);
  }
  return lastCopiedClipboardText || null;
}

// ---------- Projects ----------

export function saveCurrentProject(project: TranslationProject): void {
  scheduleStoredWrite(STORAGE_KEY, () => JSON.stringify(project));
  updateRecentProjectsList({
    id: project.id,
    name: project.name,
    sourceFileName: project.sourceFileName,
    targetLang: project.targetLang,
    itemCount: project.items.length,
    lastModified: project.lastModified,
  });
}

export function loadCurrentProject(): TranslationProject | null {
  try {
    const raw = getStoredItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TranslationProject;
  } catch {
    return null;
  }
}

export function clearCurrentProject(): void {
  pendingWrites.delete(STORAGE_KEY);
  removeStoredItem(STORAGE_KEY);
}

export interface ProjectMetadata {
  id: string;
  name: string;
  sourceFileName: string;
  targetLang: string;
  itemCount: number;
  lastModified: number;
}

export function getRecentProjects(): ProjectMetadata[] {
  try {
    const raw = getStoredItem(RECENT_PROJECTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ProjectMetadata[];
  } catch {
    return [];
  }
}

function updateRecentProjectsList(meta: ProjectMetadata): void {
  try {
    const list = getRecentProjects().filter((p) => p.id !== meta.id);
    list.unshift(meta);
    setStoredItem(RECENT_PROJECTS_KEY, JSON.stringify(list.slice(0, 5)));
  } catch (err) {
    debugIgnored('storage', err);
  }
}
