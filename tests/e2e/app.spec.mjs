import { test, expect } from '@playwright/test';
import { installMockArcGIS, makeParcels, makeZones, ALLENMORE, TACOMA_URL, PIERCE_URL, TACOMA_ZONING_URL, TACOMA_DART_URL } from './fixtures/mock-arcgis.mjs';

// both Tacoma zoning sources (hub layer and DART map service) down
const TACOMA_ZONING_DOWN = new Set([TACOMA_ZONING_URL, `${TACOMA_DART_URL}/3`]);
import { makeProjector, projectPolygons, distanceFromOriginToPolygons, toMeters } from '../../js/geometry.js';

const parcels = makeParcels();

function expectedHits(radiusM) {
  const proj = makeProjector([ALLENMORE.lon, ALLENMORE.lat]);
  return parcels.filter((f) => distanceFromOriginToPolygons(projectPolygons(proj, { type: 'Polygon', coordinates: [f.ring] })) <= radiusM);
}

const hashFor = (r = 250, u = 'yd') => `/#lat=${ALLENMORE.lat}&lon=${ALLENMORE.lon}&r=${r}&u=${u}`;
const currency = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Index of a column in the rendered table by header label. */
async function colIndex(page, label) {
  const headers = await page.locator('table.parcels thead th').allTextContents();
  const i = headers.findIndex((h) => h.replace(/[▲▼]/g, '').trim() === label);
  expect(i, `column "${label}" in ${headers.join(' | ')}`).toBeGreaterThanOrEqual(0);
  return i;
}

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
    const centre = parcels.find((p) => p.centre);
    await expect(first).toContainText(centre.desc);
    const valueCol = await colIndex(page, 'Taxable Value');
    await expect(first.locator('td').nth(valueCol)).toHaveText(currency(centre.taxable));
    // Legal owner, zoning and last sale come from the weekly extract and the zoning-district layer
    await expect(first.locator('td').nth(await colIndex(page, 'Legal Owner (deed)'))).toContainText('MULTICARE HEALTH SYSTEM');
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('HMX');
    await expect(first.locator('td').nth(await colIndex(page, 'Last Sale'))).toContainText(/\d{2}\/\d{2}\/20\d{2}/);
    await expect(first.locator('td').nth(await colIndex(page, 'Sale Price'))).toContainText('$');
    // a parcel outside the extract shows n/a for the deed fields but still has zoning
    const uncovered = expected.find((p) => !p.inExtract);
    const row = page.locator(`table.parcels tbody tr[data-key$=":${uncovered.parcel}:${uncovered.oid}"]`);
    await expect(row.locator('td').nth(await colIndex(page, 'Legal Owner (deed)'))).toHaveText('n/a');
    await expect(row.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText(/^(HMX|R2|R3)$/);
    await expect(page.locator('#results-meta')).toContainText('MultiCare-affiliated');
    // The taxable-value column shows currency and the total row is present
    await expect(page.locator('table.parcels tfoot td').nth(0)).toHaveText(String(expected.length));
    await expect(page.locator('table.parcels tfoot td').nth(valueCol)).toContainText('$');
    // Data source panel lists the Pierce sources online with field mapping, the zoning layer and the extract
    await expect(page.locator('#sources .source').first()).toContainText('online');
    await expect(page.locator('#sources')).toContainText('TAXPAYERNAME');
    await expect(page.locator('#sources')).toContainText('Landuse_Description');
    await expect(page.locator('#sources')).toContainText('zoning districts');
    await expect(page.locator('#sources')).toContainText('Zoning Districts 2025');
    await expect(page.locator('#sources')).toContainText('assessor extract');
    await expect(page.locator('#sources')).toContainText('parcels matched');
    await expect(page.locator('#sources')).not.toContainText('unavailable');
    // Legend counts
    await expect(page.locator('#legend')).toContainText(`Parcel in study (${expected.length})`);
    await expect(page.locator('#legend')).toContainText('MultiCare owned (');
    // Ring + pin exist
    expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(0);
    await expect(page.locator('.pin-icon')).toHaveCount(1);
    expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
    expect(log.tacoma.some((r) => r.url.includes('/query'))).toBe(true);
    expect(log.pierce.some((r) => r.params.returnGeometry === 'false')).toBe(true);
    expect(log.searches.some((q) => /Zoning Districts 2025/.test(q))).toBe(true);
    expect(log.items).toContain('068b1c905eb1465ab61812e9a8d1032e');
    expect(log.extract.some((u) => u.endsWith('manifest.json'))).toBe(true);
    expect(log.extract.some((u) => u.endsWith('shards/2000.json'))).toBe(true);
    // city layers elsewhere in the county are skipped by extent, never requested
    expect(log.blocked.filter((u) => /puyallup|lakewood|auburn/i.test(u))).toEqual([]);
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

  test('falls back to the county open-data layer when the city layer is down; the deed grantee stands in for withheld taxpayer names', async ({ page }) => {
    await installMockArcGIS(page, { parcels, fail: new Set([TACOMA_URL]) });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    await expect(page.locator('#sources')).toContainText('unavailable');
    await expect(page.locator('#sources')).toContainText('Tax Parcels (Pierce County Open GeoSpatial Data Portal)');
    // The county layer withholds taxpayer names: parcels in the weekly extract show the legal
    // owner (deed grantee) marked §, parcels outside it stay "not published".
    const ownerCol = await colIndex(page, 'True Owner');
    const covered = expectedHits(toMeters(250, 'yd')).find((p) => p.inExtract && p.owner === 'Ventas REIT');
    const uncovered = expectedHits(toMeters(250, 'yd')).find((p) => !p.inExtract);
    expect(covered && uncovered).toBeTruthy();
    const coveredRow = page.locator(`table.parcels tbody tr[data-key$=":${covered.parcel}:${covered.oid}"]`);
    await expect(coveredRow.locator('td').nth(ownerCol)).toContainText('Ventas REIT');
    await expect(coveredRow.locator('td').nth(ownerCol).locator('.sup')).toHaveText('§');
    const uncoveredRow = page.locator(`table.parcels tbody tr[data-key$=":${uncovered.parcel}:${uncovered.oid}"]`);
    await expect(uncoveredRow.locator('td').nth(ownerCol)).toHaveText('not published');
    // The MultiCare parcel is recognised through the deed even without a taxpayer name
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toHaveClass(/mc-owned/);
    await expect(first).toContainText('MULTICARE HEALTH SYSTEM');
    expect(await page.evaluate(() => window.__parcelApp.state.study.records[0].multicare.matchedOn)).toBe('legal owner (deed)');
    // The business name on the parcel marks it occupied but is never shown as the owner
    expect(await page.evaluate(() => window.__parcelApp.state.study.records[0].occupiedBy)).toContain('MULTICARE ALLENMORE HOSPITAL');
    await expect(first.locator('td').nth(ownerCol)).not.toContainText('ALLENMORE HOSPITAL');
  });

  test('statewide layer serves parcels when no county source responds', async ({ page }) => {
    await installMockArcGIS(page, { parcels, fail: new Set([TACOMA_URL, PIERCE_URL]) });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    await expect(page.locator('#sources')).toContainText('Current Parcels (Parcels_2026)');
    await expect(page.locator('#sources')).toContainText('does not publish taxpayer names');
    // Values fall back to market land + building and are flagged with *
    const valueCol = await colIndex(page, 'Taxable Value');
    await expect(page.locator('table.parcels tbody tr').first().locator('td').nth(valueCol)).toContainText('*');
    // DOR land use code decoded to text
    await expect(page.locator('table.parcels tbody')).toContainText('Professional services');
    // Zoning districts of the county still apply to State parcels
    await expect(page.locator('table.parcels tbody tr').first().locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('HMX');
  });

  test('zoning falls back from the city layer to the county layer, then to the statewide atlas', async ({ page }) => {
    // county layer and atlas both cover the area with different codes; the city layer is down
    const countyZones = makeZones().map((z) => ({ ...z, code: `CTY-${z.code}`, desc: `County ${z.desc}` }));
    const wazaZones = makeZones().map((z) => ({ ...z, code: `ATLAS-${z.code}`, desc: `Atlas ${z.desc}` }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installMockArcGIS(page, { parcels, fail: TACOMA_ZONING_DOWN, countyZones, wazaZones });
    await page.goto(hashFor());
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toBeVisible({ timeout: 20000 });
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('CTY-HMX');
    await expect(page.locator('#sources')).toContainText('unavailable');
    await expect(page.locator('#sources')).toContainText('Zoning Districts 2025');
    const rec = await page.evaluate(() => { const r = window.__parcelApp.state.study.records[0]; return { zoningSource: r.zoningSource, jurisdiction: r.zoningJurisdiction, desc: r.zoningDescription }; });
    expect(rec.zoningSource).toContain('unincorporated Pierce County');
    expect(rec.jurisdiction).toBe('Pierce County (unincorporated)');
    expect(rec.desc).toBe('County Hospital Medical Mixed-Use District');
    expect(errors).toEqual([]);
  });

  test('a county placeholder polygon for an incorporated city is not zoning; the atlas applies instead', async ({ page }) => {
    // observed live: the county layer covers Tacoma with one "TACO" polygon
    const countyZones = [{ ...makeZones()[0], oid: 9, code: 'TACO', desc: 'City of Tacoma' }]; // the strip through the centre parcel
    const wazaZones = makeZones().map((z) => ({ ...z, code: `ATLAS-${z.code}` }));
    await installMockArcGIS(page, { parcels, fail: TACOMA_ZONING_DOWN, countyZones, wazaZones });
    await page.goto(hashFor());
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toBeVisible({ timeout: 20000 });
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('ATLAS-HMX');
    await expect(page.locator('#sources')).toContainText('1 city placeholder skipped');
  });

  test('the statewide zoning atlas covers parcels when no jurisdiction layer does', async ({ page }) => {
    const wazaZones = makeZones().map((z) => ({ ...z, code: `ATLAS-${z.code}` }));
    await installMockArcGIS(page, { parcels, fail: TACOMA_ZONING_DOWN, wazaZones });
    await page.goto(hashFor());
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toBeVisible({ timeout: 20000 });
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('ATLAS-HMX');
    const rec = await page.evaluate(() => { const r = window.__parcelApp.state.study.records[0]; return { zoningSource: r.zoningSource, jurisdiction: r.zoningJurisdiction }; });
    expect(rec.zoningSource).toContain('Washington Zoning Atlas');
    expect(rec.jurisdiction).toBe('Tacoma'); // from the atlas polygon's Jurisdiction field
    // The exhibit footer names the zoning layer actually used
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('#btn-print');
    await page.waitForFunction(() => document.body.classList.contains('print-mode'));
    await expect(page.locator('#exhibit-footer')).toContainText('Zoning: Washington Zoning Atlas');
  });

  test('a missing weekly extract is reported and the study still completes', async ({ page }) => {
    await installMockArcGIS(page, { parcels, extract: false });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    await expect(page.locator('#sources')).toContainText('assessor extract');
    await expect(page.locator('#sources')).toContainText('weekly data workflow');
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toContainText('MULTICARE HEALTH SYSTEMS');
    await expect(first.locator('td').nth(await colIndex(page, 'Legal Owner (deed)'))).toHaveText('n/a');
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('HMX');
  });

  test('CSV export includes every listed parcel with owner, legal owner, value, acres, use, zoning and sale', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto(hashFor());
    const n = expectedHits(toMeters(250, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 20000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
    const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
    const lines = text.trim().split(/\r?\n/);
    expect(lines.length).toBe(n + 1);
    expect(lines[0]).toContain('ID,Owner,Owner source,Owner note,Legal owner (deed),Legal owner note,Business on parcel,Parcel #,Site address,City,County,Value,Value type');
    expect(lines[0]).toContain('Zoning,Zoning description,Zoning jurisdiction,Zoning source,Last sale date,Last sale price,Grantor (seller),Deed type,Sale valid (assessor)');
    expect(lines[1]).toContain('MULTICARE HEALTH SYSTEMS');
    expect(lines[1]).toContain('MULTICARE HEALTH SYSTEM'); // legal owner from the deed
    expect(lines[1]).toContain('MultiCare owned');
    expect(lines[1]).toContain('HMX');
    expect(lines[1]).toContain('Statutory Warranty Deed');
  });

  test('optional columns toggle and the print layout keeps ID, owner, value, acres, use and zoning', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto(hashFor());
    await expect(page.locator('table.parcels tbody tr').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('table.parcels thead')).toContainText('Sale Price');
    await page.uncheck('#col-sale');
    await expect(page.locator('table.parcels thead')).not.toContainText('Sale Price');
    await page.uncheck('#col-legal');
    await expect(page.locator('table.parcels thead')).not.toContainText('Legal Owner');
    await page.check('#col-parcel');
    await expect(page.locator('table.parcels thead')).toContainText('Parcel #');
    // reload keeps the choice
    await page.reload();
    await expect(page.locator('table.parcels tbody tr').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('table.parcels thead')).not.toContainText('Sale Price');
    await expect(page.locator('table.parcels thead')).toContainText('Parcel #');
  });

  test('cancelling an in-flight study does not demote the primary owner-bearing layer or lose zoning and deed data', async ({ page }) => {
    const log = await installMockArcGIS(page, { parcels, delayMs: 350 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(hashFor());
    // Re-run the study twice while the first metadata, hub-item and shard requests are in flight.
    await page.waitForTimeout(80);
    await page.fill('#radius', '200');
    await page.dispatchEvent('#radius', 'input');
    await page.waitForTimeout(60);
    await page.fill('#radius', '220');
    await page.dispatchEvent('#radius', 'input');
    const n = expectedHits(toMeters(220, 'yd')).length;
    await expect(page.locator('table.parcels tbody tr')).toHaveCount(n, { timeout: 30000 });
    const first = page.locator('table.parcels tbody tr').first();
    await expect(first).toContainText('MULTICARE HEALTH SYSTEMS');
    await expect(first.locator('td').nth(await colIndex(page, 'Zoning'))).toHaveText('HMX');
    await expect(first.locator('td').nth(await colIndex(page, 'Legal Owner (deed)'))).toContainText('MULTICARE HEALTH SYSTEM');
    await expect(page.locator('#sources')).not.toContainText('unavailable');
    await expect(page.locator('#sources')).not.toContainText('Cancelled');
    await expect(page.locator('#sources')).toContainText('TAXPAYERNAME');
    // metadata for the Tacoma layer, the zoning hub item and its layer were fetched exactly once despite the cancellations
    expect(log.tacoma.filter((r) => !r.url.includes('/query')).length).toBe(1);
    expect(log.searches.length).toBe(1);
    expect(log.tacomaZoning.filter((r) => !r.url.includes('/query')).length).toBe(1);
    expect(errors.filter((e) => !/favicon|net::ERR/.test(e)), `page errors: ${errors.join('\n')}`).toEqual([]);
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

  test('parcels in view load at zoom 15+ and popups show assessor detail incl. zoning and last sale', async ({ page }) => {
    await installMockArcGIS(page, { parcels });
    await page.goto('/');
    await page.evaluate(({ lat, lon }) => window.__parcelApp.state.map.setView([lat, lon], 17), ALLENMORE);
    await page.waitForFunction(() => window.__parcelApp.state.view.records.size > 0, null, { timeout: 20000 });
    const count = await page.evaluate(() => window.__parcelApp.state.view.records.size);
    expect(count).toBeGreaterThan(50);
    // click the centre of the map -> popup for the MultiCare parcel
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const popup = page.locator('.leaflet-popup .popup');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('MULTICARE HEALTH SYSTEMS');
    await expect(popup).toContainText('Taxable value');
    await expect(popup).toContainText('Legal owner (deed)');
    await expect(popup).toContainText('HMX');
    await expect(popup).toContainText('Hospital Medical Mixed-Use District');
    await expect(popup).toContainText('Last sale');
    await expect(popup).toContainText('Statutory Warranty Deed');
    await expect(popup).toContainText('Business on parcel');
    await expect(popup).toContainText('Non Profit Hospital');
    await expect(page.locator('.leaflet-popup .popup a')).toHaveAttribute('href', /atip\.piercecountywa\.gov/);
  });
});
