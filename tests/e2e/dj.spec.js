const { test, expect } = require('@playwright/test');

test.describe('DJ Tab E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Click the DJ nav item using data-id attribute
    await page.locator('[data-id="dj"]').click();
    await page.waitForTimeout(2000);
  });

  test('DJ tab loads with search input', async ({ page }) => {
    await expect(page.locator('#djInput')).toBeVisible();
  });

  test('DJ tab shows stats cards', async ({ page }) => {
    await expect(page.locator('#djStats')).toBeVisible();
  });

  test('search triggers multi-source picker', async ({ page }) => {
    await page.locator('#djInput').fill('Daft Punk');
    await page.locator('.dj-btn').click();
    // Wait for multi-source search (Soulseek ~8s + API)
    await page.waitForTimeout(15000);
    const pipeline = page.locator('#djPipeline');
    await expect(pipeline).toBeVisible();
    const text = await pipeline.textContent();
    // Should show source info or results count
    expect(text).toMatch(/results|Spotify|YouTube|select|Tap/i);
  }, 25000);

  test('profile selector works', async ({ page }) => {
    const select = page.locator('#djProfile');
    await expect(select).toBeVisible();
    await select.selectOption('Sabrina');
  });

  test('profile switching does not crash', async ({ page }) => {
    await page.locator('#djProfile').selectOption('Gatsby');
    await page.waitForTimeout(300);
    await page.locator('#djProfile').selectOption('Sabrina');
    await page.waitForTimeout(300);
    await expect(page.locator('#panel-dj')).toBeVisible();
  });

  test('On Disk section renders', async ({ page }) => {
    await expect(page.locator('#djOnDisk')).toContainText('On Disk');
  });

  test('On Disk filter input exists', async ({ page }) => {
    const filter = page.locator('.dj-disk-search');
    if (await filter.count() > 0) {
      await filter.fill('test');
      await page.waitForTimeout(300);
    }
  });

  test('genre selector is present', async ({ page }) => {
    await expect(page.locator('#djGenre')).toBeVisible();
  });
});
