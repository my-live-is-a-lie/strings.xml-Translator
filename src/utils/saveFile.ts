import { Capacitor } from '@capacitor/core';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}

function browserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on a delay: revoking in the same tick can cancel the download on Android Chrome/WebViews.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Hands the file to the Android share sheet through a cache copy. Native only. */
async function shareViaSystem(blob: Blob, fileName: string, base64?: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = base64 ?? (await blobToBase64(blob));
  const written = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: fileName, files: [written.uri], dialogTitle: fileName });
}

/**
 * Saves a file for the user. Browsers download it through a link; the Android app's WebView can't
 * download blob links, so there the file is written to the app cache and handed to the system share
 * sheet, where "Save to device" / Drive / any other app can take it.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareViaSystem(blob, fileName);
    return;
  }
  browserDownload(blob, fileName);
}

export type SaveLocation = 'documents' | 'shared' | 'download';

/**
 * Saves directly: a browser download, or the public Documents folder in the Android app (no
 * permission needed on Android 11+; on older versions the plugin asks once). When a direct save is
 * not possible it falls back to the system share sheet and reports where the file ended up.
 */
export async function saveToDevice(blob: Blob, fileName: string): Promise<SaveLocation> {
  if (!Capacitor.isNativePlatform()) {
    browserDownload(blob, fileName);
    return 'download';
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const data = await blobToBase64(blob);
  try {
    await Filesystem.writeFile({ path: fileName, data, directory: Directory.Documents, recursive: true });
    return 'documents';
  } catch {
    // Older Android versions can still gate the public Documents folder behind a runtime permission.
    try {
      const perm = await Filesystem.requestPermissions();
      if (perm.publicStorage === 'granted') {
        await Filesystem.writeFile({ path: fileName, data, directory: Directory.Documents, recursive: true });
        return 'documents';
      }
    } catch {
      // fall through to the share sheet
    }
  }
  await shareViaSystem(blob, fileName, data).catch((err) => {
    // Dismissing the sheet is not a failure.
    if ((err as { name?: string } | null)?.name === 'AbortError') return;
    throw err;
  });
  return 'shared';
}

/**
 * Opens a share for the file: the system share sheet in the Android app, the Web Share API in
 * browsers that can share files, and a plain download everywhere else. A user dismissing the
 * share UI (AbortError) resolves quietly as 'shared'. When a browser claims it can share but the
 * share is still refused (Chromium shares only certain file types, and application/zip is not one
 * of them), the file is downloaded instead of showing an error.
 */
export async function shareFile(blob: Blob, fileName: string): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    try {
      await shareViaSystem(blob, fileName);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'shared';
      throw err;
    }
    return 'shared';
  }
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'shared';
      // Fall through to the download.
    }
  }
  browserDownload(blob, fileName);
  return 'downloaded';
}
