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

test('placeholder and out-of-range dates are treated as no sale', () => {
  for (const v of ['0', 0, '00/00/0000', '00000000', '1/1/1900', '01/01/1900', 19000101, '0000-00-00', '13/45/2020', 1e11 - 1, 99999999999, -5, 'Foo-2026']) {
    assert.equal(toISODate(v), null, `value ${JSON.stringify(v)}`);
  }
  // month precision stays month precision
  assert.equal(toISODate('2026-06'), '2026-06');
  assert.equal(toISODate('Sept-2026'), '2026-09');
  assert.equal(toISODate('September 2026'), '2026-09');
  // epoch seconds from the 1990s and numeric strings
  assert.equal(toISODate(946684800), '2000-01-01');
  assert.equal(toISODate('1718409600'), '2024-06-15');
  assert.equal(toISODate(1e11), '1973-03-03');
  // pre-1973 values on a Date-typed field
  assert.equal(toISODate(63072000000, { epochMs: true }), '1972-01-01');
  assert.equal(toISODate(-86400000, { epochMs: true }), '1969-12-31');
  // far-future years are placeholders too
  assert.equal(toISODate('12/31/9999'), null);
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
