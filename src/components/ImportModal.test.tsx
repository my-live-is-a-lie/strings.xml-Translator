// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportModal } from './ImportModal';
import { repairAndroidXml } from '../utils/xmlRepair';

vi.mock('../utils/xmlRepair', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/xmlRepair')>();
  return { ...actual, repairAndroidXml: vi.fn(actual.repairAndroidXml) };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The modal renders in the app's default language (Arabic); these are the strings the buttons carry.
const TAB_PASTE = 'لصق نص XML';
const BTN_START = 'بدء الترجمة';
const BTN_CONTINUE = 'متابعة الاستيراد';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

function renderModal() {
  const onClose = vi.fn();
  const onImportComplete = vi.fn();
  const onLoadSample = vi.fn();
  act(() => {
    root = createRoot(container);
    root.render(
      <ImportModal isOpen onClose={onClose} onImportComplete={onImportComplete} onLoadSample={onLoadSample} />
    );
  });
  return { onClose, onImportComplete, onLoadSample };
}

function buttonWithText(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function hasButton(text: string): boolean {
  return Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.trim() === text);
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function fillProjectName(name: string) {
  const input = container.querySelector<HTMLInputElement>('#import-project-name');
  if (!input) throw new Error('project name input not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pasteXml(xml: string) {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('paste textarea not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, xml);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Every test here exercises the import itself, not the name guard, so give it a valid name.
  fillProjectName('Test App');
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

const CLEAN_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My App</string>
</resources>`;

// A raw apostrophe is a review issue, which is what brings up the Import Report screen.
const XML_WITH_REVIEW_ISSUE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">It's a test</string>
</resources>`;

function openReport() {
  click(buttonWithText(TAB_PASTE));
  pasteXml(XML_WITH_REVIEW_ISSUE);
  click(buttonWithText(BTN_START));
}

describe('ImportModal / Import Report', () => {
  it('shows the report when there is something to review', () => {
    renderModal();
    openReport();
    expect(hasButton(BTN_CONTINUE)).toBe(true);
  });

  it('Escape on the report steps back to the form instead of closing the dialog', () => {
    const { onClose, onImportComplete } = renderModal();
    openReport();
    expect(hasButton(BTN_CONTINUE)).toBe(true);

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
    expect(onImportComplete).not.toHaveBeenCalled();
    // Back on the form: the report's Continue is gone and Start Translating is shown again.
    expect(hasButton(BTN_CONTINUE)).toBe(false);
    expect(hasButton(BTN_START)).toBe(true);
  });

  it('returns focus to Start Translating after Escape from the report', () => {
    renderModal();
    openReport();

    pressEscape();

    expect(document.activeElement).toBe(buttonWithText(BTN_START));
  });

  it('a BOM alone does not show the report and the import completes', () => {
    const { onImportComplete } = renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml('﻿' + CLEAN_XML); // U+FEFF byte order mark
    click(buttonWithText(BTN_START));

    expect(hasButton(BTN_CONTINUE)).toBe(false);
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });

  it('CRLF line endings alone do not show the report and the import completes', () => {
    const { onImportComplete } = renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(CLEAN_XML.replace(/\n/g, '\r\n'));
    click(buttonWithText(BTN_START));

    expect(hasButton(BTN_CONTINUE)).toBe(false);
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });
});

describe('ImportModal / project name', () => {
  it('refuses to start with an empty name and shows an inline hint', () => {
    const { onImportComplete } = renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(CLEAN_XML);
    fillProjectName('   ');
    click(buttonWithText(BTN_START));

    expect(onImportComplete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('اسم المشروع');
    expect(hasButton(BTN_START)).toBe(true);
  });

  it('suggests the project name from the file, and clears it for the generic strings.xml', async () => {
    renderModal();
    const fileInput = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const nameInput = () => container.querySelector<HTMLInputElement>('#import-project-name')!.value;
    const pickFile = async (name: string) => {
      const file = new File(['<resources><string name="a">x</string></resources>'], name, { type: 'text/xml' });
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 20));
      });
    };

    await pickFile('ICU.MessageFormat.xml');
    expect(nameInput()).toBe('ICU.MessageFormat');
    await pickFile('strings.xml');
    expect(nameInput()).toBe('');
  });
});

