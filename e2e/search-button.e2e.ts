import { expect, test } from '@playwright/test';
import { loadSample } from './helpers';

// Note: this spec does not use trackErrors() — the app preconnects to Google Fonts
// (index.html), and those requests fail with ERR_TUNNEL_CONNECTION_FAILED in this
// sandbox, which would trip the error tracker on every page load. That is pre-existing
// environmental noise, unrelated to the search button.

test('table search button expands, focuses the input, and clears text on close', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#header-load-sample-btn')).toBeVisible();
  await loadSample(page);

  // The table view is behind the header's view toggle (the app opens in editor view).
  await page.locator('#view-table-btn').click();
  await expect(page.locator('#table-search-toggle-btn')).toBeVisible();

  const toggle = page.locator('#table-search-toggle-btn');
  const input = page.locator('#table-search-input');

  // Collapsed by default: no input is rendered.
  await expect(input).toHaveCount(0);

  // Open: the input appears and receives focus (after the 260ms delay).
  await toggle.click();
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  // Type a query, then close: closing clears the text.
  await input.fill('app_name');
  await expect(input).toHaveValue('app_name');
  await toggle.click();
  await expect(input).toHaveCount(0);

  // Reopen: the input is empty again.
  await toggle.click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');
});
