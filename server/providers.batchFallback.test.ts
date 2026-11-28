import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateBatch } from './providers';

afterEach(() => vi.unstubAllGlobals());

function stubOpenAI() {
  const fn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const prompts = (fn: ReturnType<typeof stubOpenAI>) =>
  fn.mock.calls.map((c) => JSON.parse(String(((c as unknown[])[1] as { body: string }).body)).messages[1].content as string);

describe('translateBatch per-text fallback', () => {
  it('translates from the chosen source language, not English', async () => {
    const fn = stubOpenAI();
    await translateBatch('openai', 'sk-x', ['Bonjour', 'Merci'], 'ar', undefined, 'fr');
    const p = prompts(fn);
    expect(p).toHaveLength(2);
    p.forEach((t) => expect(t).toContain('from French'));
  });

  it('still defaults to English when no source language is given', async () => {
    const fn = stubOpenAI();
    await translateBatch('openai', 'sk-x', ['Hello'], 'ar');
    expect(prompts(fn)[0]).toContain('from English');
  });
});
