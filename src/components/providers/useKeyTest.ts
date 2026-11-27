import { useRef, useState } from 'react';
import { testGeminiKeyDirect, looksLikeGeminiKey } from '../../utils/geminiDirect';
import { testProviderApiKey, type ProviderTestResult } from '../../utils/translator';

type Inflight = { controller: AbortController; cancelled: boolean };

/**
 * Verifies a provider key. Gemini keys are verified straight from the browser; every other
 * provider goes through the server.
 */
export function testEngineKey(
  engine: string,
  key: string,
  folderId?: string,
  signal?: AbortSignal
): Promise<ProviderTestResult> {
  // Gemini verifies straight from the browser even on Auto-Detect when the key shape gives it
  // away: without this, Auto-Detect + a Gemini key lands on the server path and fails wherever
  // the server is unreachable (static web demo). Google allows CORS from any origin.
  return engine === 'gemini' || (engine === 'auto' && looksLikeGeminiKey(key))
    ? testGeminiKeyDirect(key, signal)
    : testProviderApiKey(engine, key, folderId, signal);
}

/**
 * One key verification at a time: its result, whether it is running, and a way to stop it.
 * Stopping lets the user abandon a stuck check, and editing the key cancels it too, since the
 * result would describe a key that is no longer in the field.
 */
export function useKeyTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProviderTestResult | null>(null);
  const inflight = useRef<Inflight | null>(null);

  const cancel = () => {
    if (!inflight.current) return;
    inflight.current.cancelled = true;
    inflight.current.controller.abort();
    inflight.current = null;
    setRunning(false);
  };

  /** Resolves with the result, or null when the check was cancelled before it finished. */
  const run = async (engine: string, key: string, folderId?: string): Promise<ProviderTestResult | null> => {
    const flight: Inflight = { controller: new AbortController(), cancelled: false };
    inflight.current = flight;
    setRunning(true);
    const outcome = await testEngineKey(engine, key, folderId, flight.controller.signal);
    if (flight.cancelled) return null; // cancelled: the user already moved on
    inflight.current = null;
    setRunning(false);
    setResult(outcome);
    return outcome;
  };

  return { running, result, setResult, run, cancel };
}
