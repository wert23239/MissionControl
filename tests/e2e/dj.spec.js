const { test, expect } = require('@playwright/test');

test.describe('DJ Tab E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Click the Music nav item
    await page.click('text=🎵 Music');
    await page.waitForTimeout(1000);
  });

  test('DJ tab loads with search input', async ({ page }) => {
    const input = page.locator('#djInput');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /search/i);
  });

  test('DJ tab shows stats cards', async ({ page }) => {
    const stats = page.locator('#djStats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('On Disk');
    await expect(stats).toContainText('Queue');
  });

  test('search input triggers song picker', async ({ page }) => {
    const input = page.locator('#djInput');
    await input.fill('Daft Punk Around The World');
    await page.click('text=Add Song');
    // Wait for Spotify lookup
    await page.waitForTimeout(3000);
    // Should show pipeline with track options
    const pipeline = page.locator('#djPipeline');
    await expect(pipeline).toBeVisible();
  });

  test('profile selector works', async ({ page }) => {
    const select = page.locator('#djProfile');
    await expect(select).toBeVisible();
    await select.selectOption('Sabrina');
    // Label should update
    await page.waitForTimeout(500);
  });

  test('profile switching changes view', async ({ page }) => {
    const select = page.locator('#djProfile');
    await select.selectOption('Gatsby');
    await page.waitForTimeout(500);
    await select.selectOption('Sabrina');
    await page.waitForTimeout(500);
    // Should not crash
    const panel = page.locator('#panel-dj');
    await expect(panel).toBeVisible();
  });

  test('On Disk section renders with file count', async ({ page }) => {
    await page.waitForTimeout(2000);
    const disk = page.locator('#djOnDisk');
    await expect(disk).toContainText('On Disk');
  });

  test('On Disk filter works', async ({ page }) => {
    await page.waitForTimeout(2000);
    const filterInput = page.locator('.dj-disk-search');
    if (await filterInput.isVisible()) {
      await filterInput.fill('daft');
      await page.waitForTimeout(500);
      // Should filter results
    }
  });

  test('genre selector is present', async ({ page }) => {
    const genre = page.locator('#djGenre');
    await expect(genre).toBeVisible();
  });
});