describe('ImportModal / partial import (Phase 3 of #25)', () => {
  it('shows a nameless entry excerpt as text, with automatic direction and no HTML execution', () => {
    renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml('<resources><string>&lt;img src=x onerror=alert(1)&gt; مرحباً</string><string name="b">fine</string></resources>');
    click(buttonWithText(BTN_START));

    const excerpt = container.querySelector('pre');
    expect(excerpt?.textContent).toContain('&lt;img src=x onerror=alert(1)&gt; مرحباً');
    expect(excerpt?.getAttribute('dir')).toBe('auto');
    expect(container.textContent).toContain('مقتطف من العنصر');
    expect(container.querySelector('img')).toBeNull();
    expect(hasButton(BTN_CONTINUE)).toBe(true);
  });

  it.each([
    ['plurals', '<plurals name="p"><item quantity="one">x</item>'],
    ['string-array', '<string-array name="arr"><item>x</item>'],
  ])('names the real tag for an unclosed <%s>, not a generic <string>', (tag, unclosed) => {
    renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(`<resources>${unclosed}<string name="ok">fine</string></resources>`);
    click(buttonWithText(BTN_START));

    expect(container.textContent).toContain(`<${tag}>`);
    expect(container.textContent).not.toContain('<string>');
    expect(hasButton(BTN_CONTINUE)).toBe(true);
  });

  it('does not render an empty excerpt block for an empty nameless entry', () => {
    renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml('<resources><string>  </string><string name="b">fine</string></resources>');
    click(buttonWithText(BTN_START));
    expect(container.querySelector('pre')).toBeNull();
    expect(hasButton(BTN_CONTINUE)).toBe(true);
  });
  it('rejects an unknown blocking category even when parsing succeeds and valid items remain', () => {
    const result = repairAndroidXml(CLEAN_XML);
    expect(result.parsed.errors).toEqual([]);
    expect(result.parsed.items).toHaveLength(1);
    vi.mocked(repairAndroidXml).mockReturnValueOnce({
      ...result,
      blockingIssues: [{
        id: 'future-blocker',
        tier: 'blocking',
        category: 'future-file-level-failure',
        message: 'Future file-level failure',
      }],
    });
    const { onClose, onImportComplete } = renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(CLEAN_XML);
    click(buttonWithText(BTN_START));

    expect(container.textContent).toContain('Future file-level failure');
    expect(hasButton(BTN_CONTINUE)).toBe(false);
    expect(hasButton(BTN_START)).toBe(true);
    expect(onImportComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  // One unclosed <string>, but the rest of the file is fine: the file should still import, with the
  // broken entry shown in a read-only "not imported" section instead of rejecting the whole file.
  const XML_WITH_ONE_MALFORMED_ENTRY = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="broken">oops
    <string name="app_name">My App</string>
</resources>`;

  it('still shows a report (not the rejecting error box) and lets the import continue', () => {
    renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(XML_WITH_ONE_MALFORMED_ENTRY);
    click(buttonWithText(BTN_START));

    expect(hasButton(BTN_CONTINUE)).toBe(true);
    expect(container.textContent).toContain('broken');
    expect(container.querySelector('pre')?.textContent).toContain('<string name="broken">oops');
  });

  it('completes the import with only the well-formed entry, once Continue is clicked', () => {
    const { onImportComplete } = renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(XML_WITH_ONE_MALFORMED_ENTRY);
    click(buttonWithText(BTN_START));
    click(buttonWithText(BTN_CONTINUE));

    expect(onImportComplete).toHaveBeenCalledTimes(1);
    const project = onImportComplete.mock.calls[0][0];
    expect(project.items.map((i: { name: string }) => i.name)).toEqual(['app_name']);
  });

  it('a file where every entry is malformed still rejects the whole import', () => {
    renderModal();
    click(buttonWithText(TAB_PASTE));
    pasteXml(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n<string name="broken">oops\n</resources>`);
    click(buttonWithText(BTN_START));

    // Nothing importable remains, so this is the rejecting error box, not the report screen.
    expect(hasButton(BTN_CONTINUE)).toBe(false);
  });
});
