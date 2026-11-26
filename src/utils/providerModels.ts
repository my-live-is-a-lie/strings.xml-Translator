import type { ProviderEngineType } from './translator';
import {
  GEMINI_MODEL_CANDIDATES,
  GeminiModelInfo,
  listGeminiModels,
  ModelProbeResult,
  probeGeminiModel,
} from './geminiDirect';
import { getStoredItem, removeStoredItem, setStoredItem } from './storage';

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
 * Same store pattern for model probes. Probing is lazy: only the model the user selected (or the
 * one whose levels the thinking picker is showing) is probed, never the whole list. Results are
 * cached per model name and key - never per provider record - and persisted with a 24h TTL, so
 * deleting and re-adding the same key, or reloading the app, reuses the probe instead of
 * re-running it.
 */
type ModelProbeEntry = 'loading' | ModelProbeResult;
const modelProbeStore = new Map<string, ModelProbeEntry>();

const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

/** Short non-reversible tag so the cache key does not embed the API key itself. */
function keyTag(apiKey: string): string {
  let hash = 5381;
  for (let i = 0; i < apiKey.length; i++) hash = ((hash << 5) + hash + apiKey.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** Storage key for a persisted probe (exported for tests). */
export const modelProbeCacheKey = (apiKey: string, model: string) =>
  `model_probe_v1:${keyTag(apiKey)}:${model}`;

function readCachedProbe(apiKey: string, model: string): ModelProbeResult | null {
  const cacheKey = modelProbeCacheKey(apiKey, model);
  try {
    const raw = getStoredItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      availability?: string;
      levels?: unknown;
      modelQuota?: unknown;
      at?: number;
    };
    if (
      typeof parsed.at !== 'number' ||
      Date.now() - parsed.at > PROBE_TTL_MS ||
      !['ok', 'unavailable', 'unknown'].includes(String(parsed.availability)) ||
      !Array.isArray(parsed.levels)
    ) {
      removeStoredItem(cacheKey);
      return null;
    }
    return {
      availability: parsed.availability as ModelProbeResult['availability'],
      levels: parsed.levels.filter((l): l is string => typeof l === 'string'),
      modelQuota: parsed.modelQuota === true ? true : undefined,
      // Only definite results (and model-scoped quota, which is definite about this model on
      // this plan) are ever persisted, so a well-formed entry is definite.
      definite: parsed.modelQuota === true ? false : true,
    };
  } catch {
    return null;
  }
}

/**
 * Read-only view of a model's probe state for grouping the picker: returns the in-memory or
 * persisted result without ever launching a probe. Unprobed models return null.
 */
export function peekModelProbe(
  type: ProviderEngineType | string,
  apiKey: string | undefined,
  model: string | undefined
): ModelProbeResult | null {
  if (type !== 'gemini' || !apiKey?.trim() || !model?.trim()) return null;
  const hit = modelProbeStore.get(`${type}:${apiKey.trim()}:${model.trim()}`);
  if (hit && hit !== 'loading') return hit;
  return readCachedProbe(apiKey.trim(), model.trim());
}

/** Bumped on every probe store change so pickers re-group as results land. */
let probeStatesVersion = 0;
export function getModelProbeStatesVersion(): number {
  return probeStatesVersion;
}

/**
 * A definite key/account problem (invalid or expired key, exhausted quota) seen while a provider
 * translated. Kept visible on the provider card until the provider succeeds again, so a dead key
 * never silently falls back to the free engines. Session-scoped by design: the next successful
 * call clears it.
 */
export type ProviderKeyProblem = 'expired-key' | 'invalid-key' | 'quota-exhausted';
/** Card-visible runtime error: a key/account problem, or one model proven unusable at runtime. */
export type ProviderRuntimeError = { kind: ProviderKeyProblem | 'model-unavailable'; model?: string; at: number };
const providerRuntimeErrors = new Map<string, ProviderRuntimeError>();
// Stable snapshot for useSyncExternalStore: replaced (never mutated) on every change.
let runtimeErrorsSnapshot: ReadonlyMap<string, ProviderRuntimeError> = providerRuntimeErrors;

export function reportProviderKeyProblem(providerId: string, kind: ProviderKeyProblem): void {
  providerRuntimeErrors.set(providerId, { kind, at: Date.now() });
  runtimeErrorsSnapshot = new Map(providerRuntimeErrors);
  notify();
}

export function clearProviderRuntimeError(providerId: string): void {
  if (providerRuntimeErrors.delete(providerId)) {
    runtimeErrorsSnapshot = new Map(providerRuntimeErrors);
    notify();
  }
}

/**
 * Success path after a translation: key problems always clear. A model-unavailable line clears
 * only when the failing model is no longer the pinned one - when the pinned model itself just
 * failed and a failover model answered, the pinned model is still broken and the line stays.
 */
export function clearProviderRuntimeErrorOnSuccess(providerId: string, pinnedModel?: string): void {
  const err = providerRuntimeErrors.get(providerId);
  if (!err) return;
  if (err.kind === 'model-unavailable' && pinnedModel?.trim() && err.model === pinnedModel.trim()) return;
  clearProviderRuntimeError(providerId);
}

/** A successful re-test of a model clears its runtime line. */
export function clearModelUnavailableError(providerId: string, model: string): void {
  const err = providerRuntimeErrors.get(providerId);
  if (err?.kind === 'model-unavailable' && err.model === model.trim()) {
    clearProviderRuntimeError(providerId);
  }
}

export function getProviderRuntimeErrorsSnapshot(): ReadonlyMap<string, ProviderRuntimeError> {
  return runtimeErrorsSnapshot;
}

/**
 * A definite API answer during a real translation call - the model is gone (404-style) or its
 * per-model quota is not on this plan (e.g. free-tier limit 0). Moves the model to the picker's
 * unavailable group (persisted with the same TTL) and says so on the provider card. Transient
 * failures (network, timeouts, 5xx, per-minute 429) must never call this. The card line clears
 * on the next successful translation like any runtime error; the group membership clears when a
 * re-test from the unavailable group succeeds.
 */
export function reportModelDefiniteFailure(
  providerId: string,
  type: ProviderEngineType | string,
  apiKey: string,
  model: string,
  kind: 'unavailable' | 'model-quota'
): void {
  const key = apiKey.trim();
  const name = model.trim();
  if (type !== 'gemini' || !key || !name) return;
  const previous = peekModelProbe(type, key, name);
  const result: ModelProbeResult =
    kind === 'model-quota'
      ? { availability: 'unknown', levels: previous?.levels ?? [], keyProblem: null, definite: false, modelQuota: true }
      : { availability: 'unavailable', levels: previous?.levels ?? [], keyProblem: null, definite: true };
  modelProbeStore.set(`${type}:${key}:${name}`, result);
  try {
    setStoredItem(modelProbeCacheKey(key, name), JSON.stringify({ ...result, at: Date.now() }));
  } catch {
    // Caching is best-effort; the in-memory entry already covers this session.
  }
  probeStatesVersion++;
  providerRuntimeErrors.set(providerId, { kind: 'model-unavailable', model: name, at: Date.now() });
  runtimeErrorsSnapshot = new Map(providerRuntimeErrors);
  notify();
}



export function getModelProbeSnapshot(
  type: ProviderEngineType | string,
  apiKey: string | undefined,
  model: string | undefined,
  opts?: { force?: boolean }
): ModelProbeEntry | null {
  if (type !== 'gemini' || !apiKey?.trim() || !model?.trim()) return null;
  const key = apiKey.trim();
  const name = model.trim();
  const storeKey = `${type}:${key}:${name}`;
  // force re-runs the probe: picking a model from the unavailable group is an explicit re-test.
  if (!opts?.force) {
    const hit = modelProbeStore.get(storeKey);
    if (hit) return hit;
    const cached = readCachedProbe(key, name);
    if (cached) {
      modelProbeStore.set(storeKey, cached);
      return cached;
    }
  }
  modelProbeStore.set(storeKey, 'loading');
  probeGeminiModel(key, name)
    .catch((): ModelProbeResult => ({ availability: 'unknown', levels: [], definite: false }))
    .then((result) => {
      modelProbeStore.set(storeKey, result);
      // Only definite API answers are persisted: a result shaped by a transient key/network
      // problem must never mark a working model for future sessions. A model-scoped quota is
      // definite about this model on this plan, so it is persisted too and the unavailable
      // group survives reloads within the same TTL.
      if (result.definite || result.modelQuota) {
        try {
          setStoredItem(modelProbeCacheKey(key, name), JSON.stringify({ ...result, at: Date.now() }));
        } catch {
          // Caching is best-effort; the in-memory entry already covers this session.
        }
      }
      probeStatesVersion++;
      notify();
    });
  return 'loading';
}
