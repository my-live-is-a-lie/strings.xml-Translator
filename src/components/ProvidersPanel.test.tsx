// @vitest-environment jsdom
// Pins how the providers panel behaves today, before it is split into smaller pieces.
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderTestResult } from '../utils/translator';

const testProviderApiKey = vi.hoisted(() => vi.fn());

vi.mock('../utils/translator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/translator')>();
  return { ...actual, testProviderApiKey };
});

import { ProvidersPanel } from './ProvidersPanel';
import { addCustomProvider, getCustomProviders, removeCustomProvider } from '../utils/translator';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The panel renders in the app's default language (Arabic); these are the strings it shows.
const TXT = {
  expired: 'انتهت صلاحية مفتاح API',
  invalid: 'مفتاح API غير صالح أو معطّل',
  quotaOrLimit: 'انتهت حصة الرصيد أو تم تجاوز حد الاستخدام',
  quotaExhausted: 'انتهت حصة أو رصيد هذا المفتاح',
  unreachable: 'تعذّر الوصول إلى المزود - تحقق من الاتصال',
  providerError: 'المزود غير متاح الآن - حاول لاحقاً',
  rejected: 'المزود رفض هذا المفتاح',
};

let container: HTMLDivElement;
let root: Root;
let onChanged: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  // The storage layer keeps an in-memory copy, so clearing localStorage alone is not enough.
  for (const p of getCustomProviders()) removeCustomProvider(p.id);
  testProviderApiKey.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  onChanged = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function renderPanel() {
  act(() => {
    root = createRoot(container);
    root.render(<ProvidersPanel isAr onChanged={onChanged} />);
  });
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function click(el: Element | null) {
  expect(el).not.toBeNull();
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function typeInto(el: HTMLInputElement | null, value: string) {
  expect(el).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openAddForm() {
  click(byId('drawer-translate-providers-btn'));
  click(byId('drawer-toggle-add-apikey-btn'));
}

/** Fills the add form with a DeepL provider and presses "verify". */
async function submitAddForm(key = 'secret-key-1') {
  typeInto(byId<HTMLInputElement>('provider-custom-name-input'), 'DeepL');
  typeInto(byId<HTMLInputElement>('provider-api-key-input'), key);
  await act(async () => {
    byId('provider-verify-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const text = () => container.textContent ?? '';

describe('ProvidersPanel: how a failed key test is worded', () => {
  const cases: Array<[string, Partial<ProviderTestResult>, string]> = [
    ['expired-key', { errorKind: 'expired-key' }, TXT.expired],
    ['invalid-key', { errorKind: 'invalid-key' }, TXT.invalid],
    ['quota-exhausted', { errorKind: 'quota-exhausted' }, TXT.quotaExhausted],
    ['quota-or-limit', { errorKind: 'quota-or-limit' }, TXT.quotaOrLimit],
    ['unreachable', { errorKind: 'unreachable' }, TXT.unreachable],
    ['provider-error', { errorKind: 'provider-error' }, TXT.providerError],
    // "unknown" is a category, so the raw message stays hidden behind the generic line.
    ['unknown', { errorKind: 'unknown' }, TXT.rejected],
  ];

  it.each(cases)('errorKind %s shows the app copy, not the raw message', async (_name, partial, expected) => {
    testProviderApiKey.mockResolvedValue({
      success: false,
      matched: false,
      error: 'RAW-SERVER-MESSAGE',
      ...partial,
    } as ProviderTestResult);
    renderPanel();
    openAddForm();
    await submitAddForm();
    expect(text()).toContain(expected);
    expect(text()).not.toContain('RAW-SERVER-MESSAGE');
  });

  it('a provider that sets no errorKind shows what the server actually said', async () => {
    testProviderApiKey.mockResolvedValue({ success: false, matched: false, error: 'HTTP 403 from DeepL' });
    renderPanel();
    openAddForm();
    await submitAddForm();
    expect(text()).toContain('HTTP 403 from DeepL');
    expect(text()).not.toContain(TXT.rejected);
  });

  it('a failed result with no error text shows the failure header and no detail line', async () => {
    testProviderApiKey.mockResolvedValue({ success: false, matched: false });
    renderPanel();
    openAddForm();
    await submitAddForm();
    expect(text()).not.toContain(TXT.rejected);
    expect(getCustomProviders()).toHaveLength(0);
  });
});

describe('ProvidersPanel: adding a provider', () => {
  it('sends the typed engine and key, and saves the provider only after a matched result', async () => {
    testProviderApiKey.mockResolvedValue({ success: true, matched: true, detectedType: 'deepl' });
    renderPanel();
    openAddForm();
    await submitAddForm('my-deepl-key');
    expect(testProviderApiKey).toHaveBeenCalledTimes(1);
    expect(testProviderApiKey.mock.calls[0][0]).toBe('deepl');
    expect(testProviderApiKey.mock.calls[0][1]).toBe('my-deepl-key');
    const saved = getCustomProviders();
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('deepl');
    expect(saved[0].name).toBe('DeepL');
    expect(saved[0].apiKey).toBe('my-deepl-key');
    expect(onChanged).toHaveBeenCalled();
    // The form is cleared after a successful add.
    expect(byId<HTMLInputElement>('provider-api-key-input')!.value).toBe('');
  });

  it('does not save a provider when the result is not matched', async () => {
    testProviderApiKey.mockResolvedValue({ success: true, matched: false, error: 'x' });
    renderPanel();
    openAddForm();
    await submitAddForm();
    expect(getCustomProviders()).toHaveLength(0);
  });

  it('the verify button stays disabled until a key is typed', () => {
    renderPanel();
    openAddForm();
    expect(byId<HTMLButtonElement>('provider-verify-add-btn')!.disabled).toBe(true);
    typeInto(byId<HTMLInputElement>('provider-api-key-input'), 'k');
    expect(byId<HTMLButtonElement>('provider-verify-add-btn')!.disabled).toBe(false);
  });
});

describe('ProvidersPanel: cancelling a key test in the add form', () => {
  /** A test call that stays open until the test settles it, and records the abort signal it was given. */
  function pendingTest() {
    let settle!: (r: ProviderTestResult) => void;
    let signal: AbortSignal | undefined;
    testProviderApiKey.mockImplementation(
      (_engine: string, _key: string, _folder?: string, s?: AbortSignal) =>
        new Promise<ProviderTestResult>((resolve) => {
          signal = s;
          settle = resolve;
        })
    );
    return { settle: (r: ProviderTestResult) => settle(r), signal: () => signal };
  }

  it('the cancel button aborts the request, returns the form to idle and hides a late result', async () => {
    const pending = pendingTest();
    renderPanel();
    openAddForm();
    typeInto(byId<HTMLInputElement>('provider-custom-name-input'), 'DeepL');
    typeInto(byId<HTMLInputElement>('provider-api-key-input'), 'k1');
    act(() => {
      byId('provider-verify-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(byId('provider-verify-cancel-btn')).not.toBeNull();
    expect(pending.signal()?.aborted).toBe(false);

    click(byId('provider-verify-cancel-btn'));
    expect(pending.signal()?.aborted).toBe(true);
    expect(byId('provider-verify-cancel-btn')).toBeNull();

    // The request still finishes in the background; its result must not be shown or saved.
    await act(async () => {
      pending.settle({ success: true, matched: true, detectedType: 'deepl' });
    });
    expect(getCustomProviders()).toHaveLength(0);
    expect(text()).not.toContain(TXT.rejected);
  });

  it('typing in the key field while a test runs cancels it', () => {
    const pending = pendingTest();
    renderPanel();
    openAddForm();
    typeInto(byId<HTMLInputElement>('provider-custom-name-input'), 'DeepL');
    typeInto(byId<HTMLInputElement>('provider-api-key-input'), 'k1');
    act(() => {
      byId('provider-verify-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    typeInto(byId<HTMLInputElement>('provider-api-key-input'), 'k12');
    expect(pending.signal()?.aborted).toBe(true);
    expect(byId('provider-verify-cancel-btn')).toBeNull();
  });
});

describe('ProvidersPanel: editing and deleting a saved provider', () => {
  const saved = () =>
    addCustomProvider({ name: 'DeepL API', type: 'deepl', apiKey: 'old-key' });

  it('a changed key is verified on its own after a short pause, and cancelling aborts that request', async () => {
    vi.useFakeTimers();
    saved();
    let signal: AbortSignal | undefined;
    testProviderApiKey.mockImplementation(
      (_e: string, _k: string, _f?: string, s?: AbortSignal) =>
        new Promise<ProviderTestResult>(() => {
          signal = s;
        })
    );
    renderPanel();
    click(byId('drawer-translate-providers-btn'));
    click(document.querySelector('[aria-label="Edit DeepL API"]'));
    const keyInput = document.querySelector<HTMLInputElement>('input[data-1p-ignore]');
    expect(keyInput?.value).toBe('old-key');

    typeInto(keyInput, 'new-key');
    expect(testProviderApiKey).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(testProviderApiKey).toHaveBeenCalledTimes(1);
    expect(testProviderApiKey.mock.calls[0][1]).toBe('new-key');
    expect(signal?.aborted).toBe(false);

    // The form's own cancel button (the last "إلغاء") closes the form and aborts the request.
    const cancelButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'إلغاء');
    expect(cancelButtons.length).toBeGreaterThan(0);
    click(cancelButtons[cancelButtons.length - 1]);
    expect(signal?.aborted).toBe(true);
    expect(document.querySelector('input[data-1p-ignore]')).toBeNull();
    // The saved key is untouched.
    expect(getCustomProviders()[0].apiKey).toBe('old-key');
  });

  it('a failed edit verification shows the same wording as the add form', async () => {
    vi.useFakeTimers();
    saved();
    testProviderApiKey.mockResolvedValue({ success: false, matched: false, error: 'RAW', errorKind: 'invalid-key' });
    renderPanel();
    click(byId('drawer-translate-providers-btn'));
    click(document.querySelector('[aria-label="Edit DeepL API"]'));
    typeInto(document.querySelector<HTMLInputElement>('input[data-1p-ignore]'), 'new-key');
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(text()).toContain(TXT.invalid);
    expect(text()).not.toContain('RAW');
  });

  it('deleting asks first, then removes the provider and reports the change', () => {
    saved();
    renderPanel();
    click(byId('drawer-translate-providers-btn'));
    click(document.querySelector('[aria-label="Delete DeepL API"]'));
    expect(byId('delete-provider-title')).not.toBeNull();
    expect(getCustomProviders()).toHaveLength(1);
    click(byId('confirm-delete-provider-btn'));
    expect(getCustomProviders()).toHaveLength(0);
    expect(onChanged).toHaveBeenCalled();
  });
});
