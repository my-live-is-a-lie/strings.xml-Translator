import { getStoredItem, setStoredItem } from './storage';

// The string each project was left on, so reopening the app continues from there.
const KEY = 'app_last_selected';

function readMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(getStoredItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The saved string id of a project, only if it still exists in `validIds`. */
export function getLastSelectedId(projectId: string, validIds: { id: string }[]): string | undefined {
  const id = readMap()[projectId];
  return id && validIds.some((i) => i.id === id) ? id : undefined;
}

export function saveLastSelectedId(projectId: string, itemId: string): void {
  if (!projectId || !itemId) return;
  const map = readMap();
  if (map[projectId] === itemId) return;
  const entries = Object.entries({ ...map, [projectId]: itemId }).slice(-50); // keep it small
  setStoredItem(KEY, JSON.stringify(Object.fromEntries(entries)));
}
