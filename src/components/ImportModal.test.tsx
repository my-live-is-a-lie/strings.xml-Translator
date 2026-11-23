// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportModal } from './ImportModal';

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

function pasteXml(xml: string) {
  const textarea = container.querySelector('textarea');
  if (!textarea) throw new Error('paste textarea not found');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, xml);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
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
