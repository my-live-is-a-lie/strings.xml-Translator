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

/**
 * A tiny external store for model lists: reading the snapshot kicks off the provider's list-models
 * call once per key (the result is cached), and subscribers are notified when it lands. This keeps
 * the picker free of effect-driven fetches. Falls back to the static candidate list when the
 * endpoint fails, so the picker still opens.
 */
type ModelListEntry = 'loading' | string[];
const modelListStore = new Map<string, ModelListEntry>();
const modelListListeners = new Set<() => void>();

export function subscribeModelLists(onChange: () => void): () => void {
  modelListListeners.add(onChange);
  return () => {
    modelListListeners.delete(onChange);
  };
}

export function getProviderModelsSnapshot(
  type: ProviderEngineType | string,
  apiKey: string | undefined
): ModelListEntry | null {
  if (type !== 'gemini' || !apiKey?.trim()) return null;
  const storeKey = `${type}:${apiKey.trim()}`;
  const hit = modelListStore.get(storeKey);
  if (hit) return hit;
  modelListStore.set(storeKey, 'loading');
  listGeminiModels(apiKey)
    .then((models) => (models.length ? models : [...GEMINI_MODEL_CANDIDATES]))
    .catch(() => [...GEMINI_MODEL_CANDIDATES])
    .then((models) => {
      modelListStore.set(storeKey, models);
      modelListListeners.forEach((cb) => cb());
    });
  return 'loading';
}
