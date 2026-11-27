import { describe, expect, it } from 'vitest';
import { deeplSupportsFormality, deeplRequestFields, sanitizeDeeplOptions, DEEPL_CONTEXT_MAX_LENGTH } from './deeplOptions';

describe('deeplRequestFields', () => {
  it('sends nothing when no option is set, so DeepL keeps its defaults', () => {
    expect(deeplRequestFields(undefined)).toEqual({});
    expect(deeplRequestFields({})).toEqual({});
  });

  it('maps every option to its DeepL field', () => {
    expect(
      deeplRequestFields({
        formality: 'more',
        modelType: 'quality_optimized',
        context: ' Settings screen ',
        preserveFormatting: true,
        splitSentences: 'nonewlines',
      })
    ).toEqual({
      formality: 'prefer_more',
      model_type: 'quality_optimized',
      context: 'Settings screen',
      preserve_formatting: true,
      split_sentences: 'nonewlines',
    });
  });

  it('uses the prefer_ values so an unsupported target language falls back instead of failing', () => {
    expect(deeplRequestFields({ formality: 'less' }).formality).toBe('prefer_less');
  });

  it('does not send preserve_formatting when it is off', () => {
    expect(deeplRequestFields({ preserveFormatting: false })).toEqual({});
  });
});

describe('sanitizeDeeplOptions', () => {
  it('drops unknown values and non-objects', () => {
    expect(sanitizeDeeplOptions('x')).toBeUndefined();
    expect(sanitizeDeeplOptions([])).toBeUndefined();
    expect(
      sanitizeDeeplOptions({ formality: 'default', modelType: 'prefer_quality_optimized', splitSentences: '1', extra: 1 })
    ).toBeUndefined();
  });

  it('caps the context length and ignores a blank one', () => {
    expect(sanitizeDeeplOptions({ context: '   ' })).toBeUndefined();
    expect(sanitizeDeeplOptions({ context: 'a'.repeat(5000) })?.context).toHaveLength(DEEPL_CONTEXT_MAX_LENGTH);
  });
});

describe('deeplSupportsFormality', () => {
  it('is true for the languages DeepL lists with formality', () => {
    for (const l of ['de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'pt-rBR', 'ru']) expect(deeplSupportsFormality(l)).toBe(true);
  });
  it('is false for Arabic and other languages without it', () => {
    for (const l of ['ar', 'en', 'tr', 'zh-rCN', 'ko', 'hi']) expect(deeplSupportsFormality(l)).toBe(false);
  });
});
