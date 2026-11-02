import { useSyncExternalStore } from 'react';
import { getStoredItem, setStoredItem } from '../utils/storage';
import { ALL_STRINGS as UI_STRINGS } from './allStrings';

export type CustomLanguage = { code: string; label: string; rtl: boolean; strings: Record<string, string> };

const CUSTOM_KEY = 'app_custom_languages';

let custom: CustomLanguage[] = (() => {
  try {
    const raw = JSON.parse(getStoredItem(CUSTOM_KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as CustomLanguage[]) : [];
  } catch {
    return [];
  }
})();
let activeCode = 'ar';
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export const getCustomLanguages = (): CustomLanguage[] => custom;
export const findCustomLanguage = (code: string) => custom.find((l) => l.code === code);
export const isRtlLanguageCode = (code: string): boolean =>
  code === 'ar' ? true : code === 'en' ? false : !!findCustomLanguage(code)?.rtl;

function saveCustom() {
  setStoredItem(CUSTOM_KEY, JSON.stringify(custom));
  emit();
}
export function addCustomLanguage(lang: Omit<CustomLanguage, 'code'>): CustomLanguage {
  const code = 'x' + Date.now().toString(36);
  const entry = { ...lang, code };
  custom = [...custom, entry];
  saveCustom();
  return entry;
}
export function removeCustomLanguage(code: string) {
  custom = custom.filter((l) => l.code !== code);
  saveCustom();
}
export function setActiveLanguage(code: string) {
  if (code === activeCode) return;
  activeCode = code;
  emit();
}

function format(s: string, args: unknown[]): string {
  return args.length ? s.replace(/%(\d+)\$s/g, (_, n) => String(args[Number(n) - 1] ?? '')) : s;
}

function resolve(key: string, button: boolean): string {
  const entry = UI_STRINGS[key];
  if (!entry) return key;
  if (activeCode === 'ar') return entry.ar;
  if (activeCode === 'en') return entry.en;
  const value = findCustomLanguage(activeCode)?.strings[key];
  if (value === undefined) return entry.en; // key missing: English
  if (value === '' && button) return entry.en; // text-only button: never blank
  return value; // '' elsewhere: hidden through [data-i18n]:empty
}

/** Translate outside React (re-evaluated whenever the component using it re-renders). */
export const tg = (key: string, ...args: unknown[]): string => format(resolve(key, false), args);
export const tgb = (key: string, ...args: unknown[]): string => format(resolve(key, true), args);

export function useT() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
  return { t: tg, tb: tgb, lang: activeCode };
}

export function useCustomLanguages(): CustomLanguage[] {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
  return custom;
}
