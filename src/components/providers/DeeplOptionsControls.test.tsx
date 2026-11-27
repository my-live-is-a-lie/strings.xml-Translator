// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProvidersPanel } from '../ProvidersPanel';
import {
  addCustomProvider,
  getCustomProviders,
  removeCustomProvider,
  setActiveProviderId,
} from '../../utils/translator';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const radios = (groupId: string) => Array.from(byId(groupId)!.querySelectorAll<HTMLElement>('[role="radio"]'));
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const saved = () => getCustomProviders().find((p) => p.type === 'deepl')!.deeplOptions;

function render(targetLang = 'de') {
  act(() => {
    root = createRoot(container);
    root.render(<ProvidersPanel isAr targetLang={targetLang} onChanged={() => {}} />);
  });
}

beforeEach(() => {
  localStorage.clear();
  for (const p of getCustomProviders()) removeCustomProvider(p.id);
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('DeepL options on the provider card', () => {
  it('shows only for a DeepL provider', () => {
    const other = addCustomProvider({ name: 'OpenAI', type: 'openai', apiKey: 'sk-x' });
    setActiveProviderId(other.id);
    render();
    expect(byId('active-deepl-options')).toBeNull();
    act(() => root.unmount());
    const deepl = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(deepl.id);
    render();
    expect(byId('active-deepl-options')).not.toBeNull();
  });

  it('starts on the default and stores each choice on the provider', () => {
    const deepl = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(deepl.id);
    render();
    expect(saved()).toBeUndefined();
    expect(radios('active-deepl-formality')[0].getAttribute('aria-checked')).toBe('true');

    click(radios('active-deepl-formality')[1]); // رسمي
    click(radios('active-deepl-model-type')[2]); // الجودة
    click(radios('active-deepl-split-sentences')[1]); // إيقاف
    click(byId('active-deepl-preserve-formatting')!);
    expect(saved()).toEqual({
      formality: 'more',
      modelType: 'quality_optimized',
      splitSentences: '0',
      preserveFormatting: true,
    });
    expect(radios('active-deepl-formality')[1].getAttribute('aria-checked')).toBe('true');

    // Back to the default removes the option instead of storing "default".
    click(radios('active-deepl-formality')[0]);
    expect(saved()).not.toHaveProperty('formality');
  });

  it('saves the context when the field loses focus and clears it when emptied', () => {
    const deepl = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(deepl.id);
    render();
    const area = byId('active-deepl-context') as HTMLTextAreaElement;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    const type = (v: string) =>
      act(() => {
        set.call(area, v);
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const blur = () =>
      act(() => {
        area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
    type('Button on the settings screen');
    expect(saved()).toBeUndefined();
    blur();
    expect(saved()).toEqual({ context: 'Button on the settings screen' });
    type('');
    blur();
    expect(saved()).toBeUndefined();
  });

  it('hides the formality choice when DeepL has no formality for the target language', () => {
    const deepl = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(deepl.id);
    render('ar');
    expect(byId('active-deepl-formality')).toBeNull();
    expect(byId('active-deepl-model-type')).not.toBeNull();
    act(() => root.unmount());
    render('de');
    expect(byId('active-deepl-formality')).not.toBeNull();
    act(() => root.unmount());
    render('pt-rBR');
    expect(byId('active-deepl-formality')).not.toBeNull();
  });
});

describe('DeepL context draft', () => {
  it('is saved when the panel closes while the field is still focused', () => {
    const deepl = addCustomProvider({ name: 'DeepL', type: 'deepl', apiKey: 'k:fx' });
    setActiveProviderId(deepl.id);
    render();
    const area = byId('active-deepl-context') as HTMLTextAreaElement;
    area.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      set.call(area, 'Button on the settings screen');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saved()).toBeUndefined();
    act(() => root.unmount());
    expect(saved()).toEqual({ context: 'Button on the settings screen' });
    // afterEach unmounts again
    root = createRoot(document.createElement('div'));
  });
});
