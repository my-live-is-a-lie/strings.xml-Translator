import { describe, expect, it } from 'vitest';
import { classifyGeminiKeyProblem, classifyLaraError } from './providerErrors';
import { GEMINI_ERROR_CASES, LARA_ERROR_CASES } from './providerErrorFixtures';

describe('Lara error cases', () => {
  it.each(LARA_ERROR_CASES)('$name', ({ input, expected }) => {
    expect(classifyLaraError(input)).toBe(expected);
  });
  it('an error without a numeric statusCode is never a key problem', () => {
    expect(classifyLaraError({ statusCode: '401', type: 'Unauthorized', message: 'x' })).toBeNull();
    expect(classifyLaraError(undefined)).toBeNull();
    expect(classifyLaraError('401')).toBeNull();
  });
});

describe('Gemini error cases', () => {
  it.each(GEMINI_ERROR_CASES)('$name', ({ status, message, expected }) => {
    expect(classifyGeminiKeyProblem(status, message)).toBe(expected);
  });
});
