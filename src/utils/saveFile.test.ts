// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareFile } from './saveFile';

// jsdom has no URL.createObjectURL; the browser branch needs it mocked to observe downloads.
let downloads: string[];
let share: ReturnType<typeof vi.fn>;
let canShare: ReturnType<typeof vi.fn>;

beforeEach(() => {
  downloads = [];
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  share = vi.fn();
  canShare = vi.fn();
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const zipBlob = () => new Blob(['PK'], { type: 'application/zip' });

describe('shareFile in a browser', () => {
  it('downloads when the browser cannot share files', async () => {
    canShare.mockReturnValue(false);
    await expect(shareFile(zipBlob(), 'a-values-ar.zip')).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(downloads).toEqual(['a-values-ar.zip']);
  });

  it('shares when the browser accepts the file', async () => {
    canShare.mockReturnValue(true);
    share.mockResolvedValue(undefined);
    await expect(shareFile(zipBlob(), 'a-values-ar.zip')).resolves.toBe('shared');
    expect(downloads).toEqual([]);
  });

  it('treats dismissing the share sheet as a quiet share, not an error or a download', async () => {
    canShare.mockReturnValue(true);
    share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    await expect(shareFile(zipBlob(), 'a-values-ar.zip')).resolves.toBe('shared');
    expect(downloads).toEqual([]);
  });

  it('downloads when the share is refused, e.g. Chromium rejecting a zip file type', async () => {
    canShare.mockReturnValue(true);
    share.mockRejectedValue(new TypeError('Invalid file type'));
    await expect(shareFile(zipBlob(), 'a-values-ar.zip')).resolves.toBe('downloaded');
    expect(downloads).toEqual(['a-values-ar.zip']);
  });
});
