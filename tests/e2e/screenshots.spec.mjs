// Captures screenshots of the app (normal and print-exhibit layouts) using the mocked
// parcel services. Output: test-results/screenshots/*.png
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { installMockArcGIS, makeParcels, ALLENMORE } from './fixtures/mock-arcgis.mjs';

const OUT = 'test-results/screenshots';

test('screenshots of the study view and print exhibit', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await installMockArcGIS(page, { parcels: makeParcels() });
  await page.goto(`/#lat=${ALLENMORE.lat}&lon=${ALLENMORE.lon}&r=250&u=yd&q=MultiCare%20Allenmore%20Hospital%2C%20Tacoma`);
  await expect(page.locator('table.parcels tbody tr').first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/study.png` });
  // print layout (without opening the dialog)
  await page.fill('#title', 'MultiCare Allenmore Hospital | Tacoma, WA');
  await page.dispatchEvent('#title', 'input');
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.click('#btn-print');
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/exhibit.png`, fullPage: true });
});
