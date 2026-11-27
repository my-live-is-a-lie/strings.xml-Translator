// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCustomProvider,
  cacheKeyFor,
  getCustomProviders,
  removeCustomProvider,
  setActiveProviderId,
  updateCustomProvider,
} from './translator';

beforeEach(() => {
  localStorage.clear();
  for (const p of getCustomProviders()) removeCustomProvider(p.id);
});

const keyFor = () => cacheKeyFor('Save', 'de', undefined);
// The provider part of the key, as it was before DeepL options: id:type:keyHash:folderId
const oldSignature = (id: string, type: string) => new RegExp(`^${id}:${type}:[^:]*:\\u0001de\\u0001\\u0001Save$`);

describe('translation cache key', () => {
  it('keeps the old format for a provider that is not DeepL', () => {
    const p = addCustomProvider({ name: 'OpenAI', type: 'openai', apiKey: 'sk-x' });
    setActiveProviderId(p.id);
    expect(keyFor()).toMatch(oldSignature(p.id, 'openai'));
  });

  it('keeps the old format for DeepL without options', () => {
    const p = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(p.id);
    expect(keyFor()).toMatch(oldSignature(p.id, 'deepl'));
  });

  it('differs between formality more and less', () => {
    const p = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(p.id);
    updateCustomProvider(p.id, { deeplOptions: { formality: 'more' } });
    const more = keyFor();
    updateCustomProvider(p.id, { deeplOptions: { formality: 'less' } });
    expect(keyFor()).not.toBe(more);
    expect(more).not.toMatch(oldSignature(p.id, 'deepl'));
  });

  it('returns the original key once all options are cleared', () => {
    const p = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(p.id);
    const original = keyFor();
    updateCustomProvider(p.id, { deeplOptions: { formality: 'more', context: 'Menu' } });
    expect(keyFor()).not.toBe(original);
    updateCustomProvider(p.id, { deeplOptions: {} });
    expect(keyFor()).toBe(original);
  });
});
