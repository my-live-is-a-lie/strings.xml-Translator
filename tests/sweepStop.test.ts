import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/providerModels', async (orig) => orig());

describe('sweepGeminiModels stop callback', () => {
  it('does nothing when the key is already unused', async () => {
    const { sweepGeminiModels } = await import('../src/utils/providerModels');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sweepGeminiModels('AIza-test-key', () => false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
