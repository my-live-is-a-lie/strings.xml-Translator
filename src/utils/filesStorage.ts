import { debugIgnored } from './debug';
import { StoredXmlFile, ResourceItem } from '../types';
import { getStoredItem, setStoredItem, removeStoredItem, scheduleStoredWrite } from './storage';

const SAVED_FILES_STORAGE_KEY = 'android_strings_saved_xml_files_v1';
const ACTIVE_FILE_STORAGE_KEY = 'android_strings_active_file_id_v1';

/**
 * Extract app_name string value from resource items if present
 */
export function extractAppNameFromItems(items?: ResourceItem[]): string | undefined {
  if (!items || !Array.isArray(items)) return undefined;

  // Look for exact key name "app_name" or case-insensitive "app_name"
  const item = items.find((i) => i.name && i.name.trim().toLowerCase() === 'app_name');
  if (!item) return undefined;

  if (item.type === 'string') {
    // Prefer source string as the app's original name, or target if source is empty
    const val = (item.source && item.source.trim().length > 0)
      ? item.source.trim()
      : (item.target ? item.target.trim() : '');
    return val.length > 0 ? val : undefined;
  }

  return undefined;
}

/**
 * Checks if current items differ from original imported items in targets or status
 */
export function hasItemsChanged(current: ResourceItem[], original: ResourceItem[]): boolean {
  if (!current || !original) return false;
  if (current.length !== original.length) return true;

  const originalMap = new Map<string, ResourceItem>();
  for (const item of original) {
    originalMap.set(item.id, item);
  }

  for (const currItem of current) {
    const origItem = originalMap.get(currItem.id);
    if (!origItem) return true;

    if (currItem.type !== origItem.type) return true;

    if (currItem.type === 'string' && origItem.type === 'string') {
      if (currItem.target !== origItem.target || currItem.status !== origItem.status) {
        return true;
      }
    } else if (currItem.type === 'plural' && origItem.type === 'plural') {
      if (currItem.status !== origItem.status) return true;
      if (currItem.items.length !== origItem.items.length) return true;
      for (let i = 0; i < currItem.items.length; i++) {
        if (
          currItem.items[i].quantity !== origItem.items[i]?.quantity ||
          currItem.items[i].target !== origItem.items[i]?.target
        ) {
          return true;
        }
      }
    } else if (currItem.type === 'array' && origItem.type === 'array') {
      if (currItem.status !== origItem.status) return true;
      if (currItem.items.length !== origItem.items.length) return true;
      for (let i = 0; i < currItem.items.length; i++) {
        if (
          currItem.items[i].index !== origItem.items[i]?.index ||
          currItem.items[i].target !== origItem.items[i]?.target
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

// Each saved file is split in two: a small metadata entry in the list, and a "body" entry (project,
// original items, raw XML) under its own key. Bodies are rewritten only when they change, so editing one
// file no longer re-serializes every file.
const FILE_BODY_PREFIX = 'android_strings_file_body_v1:';
type FileBody = Pick<StoredXmlFile, 'project' | 'originalItems' | 'originalRawXml'>;
const lastSavedBodies = new Map<string, FileBody>();

/**
 * Retrieve all saved XML files from local storage
 */
export function getStoredFiles(): StoredXmlFile[] {
  try {
    const raw = getStoredItem(SAVED_FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry: Partial<StoredXmlFile>) => {
      // Entries saved by older versions already include their body inline
      let file = entry as StoredXmlFile;
      if (!entry.project) {
        const bodyRaw = entry.id ? getStoredItem(FILE_BODY_PREFIX + entry.id) : null;
        if (bodyRaw) {
          const body = JSON.parse(bodyRaw) as FileBody;
          file = { ...entry, ...body } as StoredXmlFile;
          lastSavedBodies.set(entry.id as string, body);
        }
      }
      if (!file.appName) {
        const appName = extractAppNameFromItems(file.originalItems) || extractAppNameFromItems(file.project?.items);
        if (appName) return { ...file, appName };
      }
      return file;
    });
  } catch (err) {
    console.error('Failed to parse stored XML files:', err);
    return [];
  }
}

/**
 * Persist all saved XML files: the list (metadata only), plus the body of each file that changed.
 */
export function saveStoredFiles(files: StoredXmlFile[]): void {
  try {
    const meta = files.map((f) => {
      const { project, originalItems, originalRawXml, ...rest } = f;
      void project;
      void originalItems;
      void originalRawXml;
      return rest;
    });
    scheduleStoredWrite(SAVED_FILES_STORAGE_KEY, () => JSON.stringify(meta));

    const currentIds = new Set<string>();
    for (const f of files) {
      currentIds.add(f.id);
      const last = lastSavedBodies.get(f.id);
      if (last && last.project === f.project && last.originalItems === f.originalItems && last.originalRawXml === f.originalRawXml) {
        continue; // unchanged since the last save
      }
      const body: FileBody = { project: f.project, originalItems: f.originalItems, originalRawXml: f.originalRawXml };
      lastSavedBodies.set(f.id, body);
      scheduleStoredWrite(FILE_BODY_PREFIX + f.id, () => JSON.stringify(body));
    }

    // Drop bodies of files that were removed
    for (const id of [...lastSavedBodies.keys()]) {
      if (!currentIds.has(id)) {
        lastSavedBodies.delete(id);
        removeStoredItem(FILE_BODY_PREFIX + id);
      }
    }
  } catch (err) {
    console.error('Failed to persist stored XML files:', err);
  }
}

/**
 * Retrieve the active file ID from storage
 */
export function getActiveFileId(): string | null {
  try {
    return getStoredItem(ACTIVE_FILE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the active file ID to storage
 */
export function setActiveFileId(id: string): void {
  try {
    setStoredItem(ACTIVE_FILE_STORAGE_KEY, id);
  } catch (err) {
    debugIgnored('filesStorage', err);
  }
}

/**
 * Upsert a file into the stored files collection
 */
export function upsertStoredFile(file: StoredXmlFile): StoredXmlFile[] {
  const current = getStoredFiles();
  const existingIndex = current.findIndex((f) => f.id === file.id);

  const fileWithAppName = {
    ...file,
    appName: file.appName || extractAppNameFromItems(file.originalItems) || extractAppNameFromItems(file.project?.items),
  };

  let updated: StoredXmlFile[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = fileWithAppName;
  } else {
    updated = [fileWithAppName, ...current];
  }

  saveStoredFiles(updated);
  return updated;
}

/**
 * Delete a file by ID from stored files collection
 */
export function deleteStoredFile(id: string): StoredXmlFile[] {
  const current = getStoredFiles();
  const filtered = current.filter((f) => f.id !== id);
  saveStoredFiles(filtered);
  return filtered;
}

/**
 * Rename a stored file by ID
 */
export function renameStoredFile(id: string, newName: string): StoredXmlFile[] {
  const current = getStoredFiles();
  const updated = current.map((f) => {
    if (f.id === id) {
      return {
        ...f,
        name: newName,
        project: {
          ...f.project,
          name: newName,
          sourceFileName: newName,
        },
      };
    }
    return f;
  });
  saveStoredFiles(updated);
  return updated;
}

/**
 * Reset a stored file to its original unedited state
 */
export function resetStoredFileToOriginal(id: string): { files: StoredXmlFile[]; resetFile?: StoredXmlFile } {
  const current = getStoredFiles();
  let resetFile: StoredXmlFile | undefined;

  const updated = current.map((f) => {
    if (f.id === id) {
      const clonedOriginalItems = JSON.parse(JSON.stringify(f.originalItems)) as ResourceItem[];
      resetFile = {
        ...f,
        lastModified: Date.now(),
        project: {
          ...f.project,
          items: clonedOriginalItems,
          lastModified: Date.now(),
        },
        hasUserEdits: false,
      };
      return resetFile;
    }
    return f;
  });

  saveStoredFiles(updated);
  return { files: updated, resetFile };
}
