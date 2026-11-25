import type { ProviderEngineType } from './translator';
import { GEMINI_MODEL_CANDIDATES, listGeminiModels } from './geminiDirect';

/** Thinking strengths a provider's picker can offer. 'auto' keeps the model's own default. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Which providers let the user pin a model and a thinking strength. Gemini does both; the other
 * engines expose no model choice through their translation endpoints, so the dropdowns stay hidden.
 */
export function providerSupportsModelChoice(type: ProviderEngineType | string): boolean {
  return type === 'gemini';
}

export function providerSupportsThinking(type: ProviderEngineType | string): boolean {
  return type === 'gemini';
}

// Per-key cache: listing models is a network call, and the picker reopens often.
const modelListCache = new Map<string, Promise<string[]>>();

/**
 * The models a provider key can call. Asks the provider's model-list endpoint (Gemini has one);
 * falls back to the static candidate list when the key or network fails, so the picker still opens.
 */
export function fetchProviderModels(type: ProviderEngineType | string, apiKey: string): Promise<string[]> {
  if (type !== 'gemini') return Promise.resolve([]);
  const cacheKey = apiKey.trim();
  const cached = modelListCache.get(cacheKey);
  if (cached) return cached;
  const pending = listGeminiModels(cacheKey).then((models) =>
    models.length ? models : [...GEMINI_MODEL_CANDIDATES]
  );
  modelListCache.set(cacheKey, pending);
  return pending;
}
