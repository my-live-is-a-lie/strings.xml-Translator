import { TranslationProject } from '../types';

const STORAGE_KEY = 'android_strings_translator_project_v1';
const RECENT_PROJECTS_KEY = 'android_strings_translator_recents_v1';

// In-memory fallback for sandboxed iframes or environments where localStorage is restricted
const memoryStore = new Map<string, string>();

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    // In sandboxed cross-origin iframes, accessing window.localStorage or window['localStorage'] throws SecurityError:
    // "Failed to read the 'localStorage' property from 'Window': Access is denied for this document."
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

function getStoredItem(key: string): string | null {
  try {
    const storage = getSafeLocalStorage();
    if (storage) {
      return storage.getItem(key);
    }
  } catch {
    // Ignore and fallback
  }
  return memoryStore.get(key) || null;
}

function setStoredItem(key: string, value: string): void {
  try {
    const storage = getSafeLocalStorage();
    if (storage) {
      storage.setItem(key, value);
      return;
    }
  } catch {
    // Ignore and fallback
  }
  memoryStore.set(key, value);
}

function removeStoredItem(key: string): void {
  try {
    const storage = getSafeLocalStorage();
    if (storage) {
      storage.removeItem(key);
      return;
    }
  } catch {
    // Ignore and fallback
  }
  memoryStore.delete(key);
}

export function saveCurrentProject(project: TranslationProject): void {
  try {
    const serialized = JSON.stringify(project);
    setStoredItem(STORAGE_KEY, serialized);

    updateRecentProjectsList({
      id: project.id,
      name: project.name,
      sourceFileName: project.sourceFileName,
      targetLang: project.targetLang,
      itemCount: project.items.length,
      lastModified: project.lastModified,
    });
  } catch {
    // Silently handle
  }
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
  try {
    removeStoredItem(STORAGE_KEY);
  } catch {
    // Silently handle
  }
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
  } catch {
    // Ignore storage issues
  }
}
