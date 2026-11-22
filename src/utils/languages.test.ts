// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredItem, setStoredItem } from './storage';
import { getCustomTargetLocales, getLanguageOption, normalizeLocaleCode, saveCustomTargetLocales, SUPPORTED_LANGUAGES } from './languages';
const KEY = 'translator_custom_target_locales_v1';
beforeEach(() => setStoredItem(KEY, '[]'));
describe('custom target locales', () => {
  it('normalizes Android prefixes, language case and regional aliases', () => {
    expect(normalizeLocaleCode(' values-ES-mx ')).toBe('es-rMX');
    expect(normalizeLocaleCode('ES-rmx')).toBe('es-rMX');
    expect(normalizeLocaleCode('b+sr+Latn')).toBe('b+sr+Latn');
    expect(normalizeLocaleCode('abc-123')).toBe('abc-r123');
  });
  it('rejects paths, incomplete regions and qualifiers', () => {
    for (const code of ['', '../ar', 'ar-r', 'ar-land', '<ar>']) expect(normalizeLocaleCode(code)).toBe('');
  });
  it('persists, resolves and removes a named custom locale', () => {
    const locale = { code:'es-rMX', name:'Mexican Spanish', nativeName:'Mexican Spanish', androidDir:'values-es-rMX' };
    saveCustomTargetLocales([locale]);
    expect(getCustomTargetLocales()[0].name).toBe('Mexican Spanish');
    expect(getLanguageOption('ES-RMX').name).toBe('Mexican Spanish');
    expect(JSON.parse(getStoredItem(KEY)!)).toHaveLength(1);
    saveCustomTargetLocales([]);
    expect(getCustomTargetLocales()).toEqual([]);
  });
  it('does not mutate built-in language records', () => {
    const ar = getLanguageOption('ar'); ar.name = 'Changed';
    expect(SUPPORTED_LANGUAGES[0].name).toBe('Arabic');
  });
  it('ignores malformed, duplicate and built-in saved records', () => {
    setStoredItem(KEY, JSON.stringify([null, {code:'ar',name:'Override'}, {code:'es-MX',name:'Mexico'}, {code:'es-rMX',name:'Duplicate'}, {code:'xx',name:4}]));
    expect(getCustomTargetLocales().map((l) => l.name)).toEqual(['Mexico']);
    setStoredItem(KEY,'broken'); expect(getCustomTargetLocales()).toEqual([]);
  });
  it('infers RTL from the base language for regional and BCP-47 codes', () => {
    setStoredItem(KEY, JSON.stringify([{code:'ar-rEG',name:'Egyptian Arabic'},{code:'b+he+IL',name:'Hebrew'}]));
    expect(getCustomTargetLocales().every((l) => l.isRtl)).toBe(true);
  });
});
