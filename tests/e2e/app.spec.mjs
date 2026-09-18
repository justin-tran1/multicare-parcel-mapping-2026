import { test, expect } from '@playwright/test';
import { installMockArcGIS, makeParcels, ALLENMORE, TACOMA_URL, PIERCE_URL } from './fixtures/mock-arcgis.mjs';
import { makeProjector, projectPolygons, distanceFromOriginToPolygons, toMeters } from '../../js/geometry.js';

const parcels = makeParcels();

function expectedHits(radiusM) {
  const proj = makeProjector([ALLENMORE.lon, ALLENMORE.lat]);
  return parcels.filter((f) => distanceFromOriginToPolygons(projectPolygons(proj, { type: 'Polygon', coordinates: [f.ring] })) <= radiusM);
}

const hashFor = (r = 250, u = 'yd') => `/#lat=${ALLENMORE.lat}&lon=${ALLENMORE.lon}&r=${r}&u=${u}`;

test.describe('radius study', () => {
  test('numbers and tabulates every parcel touching a 250 yard ring', async ({ page }) => {
    const log = await installMockArcGIS(page, { parcels });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(hashFor());
    const expected = expectedHits(toMeters(250, 'yd'));
    await expect(page.locator('#results-meta')).toContainText(`${expected.length} parcels intersect the ring`, { timeout: 20000 });
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(expected.length);
    await expect(page.locator('.pnum')).toHaveCount(expected.length);
    // IDs are 1..n in distance order; the parcel containing the pin is #1 and is MultiCare owned
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first.locator('td.id')).toHaveText('1');
    await expect(first).toHaveClass(/mc-owned/);
    await expect(first).toContainText('MULTICARE HEALTH SYSTEMS');
    // Use description came from the Pierce County enrichment join (the Tacoma layer only has a code)
    const centre = parcels.find((p) => p.owner === 'MULTICARE HEALTH SYSTEMS');
    await expect(first).toContainText(centre.desc);
    await expect(first.locator('td').nth(2)).toHaveText(centre.taxable.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
    await expect(page.locator('#results-meta')).toContainText('MultiCare-affiliated');
    // The taxable-value column shows currency and the total row is present
    await expect(page.locator('table.parcels tfoot td').nth(0)).toHaveText(String(expected.length));
    await expect(page.locator('table.parcels tfoot td').nth(2)).toContainText('$');
    // Data source panel lists both Pierce sources online with field mapping
    await expect(page.locator('#sources .source').first()).toContainText('online');
    await expect(page.locator('#sources')).toContainText('TAXPAYERNAME');
    await expect(page.locator('#sources')).toContainText('Landuse_Description');
    // Legend counts
    await expect(page.locator('#legend')).toContainText(`Parcel in study (${expected.length})`);
    await expect(page.locator('#legend')).toContainText('MultiCare owned (');
    // Ring + pin exist
    expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(0);
    await expect(page.locator('.pin-icon')).toHaveCount(1);
    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
    expect(log.tacoma.some((r) => r.url.includes('/query'))).toBe(true);
    expect(log.pierce.some((r) => r.params.returnGeometry === 'false')).toBe(true);
  });

  test('radius and unit changes re-run the study and unit conversion keeps the ring size', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto(hashFor());
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(expectedHits(toMeters(250, 'yd')).length, { timeout: 20000 });
    await page.fill('#radius', '150');
    await page.dispatchEvent('#radius', 'input');
    const n150 = expectedHits(toMeters(150, 'yd')).length;
    await expect(page.locator('#results-meta')).toContainText(`${n150} parcel`, { timeout: 15000 });
    await expect(page.locator('#results-title')).toHaveText('Parcels within 150 yards');
    // switching units converts the value (150 yd = 450 ft) and keeps the same parcel count
    await page.selectOption('#unit', 'ft');
    await expect(page.locator('#radius')).toHaveValue('450');
    await expect(page.locator('#results-title')).toHaveText('Parcels within 450 feet');
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n150);
    // preset chip
    await page.click('.presets .chip[data-radius="0.25"]');
    await expect(page.locator('#results-title')).toHaveText('Parcels within 0.25 miles');
    const nQuarter = expectedHits(toMeters(0.25, 'mi')).length;
    await expect(page.locator('#results-meta')).toContainText(`${nQuarter} parcels`, { timeout: 15000 });
  });

  test('ring style controls change the drawn ring', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto(hashFor());
    await expect(page.locator('table.parcels tbody tr').first()).toBeVisible({ timeout: 20000 });
    const ring = () => page.evaluate(() => {
      const l = window.__parcelApp.state.ringLayer;
      return { color: l.options.color, weight: l.options.weight, dash: l.options.dashArray, fill: l.options.fill, fillOpacity: l.options.fillOpacity, n: l.getLatLngs()[0].length };
    });
    const before = await ring();
    expect(before.color.toLowerCase()).toBe('#17e88f');
    expect(before.n).toBe(128);
    await page.fill('#ring-color', '#003f2d');
    await page.dispatchEvent('#ring-color', 'input');
    await page.selectOption('#ring-dash', 'dashed');
    await page.dispatchEvent('#ring-dash', 'input');
    await page.fill('#ring-weight', '8');
    await page.dispatchEvent('#ring-weight', 'input');
    await page.check('#ring-fill');
    await page.dispatchEvent('#ring-fill', 'input');
    const after = await ring();
    expect(after.color.toLowerCase()).toBe('#003f2d');
    expect(after.weight).toBe(8);
    expect(after.dash).toBe('24 16');
    expect(after.fill).toBe(true);
    // SVG path reflects the style
    const path = page.locator('.leaflet-overlay-pane path[stroke="#003f2d"]');
    await expect(path).toHaveAttribute('stroke-dasharray', '24 16');
  });

  test('coordinates entered as an address place the pin; clear removes everything', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto('/');
    await page.fill('#address', `${ALLENMORE.lat}, ${ALLENMORE.lon}`);
    await page.click('#btn-locate');
    await expect(page.locator('table.parcels tbody tr').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#pin-info')).toContainText('47.2418');
    expect(page.url()).toContain('lat=47.2418');
    await page.click('#btn-clear');
    await expect(page.locator('.pin-icon')).toHaveCount(0);
    await expect(page.locator('.pnum')).toHaveCount(0);
    await expect(page.locator('#table-wrap .empty')).toBeVisible();
  });

  test('falls back to the county open-data layer when the city layer is down, then to the State layer', async ({ page }) => {
    await installMockArcGIS(page, { parcels, fail: new Set([TACOMA_URL]) });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    await expect(page.locator('#sources')).toContainText('unavailable');
    await expect(page.locator('#sources')).toContainText('Tax Parcels (Pierce County Open GeoSpatial Data Portal)');
    // Individuals' names are not published on the county layer, business names are
    await expect(page.locator('table.parcels tbody')).toContainText('not published');
    await expect(page.locator('table.parcels tbody')).toContainText('Ventas REIT');
  });

  test('statewide layer serves parcels when no county source responds', async ({ page }) => {
    await installMockArcGIS(page, { parcels, fail: new Set([TACOMA_URL, PIERCE_URL]) });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    await expect(page.locator('#sources')).toContainText('Current Parcels (Parcels_2026)');
    await expect(page.locator('#sources')).toContainText('does not publish owner names');
    // Values fall back to market land + building and are flagged with *
    await expect(page.locator('table.parcels tbody tr').first().locator('td').nth(2)).toContainText('*');
    // DOR land use code decoded to text
    await expect(page.locator('table.parcels tbody')).toContainText('Professional services');
  });

  test('CSV export includes every listed parcel with owner, value, acres and use', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    const lines = text.trim().split(/\r?\n/);
    expect(lines.length).toBe(n + 1);
    expect(lines[0]).toContain('ID,Owner,Owner note,Parcel #,Site address,City,County,Value,Value type');
    expect(lines[1]).toContain('MULTICARE HEALTH SYSTEMS');
    expect(lines[1]).toContain('MultiCare owned');
  });

  test('cancelling an in-flight study does not demote the primary owner-bearing layer', async ({ page }) => {
    const log = await installMockArcGIS(page, { parcels, delayMs: 350 });
    await page.goto(hashFor());
    // Re-run the study twice while the first metadata request is still in flight.
    await page.waitForTimeout(80);
    await page.fill('#radius', '200');
    await page.dispatchEvent('#radius', 'input');
    await page.waitForTimeout(60);
    await page.fill('#radius', '220');
    await page.dispatchEvent('#radius', 'input');
    const n = expectedHits(toMeters(220, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 30000 });
    await expect(page.locator('table.parcels tbody tr').first()).toContainText('MULTICARE HEALTH SYSTEMS');
    await expect(page.locator('#sources')).not.toContainText('unavailable');
    await expect(page.locator('#sources')).toContainText('TAXPAYERNAME');
    // metadata for the Tacoma layer was fetched exactly once despite the cancellations
    expect(log.tacoma.filter((r) => !r.url.includes('/query')).length).toBe(1);
  });

  test('a hash without coordinates does not drop a pin at 0,0 and typed radii are not clobbered', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto('/#r=500&u=yd');
    await page.waitForTimeout(500);
    await expect(page.locator('.pin-icon')).toHaveCount(0);
    // typing "0." then "0.5" in miles must not snap back
    await page.selectOption('#unit', 'mi');
    await page.fill('#radius', '0.');
    await page.dispatchEvent('#radius', 'input');
    await page.fill('#radius', '0.5');
    await page.dispatchEvent('#radius', 'input');
    await expect(page.locator('#radius')).toHaveValue('0.5');
    expect(await page.evaluate(() => window.__parcelApp.state.ring)).toMatchObject({ radius: 0.5, unit: 'mi' });
  });

  test('parcels in view load at zoom 15+ and popups show assessor detail', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto('/');
    await page.evaluate(({ lat, lon }) => window.__parcelApp.state.map.setView([lat, lon], 17), ALLENMORE);
    await page.waitForFunction(() => window.__parcelApp.state.view.records.size > 0, null, { timeout: 20000 });
    const count = await page.evaluate(() => window.__parcelApp.state.view.records.size);
    expect(count).toBeGreaterThan(50);
    // click the centre of the map -> popup for the MultiCare parcel
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.leaflet-popup .popup')).toBeVisible();
    await expect(page.locator('.leaflet-popup .popup')).toContainText('MULTICARE HEALTH SYSTEMS');
    await expect(page.locator('.leaflet-popup .popup')).toContainText('Taxable value');
    await expect(page.locator('.leaflet-popup .popup a')).toHaveAttribute('href', /atip\.piercecountywa\.gov/);
  });
});
