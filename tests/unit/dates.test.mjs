import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toISODate, resolveFieldMap } from '../../js/fields.js';

test('assessor dates normalize to ISO', () => {
  assert.equal(toISODate(1718409600000), '2024-06-15');
  assert.equal(toISODate('06/15/2024'), '2024-06-15');
  assert.equal(toISODate('2024-06-15T00:00:00'), '2024-06-15');
  assert.equal(toISODate('20240615'), '2024-06-15');
  assert.equal(toISODate(20240615), '2024-06-15');
  assert.equal(toISODate('Jun-2026'), '2026-06');
  assert.equal(toISODate(2019), '2019');
  assert.equal(toISODate(''), null);
  assert.equal(toISODate('n/a'), null);
});

test('zoning, sale and legal owner heuristics pick the right fields', () => {
  const mk = (names) => ({ fields: names.map((n) => (typeof n === 'string' ? { name: n, alias: n, type: 'esriFieldTypeString' } : n)) });
  const info = mk([
    'PIN', 'KCTP_NAME', 'KCA_ZONING', 'ZoneDesc', 'SaleDate', { name: 'SaleAmount', type: 'esriFieldTypeDouble' }, 'SaleExcise',
    'title_owner_name_full', 'tax_payer_name_full', 'Grantor', 'AppraisalDate', 'FloodZone', 'SchoolZone',
  ]);
  const { map } = resolveFieldMap(info);
  assert.equal(map.zoning, 'KCA_ZONING');
  assert.equal(map.zoning_description, 'ZoneDesc');
  assert.equal(map.sale_date, 'SaleDate');
  assert.equal(map.sale_price, 'SaleAmount');
  assert.equal(map.legal_owner, 'title_owner_name_full');
  assert.equal(map.owner, 'tax_payer_name_full');
  assert.equal(map.sale_grantor, 'Grantor');
});
