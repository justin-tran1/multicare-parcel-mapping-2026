import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putEnrich, mergeAttrs } from '../../js/parcels.js';
import { resolveFieldMap, toISODate } from '../../js/fields.js';

const row = (o) => ({ _sourceFields: Object.fromEntries(Object.keys(o).map((k) => [k, k.toUpperCase()])), _notes: {}, _sourceName: 'sales', ...o });

test('the buyer follows the most recent sale whatever order the rows arrive in', () => {
  const byId = new Map();
  // newest row first, then an older one, then the middle one
  putEnrich(byId, '0492500240', row({ parcel_id: '0492500240', sale_date: '2025-02-10', sale_price: 0, sale_grantor: 'A', legal_owner: 'B', sale_deed_type: 'Quit Claim' }));
  putEnrich(byId, '0492500240', row({ parcel_id: '0492500240', sale_date: '2019-06-01', sale_price: 900000, sale_grantor: 'Z', legal_owner: 'X' }));
  putEnrich(byId, '0492500240', row({ parcel_id: '0492500240', sale_date: '2023-04-01', sale_price: 1200000, sale_grantor: 'X', legal_owner: 'A' }));
  const r = byId.get('0492500240');
  assert.equal(r.sale_date, '2025-02-10');
  assert.equal(r.legal_owner, 'B'); // buyer of the latest deed, not of the first row seen
  assert.equal(r.sale_grantor, 'A');
  assert.equal(r.sale_deed_type, 'Quit Claim');
  // the $0 transfer is qualified by the latest priced sale
  assert.equal(r.valid_sale_date, '2023-04-01');
  assert.equal(r.valid_sale_price, 1200000);
});

test('a title-owner field without a sale date is an ordinary first-fill attribute', () => {
  const byId = new Map();
  putEnrich(byId, 'P1', row({ parcel_id: 'P1', legal_owner: 'TITLE HOLDER LLC' }));
  putEnrich(byId, 'P1', row({ parcel_id: 'P1', legal_owner: 'OTHER' }));
  assert.equal(byId.get('P1').legal_owner, 'TITLE HOLDER LLC');
});

test('merging a newer sale into the primary replaces the whole transaction, including the buyer', () => {
  const primary = { parcel_id: 'P1', owner: 'TAXPAYER', sale_date: '2010-01-01', sale_price: 250000, sale_grantor: 'OLD SELLER', legal_owner: null, _sourceFields: {}, _notes: {} };
  const extra = row({ parcel_id: 'P1', sale_date: '2024-05-01', sale_price: 0, sale_grantor: 'TAXPAYER', legal_owner: 'TAXPAYER FAMILY TRUST', sale_deed_type: 'Quit Claim Deed' });
  extra._notes = { legal_owner: 'buyer on the most recent recorded sale' };
  const out = mergeAttrs(primary, [extra]);
  assert.equal(out.sale_date, '2024-05-01');
  assert.equal(out.sale_price, 0);
  assert.equal(out.legal_owner, 'TAXPAYER FAMILY TRUST');
  assert.equal(out._notes.legal_owner, 'buyer on the most recent recorded sale');
  assert.equal(out.owner, 'TAXPAYER');
  // the primary's priced sale is kept as the last market sale
  assert.equal(out.valid_sale_date, '2010-01-01');
  assert.equal(out.valid_sale_price, 250000);
  // an older extra never overwrites the primary's newer sale
  const out2 = mergeAttrs({ ...primary, sale_date: '2026-01-01', sale_price: 0 }, [row({ parcel_id: 'P1', sale_date: '2020-01-01', sale_price: 500000, legal_owner: 'OLD BUYER' })]);
  assert.equal(out2.sale_date, '2026-01-01');
  assert.equal(out2.legal_owner, null);
  assert.equal(out2.valid_sale_date, '2020-01-01');
});

