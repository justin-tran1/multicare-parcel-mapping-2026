// Field mapping of registry sources against the schemas documented in the research notes:
// a trimmed `false` flag or a renamed county field must fail here, not in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../../js/providers.js';
import { resolveFieldMap } from '../../js/fields.js';

const S = (name, type = 'esriFieldTypeString', length = 50) => ({ name, alias: name, type, length });
const D = (name) => S(name, 'esriFieldTypeDate');
const N = (name) => S(name, 'esriFieldTypeDouble');
const sourceById = (id) => {
  const s = PROVIDERS.flatMap((p) => p.sources).find((x) => x.id === id);
  assert.ok(s, `source ${id}`);
  return s;
};
const pick = (map, keys) => Object.fromEntries(keys.map((k) => [k, map[k]]));

test('King County sales layer: buyer is the legal owner, seller the grantor, nothing else leaks', () => {
  const info = { fields: [S('OBJECTID', 'esriFieldTypeOID'), S('PIN'), S('address'), S('ExciseTaxNum'), D('SaleDate'), N('SalePrice'), S('RecNumber'), S('Sellername'), S('buyername'), S('Property_Type'), S('Principal_Use'), S('Property_Class')] };
  const { map } = resolveFieldMap(info, sourceById('king-parcel-sales-3yr').fields);
  assert.deepEqual(pick(map, ['parcel_id', 'sale_date', 'sale_price', 'sale_grantor', 'legal_owner', 'owner', 'situs_address', 'use_code', 'use_description', 'taxable_value']), {
    parcel_id: 'PIN', sale_date: 'SaleDate', sale_price: 'SalePrice', sale_grantor: 'Sellername', legal_owner: 'buyername', owner: null, situs_address: null, use_code: null, use_description: null, taxable_value: null,
  });
});

test('Spokane SCOUT property lookup: owner, document date and gross sale price, not the excise number', () => {
  const info = { fields: [S('OBJECTID', 'esriFieldTypeOID'), S('PID_NUM'), S('site_address'), S('site_city'), S('owner_name'), D('document_date'), N('gross_sale_price'), S('excise_nbr'), S('transfer_type'), S('prop_use_desc'), S('tax_code_area'), N('acreage'), S('InspectionYear', 'esriFieldTypeInteger')] };
  const { map } = resolveFieldMap(info, sourceById('spokane-scout-property-lookup').fields);
  assert.deepEqual(pick(map, ['parcel_id', 'owner', 'sale_date', 'sale_price', 'sale_deed_type', 'use_description', 'land_acres', 'zoning', 'exemption']), {
    parcel_id: 'PID_NUM', owner: 'owner_name', sale_date: 'document_date', sale_price: 'gross_sale_price', sale_deed_type: 'transfer_type', use_description: 'prop_use_desc', land_acres: 'acreage', zoning: null, exemption: null,
  });
});

test('Whatcom property layer: taxpayer and title owner are distinct, with and without the *_full fields', () => {
  const src = sourceById('whatcom-property-parcels');
  const full = { fields: [S('prop_id'), S('geo_id'), S('tax_payer_id'), S('tax_payer_name'), S('tax_payer_name_full'), S('tax_payer_add_full'), S('title_owner_id'), S('title_owner_name'), S('title_owner_name_full'), S('title_owner_line1'), S('situs_num'), S('situs_street'), S('situs_city'), N('market_land_val'), N('market_improvement_val'), N('appraised_val_total'), N('taxable_val_total'), N('legal_acreage'), S('property_use_cd'), S('property_use_description')] };
  let { map } = resolveFieldMap(full, src.fields);
  assert.equal(map.owner, 'tax_payer_name_full');
  assert.equal(map.legal_owner, 'title_owner_name_full');
  assert.equal(map.owner_address, 'tax_payer_add_full');
  assert.equal(map.taxable_value, 'taxable_val_total');
  assert.equal(map.total_value, 'appraised_val_total');
  const trimmed = { fields: full.fields.filter((f) => !f.name.endsWith('_full')) };
  ({ map } = resolveFieldMap(trimmed, src.fields));
  assert.equal(map.owner, 'tax_payer_name');
  assert.equal(map.legal_owner, 'title_owner_name');
  assert.notEqual(map.owner_address, 'title_owner_line1', 'the title owner’s mailing line is not the taxpayer address');
});

test('Snohomish recent sales, Yakima sales and Skagit parcels map their sale fields', () => {
  let { map } = resolveFieldMap({ fields: [S('OBJECTID', 'esriFieldTypeOID'), S('PARCEL_ID'), N('SALE_PRICE'), S('YEAR_SOLD', 'esriFieldTypeInteger'), S('TRNSF_DATE')] }, sourceById('snoco-recent-sales').fields);
  assert.deepEqual(pick(map, ['parcel_id', 'sale_date', 'sale_price', 'owner']), { parcel_id: 'PARCEL_ID', sale_date: 'TRNSF_DATE', sale_price: 'SALE_PRICE', owner: null });
  ({ map } = resolveFieldMap({ fields: [S('OBJECTID', 'esriFieldTypeOID'), S('ASSESSOR_N'), S('EXCISE_NUM'), N('GROSS_SALE'), S('DOCUMENT_D'), S('YEAR', 'esriFieldTypeInteger'), S('USE_CODE'), S('PORTION_IN')] }, sourceById('yakima-sales').fields));
  assert.deepEqual(pick(map, ['parcel_id', 'sale_date', 'sale_price']), { parcel_id: 'ASSESSOR_N', sale_date: 'DOCUMENT_D', sale_price: 'GROSS_SALE' });
  ({ map } = resolveFieldMap({ fields: [S('OBJECTID', 'esriFieldTypeOID'), S('PARCELID'), S('OwnerName'), S('OwnerAdd1'), S('SitusStNo'), S('SitusStName'), S('SitusCSZ'), N('TaxableValue'), N('BuildingValue'), N('ImprLandValue'), N('UnimprLandValue'), N('TimberLandValue'), N('TotalMktValue'), N('Acres'), S('LandUse'), D('SaleDate'), S('SalePrice'), S('SaleDeedType'), S('SaleExcise')] }, sourceById('skagit-tax-parcels').fields));
  assert.deepEqual(pick(map, ['owner', 'taxable_value', 'sale_date', 'sale_price', 'sale_deed_type']), { owner: 'OwnerName', taxable_value: 'TaxableValue', sale_date: 'SaleDate', sale_price: 'SalePrice', sale_deed_type: 'SaleDeedType' });
});

test('every registry source has an id, a name and either a url or a portal item', () => {
  for (const p of PROVIDERS) {
    for (const s of p.sources) {
      assert.ok(s.id && s.name, `${p.key} source without id/name`);
      assert.ok(s.url || s.item?.id || s.static, `${s.id} has no url, item or static extract`);
    }
    for (const z of p.zoning || []) {
      assert.ok(z.id && z.name && (z.url || z.item?.id), `${p.key} zoning source ${z.id} incomplete`);
      if (z.extent) assert.ok(z.extent[0] < z.extent[2] && z.extent[1] < z.extent[3], `${z.id} extent is not min/max ordered`);
    }
  }
});
