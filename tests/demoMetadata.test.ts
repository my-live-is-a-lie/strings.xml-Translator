import { describe, expect, it } from 'vitest';
import { demoDocumentLanguage } from '../vite.config';

describe('demo document language', () => {
  it.each([
    '<html lang="ar" dir="rtl">',
    '<html dir="rtl" lang="ar">',
    '<html class="app" dir=\'rtl\' lang=\'ar\'>',
  ])('uses English/LTR in the demo regardless of attribute order: %s', (tag) => {
    const result = demoDocumentLanguage(`${tag}<body></body></html>`, true);
    expect(result).toContain('lang="en"');
    expect(result).toContain('dir="ltr"');
    if (tag.includes('class=')) expect(result).toContain('class="app"');
  });

  it('leaves normal build HTML unchanged', () => {
    const html = '<html dir="rtl" lang="ar"><body></body></html>';
    expect(demoDocumentLanguage(html, false)).toBe(html);
  });
});
