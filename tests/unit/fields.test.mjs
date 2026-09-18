import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFieldMap, toNumber } from '../../js/fields.js';

const mk = (names) => ({ fields: names.map((n) => (typeof n === 'string' ? { name: n, alias: n, type: 'esriFieldTypeString' } : n)) });

test('provider candidates win over heuristics', () => {
  const info = mk(['OBJECTID', 'TaxParcelNumber', 'Taxpayer_Name', 'Owner_Name', 'Land_Acres']);
  const { map, how } = resolveFieldMap(info, { owner: ['Owner_Name'], parcel_id: ['TaxParcelNumber'] });
  assert.equal(map.owner, 'Owner_Name');
  assert.equal(how.owner, 'provider');
  assert.equal(map.parcel_id, 'TaxParcelNumber');
  assert.equal(map.land_acres, 'Land_Acres');
  assert.equal(how.land_acres, 'heuristic');
});

test('heuristics resolve a Pierce-style assessor schema', () => {
  const info = mk([
    { name: 'OBJECTID', type: 'esriFieldTypeOID' },
    'TaxParcelNumber', 'Site_Address', 'Taxpayer_Name', 'Taxpayer_Address', 'Taxpayer_City',
    { name: 'Land_Value', type: 'esriFieldTypeDouble' }, { name: 'Improvement_Value', type: 'esriFieldTypeDouble' },
    { name: 'Total_Market_Value', type: 'esriFieldTypeDouble' }, { name: 'Taxable_Value', type: 'esriFieldTypeDouble' },
    { name: 'Land_Acres', type: 'esriFieldTypeDouble' }, 'Use_Code', 'Landuse_Description', 'Zoning_Description',
    { name: 'Shape_Area', type: 'esriFieldTypeDouble' },
  ]);
  const { map } = resolveFieldMap(info);
  assert.equal(map.parcel_id, 'TaxParcelNumber');
  assert.equal(map.owner, 'Taxpayer_Name');
  assert.equal(map.owner_address, 'Taxpayer_Address');
  assert.equal(map.situs_address, 'Site_Address');
  assert.equal(map.taxable_value, 'Taxable_Value');
  assert.equal(map.land_value, 'Land_Value');
  assert.equal(map.improvement_value, 'Improvement_Value');
  assert.equal(map.total_value, 'Total_Market_Value');
  assert.equal(map.land_acres, 'Land_Acres');
  assert.equal(map.use_code, 'Use_Code');
  assert.equal(map.use_description, 'Landuse_Description');
});

test('heuristics resolve a King County style schema', () => {
  const info = mk([
    { name: 'OBJECTID', type: 'esriFieldTypeOID' }, 'PIN', 'MAJOR', 'MINOR', 'ADDR_FULL', 'TAXPAYERNAME',
    { name: 'APPRLNDVAL', type: 'esriFieldTypeDouble' }, { name: 'APPR_IMPR', type: 'esriFieldTypeDouble' },
    { name: 'TAX_LNDVAL', type: 'esriFieldTypeDouble' }, { name: 'TAX_IMPR', type: 'esriFieldTypeDouble' },
    'PRESENTUSE', { name: 'LOTSQFT', type: 'esriFieldTypeDouble' }, 'PROPTYPE', 'KCTP_CITY',
  ]);
  const { map } = resolveFieldMap(info);
  assert.equal(map.parcel_id, 'PIN');
  assert.equal(map.owner, 'TAXPAYERNAME');
  assert.equal(map.situs_address, 'ADDR_FULL');
  assert.equal(map.land_value, 'APPRLNDVAL');
  assert.equal(map.improvement_value, 'APPR_IMPR');
  assert.equal(map.use_code, 'PRESENTUSE');
  assert.equal(map.land_sqft, 'LOTSQFT');
  assert.equal(map.situs_city, 'KCTP_CITY');
});

test('heuristics resolve the WA statewide DOR schema without an owner', () => {
  const info = mk([
    { name: 'OBJECTID', type: 'esriFieldTypeOID' }, 'COUNTY_NM', 'PARCEL_ID_NR', 'ORIG_PARCEL_ID', 'SITUS_ADDRESS', 'SITUS_CITY_NM', 'SITUS_ZIP_NR',
    { name: 'LANDUSE_CD', type: 'esriFieldTypeSmallInteger' }, { name: 'VALUE_LAND', type: 'esriFieldTypeDouble' }, { name: 'VALUE_BLDG', type: 'esriFieldTypeDouble' }, 'DATA_LINK',
  ]);
  const { map } = resolveFieldMap(info);
  assert.equal(map.owner, null);
  assert.equal(map.parcel_id, 'PARCEL_ID_NR');
  assert.equal(map.county, 'COUNTY_NM');
  assert.equal(map.situs_address, 'SITUS_ADDRESS');
  assert.equal(map.situs_city, 'SITUS_CITY_NM');
  assert.equal(map.use_code, 'LANDUSE_CD');
  assert.equal(map.land_value, 'VALUE_LAND');
  assert.equal(map.improvement_value, 'VALUE_BLDG');
  assert.equal(map.assessor_link, 'DATA_LINK');
});

test('numbers parse from formatted strings', () => {
  assert.equal(toNumber('$1,234,500'), 1234500);
  assert.equal(toNumber(12.5), 12.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber('n/a'), null);
});
