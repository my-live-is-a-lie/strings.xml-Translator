// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseAndroidXml } from '../src/utils/xmlParser';
import { validatePlaceholders } from '../src/utils/placeholderCheck';
import { hasItemsChanged } from '../src/utils/filesStorage';
import type { ResourceItem } from '../src/types';

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Application name -->
    <string name="app_name">My App</string>
    <string name="greeting">Hello %1$s, it\\'s %2$d</string>
    <plurals name="files">
        <item quantity="one">%d file</item>
        <item quantity="other">%d files</item>
    </plurals>
    <string-array name="colors">
        <item>Red</item>
        <item>Blue</item>
    </string-array>
</resources>`;

describe('parseAndroidXml', () => {
  it('reads strings, plurals and arrays with their names', () => {
    const { items, errors } = parseAndroidXml(SAMPLE);
    expect(errors).toEqual([]);
    expect(items.map((i) => [i.type, i.name])).toEqual([
      ['string', 'app_name'],
      ['string', 'greeting'],
      ['plural', 'files'],
      ['array', 'colors'],
    ]);
  });

  it('keeps escapes and format specifiers exactly as written in the source', () => {
    const { items } = parseAndroidXml(SAMPLE);
    const greeting = items.find((i) => i.name === 'greeting') as Extract<ResourceItem, { type: 'string' }>;
    expect(greeting.source).toContain("it\\'s");
    expect(greeting.source).toContain('%1$s');
  });

  it('keeps the comment that precedes a string', () => {
    const { items } = parseAndroidXml(SAMPLE);
    expect(items[0].comment).toContain('Application name');
  });

  it('reports malformed XML instead of throwing', () => {
    const { errors } = parseAndroidXml('<resources><string name="x">unclosed');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validatePlaceholders', () => {
  it('accepts a translation that keeps every placeholder', () => {
    expect(validatePlaceholders('Open %1$s now', 'افتح %1$s الآن').valid).toBe(true);
  });

  it('flags a placeholder that the translation dropped', () => {
    const result = validatePlaceholders('Open %1$s now', 'افتح الآن');
    expect(result.valid).toBe(false);
    expect(result.missingInTarget).toContain('%1$s');
  });

  it('flags a placeholder the translation invented', () => {
    const result = validatePlaceholders('Done', 'تم %d');
    expect(result.extraInTarget).toContain('%d');
  });
});

describe('hasItemsChanged', () => {
  const base = (): ResourceItem[] => [
    { id: '1', name: 'a', type: 'string', order: 0, source: 'A', target: '', status: 'untranslated' },
  ];

  it('is false for identical content', () => {
    expect(hasItemsChanged(base(), base())).toBe(false);
  });

  it('is true once a translation is entered', () => {
    const edited = base();
    (edited[0] as { target: string }).target = 'أ';
    expect(hasItemsChanged(edited, base())).toBe(true);
  });
});