test('the last market sale is found whatever order the enrichers arrive in', () => {
  const primary = { parcel_id: 'P1', owner: 'TAXPAYER', _sourceFields: {}, _notes: {} };
  const priced = row({ parcel_id: 'P1', sale_date: '2020-01-01', sale_price: 500000, legal_owner: 'BUYER A' });
  const unpriced = row({ parcel_id: 'P1', sale_date: '2024-05-01', sale_price: 0, legal_owner: 'BUYER A TRUST' });
  for (const extras of [[priced, unpriced], [unpriced, priced]]) {
    const out = mergeAttrs(primary, extras);
    assert.equal(out.sale_date, '2024-05-01');
    assert.equal(out.legal_owner, 'BUYER A TRUST');
    assert.equal(out.valid_sale_date, '2020-01-01');
    assert.equal(out.valid_sale_price, 500000);
  }
  // a priced latest sale needs no qualifier
  const out = mergeAttrs(primary, [unpriced, row({ parcel_id: 'P1', sale_date: '2025-01-01', sale_price: 700000, legal_owner: 'BUYER B' })]);
  assert.equal(out.valid_sale_date, undefined);
  assert.equal(out.legal_owner, 'BUYER B');
  // an explicit valid sale from the extract is kept as supplied
  const ext = row({ parcel_id: 'P1', sale_date: '2024-05-01', sale_price: 0, legal_owner: 'T', valid_sale_date: '2010-03-02', valid_sale_price: 250000, sale_valid: 0, sale_exclude_reason: 'Living Trust' });
  const out2 = mergeAttrs(primary, [priced, ext]);
  assert.equal(out2.valid_sale_date, '2010-03-02');
  assert.equal(out2.sale_exclude_reason, 'Living Trust');
  // sale metadata never outlives the sale it describes
  const out3 = mergeAttrs({ ...primary, sale_date: '2026-02-10', sale_price: 900000 }, [ext]);
  assert.equal(out3.sale_date, '2026-02-10');
  assert.equal(out3.sale_exclude_reason, undefined);
  assert.equal(out3.sale_valid, undefined);
});

test('zoning, sale price and exemption heuristics reject look-alike fields', () => {
  const mk = (fields) => ({ fields: fields.map((f) => (typeof f === 'string' ? { name: f, alias: f, type: 'esriFieldTypeString', length: 50 } : { alias: f.name, type: 'esriFieldTypeString', length: 50, ...f })) });
  let { map } = resolveFieldMap(mk(['PARCEL_NO', 'OWNER_NAME', 'TAX_ZONE', 'UTM_ZONE', 'FLOOD_ZONE', 'TAXZONE', 'ZONE_ACRES']));
  assert.equal(map.zoning, null);
  ({ map } = resolveFieldMap(mk(['PIN', 'ZONING_ORD', 'ZONING', 'ZONE_AREA'])));
  assert.equal(map.zoning, 'ZONING');
  ({ map } = resolveFieldMap(mk(['PIN', 'SALE_VALID', 'SALE_DT', 'EXCISE_AMOUNT', 'SALE_QUAL'])));
  assert.equal(map.sale_price, null);
  assert.equal(map.sale_date, 'SALE_DT');
  ({ map } = resolveFieldMap(mk(['PIN', { name: 'EXEMPT', length: 1 }, { name: 'EXEMPT_YR', type: 'esriFieldTypeInteger' }, 'EXEMPTION_TYPE'])));
  assert.equal(map.exemption, 'EXEMPTION_TYPE');
  ({ map } = resolveFieldMap(mk(['PIN', { name: 'EXEMPT', length: 1 }])));
  assert.equal(map.exemption, null);
  ({ map } = resolveFieldMap(mk(['PIN', 'COMPANY_NAME', 'LAST_NAME'])));
  assert.equal(map.business_name, null);
});

test('esri date fields are epoch milliseconds even before 1973', () => {
  assert.equal(toISODate(63072000000, { epochMs: true }), '1972-01-01');
  assert.equal(toISODate(-86400000, { epochMs: true }), '1969-12-31');
  assert.equal(toISODate(1718409600000, { epochMs: true }), '2024-06-15');
});
