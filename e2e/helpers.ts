import { expect, type Page } from '@playwright/test';

/** Fails the test on uncaught page errors and console errors (which include CSP violations). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Replaces the provider API with a deterministic fake so tests need no network or real keys. */
export async function mockProviderApi(page: Page, hits: string[] = []): Promise<void> {
  const fake = (lang: string, text: string) => `${lang} ${text.toUpperCase()}`;
  await page.route('**/api/providers/translate-batch', async (route) => {
    const body = route.request().postDataJSON() as { texts: string[]; targetLang: string; apiKey: string };
    hits.push(`batch:${body.apiKey}`);
    await route.fulfill({ json: { translations: body.texts.map((t) => fake(body.targetLang, t)) } });
  });
  await page.route('**/api/providers/translate', async (route) => {
    const body = route.request().postDataJSON() as { sourceText: string; targetLang: string; apiKey: string };
    hits.push(`single:${body.apiKey}`);
    await route.fulfill({ json: { translatedText: fake(body.targetLang, body.sourceText) } });
  });
}

/** Opens the app with a saved DeepL provider (stored the legacy plain-text way, so migration is exercised). */
export async function openAppWithProvider(page: Page, apiKey = 'SECRET-KEY-123'): Promise<void> {
  await page.goto('/');
  await page.evaluate((key) => {
    localStorage.setItem(
      'custom_translation_providers_v1',
      JSON.stringify([{ id: 't1', name: 'DeepL Test', type: 'deepl', apiKey: key, enabled: true }])
    );
    localStorage.setItem('active_translation_provider_id_v1', 't1');
  }, apiKey);
  await page.reload();
  await expect(page.locator('#header-load-sample-btn')).toBeVisible();
}

export async function loadSample(page: Page): Promise<void> {
  await page.click('#header-load-sample-btn');
  await expect(page.locator('#string-item-app_name')).toBeVisible();
}

export async function openDrawer(page: Page): Promise<void> {
  await page.click('#header-right-drawer-btn');
  await expect(page.locator('#drawer-export-btn')).toBeVisible();
}
