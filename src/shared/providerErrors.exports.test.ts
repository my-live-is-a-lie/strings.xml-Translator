import { describe, expect, it } from 'vitest';
import * as unified from './providerErrors';
import * as lara from './laraErrors';
import * as gemini from '../utils/geminiDirect';

describe('old module names still point at the unified providerErrors module', () => {
  it('Lara names are the same functions and class', () => {
    expect(lara.classifyLaraError).toBe(unified.classifyLaraError);
    expect(lara.ProviderKeyError).toBe(unified.ProviderKeyError);
  });
  it('Gemini names are the same functions', () => {
    expect(gemini.classifyGeminiKeyProblem).toBe(unified.classifyGeminiKeyProblem);
    expect(gemini.isModelQuotaMessage).toBe(unified.isModelQuotaMessage);
    expect(gemini.isModelUnavailableMessage).toBe(unified.isModelUnavailableMessage);
  });
});
