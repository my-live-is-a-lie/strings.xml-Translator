import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { loadSample, mockProviderApi, openAppWithProvider, openDrawer, trackErrors } from './helpers';

test('loads the sample, keeps edits after a reload, and logs no errors', async ({ page }) => {
  const errors = trackErrors(page);
  await openAppWithProvider(page);
  await loadSample(page);

  await page.locator('textarea').first().fill('اختبار الحفظ 123');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(1200); // writes are debounced
  await page.reload();
  await expect(page.locator('body')).toContainText('اختبار الحفظ 123');
  expect(errors).toEqual([]);
});

test('a legacy plain-text API key is encrypted, and the decrypted key reaches the batch request', async ({ page }) => {
  const hits: string[] = [];
  await mockProviderApi(page, hits);
  await openAppWithProvider(page, 'SECRET-KEY-123');
  await page.reload(); // migration runs on startup

  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('strings_translator_db');
        open.onsuccess = () => {
          const db = open.result;
          const dump: Record<string, unknown[]> = {};
          const stores = Array.from(db.objectStoreNames);
          let left = stores.length;
          for (const name of stores) {
            const req = db.transaction(name).objectStore(name).getAll();
            req.onsuccess = () => {
              dump[name] = req.result;
              if (--left === 0) resolve(JSON.stringify(dump) + JSON.stringify(Object.assign({}, localStorage)));
            };
          }
        };
      })
  );
  expect(stored).not.toContain('SECRET-KEY-123');

  await loadSample(page);
  await page.getByText(/تحديد غير المترجم/).first().click();
  await page.click('#stringlist-bulk-translate-btn');
  await expect.poll(() => hits.some((h) => h.startsWith('batch:'))).toBe(true);
  expect(hits.every((h) => h.endsWith(':SECRET-KEY-123'))).toBe(true);
});

test('"?" opens the shortcuts dialog and Escape closes it', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: /اختصارات|shortcuts/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('export is blocked on placeholder errors until the user acknowledges them', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-export-btn');
  const download = page.locator('button:has-text("strings.xml")').last();
  await expect(page.locator('#export-allow-broken')).toBeVisible();
  await expect(download).toBeDisabled();
  await page.locator('#export-allow-broken').check();
  await expect(download).toBeEnabled();
});

test('updating the source file keeps translations and reports what changed', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-update-source-btn');
  await page.fill(
    '#update-source-text',
    '<resources><string name="app_name">OmniTask 2</string><string name="action_save">Save Changes</string><string name="brand_new">Brand new text</string></resources>'
  );
  await expect(page.getByText(/1 جديد · 1 متغيّر · 15 محذوف · 1 دون تغيير/)).toBeVisible();
  await page.click('#update-source-apply');
  await expect(page.locator('#string-item-brand_new')).toBeVisible();
  await expect(page.locator('#string-item-action_cancel')).toHaveCount(0);
});

test('translates several languages and downloads a ZIP with one values folder each', async ({ page }) => {
  const errors = trackErrors(page);
  await mockProviderApi(page);
  await openAppWithProvider(page);
  await loadSample(page);
  await openDrawer(page);
  await page.click('#drawer-multilang-btn');
  await page.locator('input[data-lang="fr"]').check();
  await page.locator('input[data-lang="pt-rBR"]').check();
  await page.click('#multilang-start');
  await expect(page.getByText(/2 جاهزة/)).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#multilang-download')]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const zipPath = join(dir, 'out.zip');
  await download.saveAs(zipPath);
  const listing = execFileSync('unzip', ['-Z1', zipPath]).toString().split('\n').filter((l) => l && !l.endsWith('/')).sort();
  expect(listing).toEqual(['values-fr/strings.xml', 'values-pt-rBR/strings.xml']);
  expect(execFileSync('unzip', ['-p', zipPath, 'values-fr/strings.xml']).toString()).toContain('fr ');
  expect(errors).toEqual([]);
});

test('the editor buttons move through the strings', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  const counter = page.locator('text=/^\\d+ \\/ \\d+$/').first();
  await expect(counter).toHaveText('1 / 17');
  await page.locator('textarea').first().fill('نص تجريبي');
  await page.getByText('حفظ ومتابعة').click();
  await expect(counter).toHaveText('2 / 17');
  await page.locator('#weblate-skip-btn').click();
  await expect(counter).toHaveText('3 / 17');
});

test('server health endpoint answers and metrics stay hidden without a token', async ({ request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: 'ok' });
  expect((await request.get('/metrics')).status()).toBe(404);
});

test('quick filters: multi-select, count badge, hide/show, and they are remembered', async ({ page }) => {
  await openAppWithProvider(page);
  await loadSample(page);
  await page.setViewportSize({ width: 390, height: 800 });

  const btn = page.locator('[data-quick-filters-btn]:visible');
  await expect(page.locator('[data-quick-filters-bar]')).toHaveCount(0);
  await btn.click();
  await expect(page.locator('[data-quick-filters-bar]:visible')).toBeVisible();

  await page.locator('[data-filter="untranslated"]:visible').click();
  await expect(btn).toContainText('1');
  await page.locator('[data-filter="manual"]:visible').click();
  await expect(btn).toContainText('2');
  await page.locator('[data-filter="manual"]:visible').click(); // toggling again disables it
  await expect(btn).toContainText('1');

  await btn.click(); // hides the bar but keeps the filter
  await expect(page.locator('[data-quick-filters-bar]')).toHaveCount(0);
  await expect(btn).toContainText('1');

  await page.reload();
  await expect(page.locator('[data-quick-filters-btn]:visible')).toContainText('1');
});
