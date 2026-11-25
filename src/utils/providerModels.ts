import type { ProviderEngineType } from './translator';
import {
  GEMINI_MODEL_CANDIDATES,
  GeminiModelInfo,
  listGeminiModels,
  ModelProbeResult,
  probeGeminiModel,
} from './geminiDirect';

/**
 * Static fallback for the picker when the list endpoint fails. `thinking: true` keeps the
 * thinking picker visible; the runtime probe then decides which levels each model really accepts.
 */
const FALLBACK_MODELS: GeminiModelInfo[] = GEMINI_MODEL_CANDIDATES.filter((n) =>
  /^gemini-\d/.test(n)
).map((name) => ({ name, thinking: true }));

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

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

export function subscribeModelLists(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * A tiny external store for model lists: reading the snapshot kicks off the provider's list-models
 * call once per key (the result is cached), and subscribers are notified when it lands. This keeps
 * the picker free of effect-driven fetches. Falls back to the static candidate list when the
 * endpoint fails, so the picker still opens.
 */
type ModelListEntry = 'loading' | GeminiModelInfo[];
const modelListStore = new Map<string, ModelListEntry>();

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
    .then((models) => (models.length ? models : [...FALLBACK_MODELS]))
    .catch(() => [...FALLBACK_MODELS])
    .then((models) => {
      modelListStore.set(storeKey, models);
      notify();
    });
  return 'loading';
}

/**
 * Same store pattern for model probes: one parallel thinking-level probe per (key, model), cached,
 * so the thinking picker can show only levels the model actually accepts and a pinned model is
 * verified before it is saved, all without hardcoding anything about model versions.
 */
type ModelProbeEntry = 'loading' | ModelProbeResult;
const modelProbeStore = new Map<string, ModelProbeEntry>();

export function getModelProbeSnapshot(
  type: ProviderEngineType | string,
  apiKey: string | undefined,
  model: string | undefined
): ModelProbeEntry | null {
  if (type !== 'gemini' || !apiKey?.trim() || !model?.trim()) return null;
  const storeKey = `${type}:${apiKey.trim()}:${model.trim()}`;
  const hit = modelProbeStore.get(storeKey);
  if (hit) return hit;
  modelProbeStore.set(storeKey, 'loading');
  probeGeminiModel(apiKey, model)
    .catch((): ModelProbeResult => ({ availability: 'unknown', levels: [] }))
    .then((result) => {
      modelProbeStore.set(storeKey, result);
      notify();
    });
  return 'loading';
}
