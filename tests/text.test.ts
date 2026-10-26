import { describe, expect, it } from 'vitest';
import { normalizeForComparison, stripMetadataWrappers, googleGtxLanguage } from '../src/shared/translateCore';

describe('stripMetadataWrappers', () => {
  it('removes a translation label the model added', () => {
    expect(stripMetadataWrappers('[Translation: تثبيت]', 'Install')).toBe('تثبيت');
  });

  it('removes markdown fences', () => {
    expect(stripMetadataWrappers('```\nتثبيت\n```', 'Install')).toBe('تثبيت');
  });

  it('keeps brackets that the source itself uses', () => {
    expect(stripMetadataWrappers('[تثبيت]', '[Install]')).toBe('[تثبيت]');
  });
});

describe('normalizeForComparison', () => {
  it('treats Arabic spelling variants as equal', () => {
    expect(normalizeForComparison('مدرسة')).toBe(normalizeForComparison('مدرسه'));
    expect(normalizeForComparison('إعلان')).toBe(normalizeForComparison('اعلان'));
  });
});

describe('googleGtxLanguage', () => {
  it('maps regional codes used by Android to Google codes', () => {
    expect(googleGtxLanguage('zh-rCN')).toBe('zh-CN');
    expect(googleGtxLanguage('pt-rBR')).toBe('pt-BR');
    expect(googleGtxLanguage('ar')).toBe('ar');
  });
});
