// Id-list joins and the static extract join, driven through ParcelService with a stubbed
// fetch (Node 22) and a custom static loader.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ParcelService } from '../../js/parcels.js';

const counties = JSON.parse(await readFile(new URL('../../data/wa_counties.json', import.meta.url), 'utf8'));
const F = (name, type = 'esriFieldTypeString', length = 50) => ({ name, type, alias: name, length });

/** Installs a fetch stub serving one ArcGIS table layer: metadata plus WHERE ... IN (...) queries. */
function stubLayer(url, { fields, rows, keyField, pageSize = 1000 }) {
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input));
    const params = new URLSearchParams(u.search);
    if (init.method === 'POST') for (const [k, v] of new URLSearchParams(init.body || '')) params.set(k, v);
    requests.push({ url: u.href, method: init.method || 'GET', params: Object.fromEntries(params) });
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!u.pathname.endsWith('/query')) {
      return json({ id: 11, name: 'Sales', type: 'Table', objectIdField: 'OBJECTID', maxRecordCount: pageSize, supportedQueryFormats: 'JSON', capabilities: 'Query', advancedQueryCapabilities: { supportsPagination: true }, fields: [F('OBJECTID', 'esriFieldTypeOID'), ...fields] });
    }
    const where = params.get('where') || '';
    const m = where.match(/^(\w+) IN \((.*)\)$/);
    assert.ok(m, `where clause ${where}`);
    assert.equal(m[1], keyField);
    const wanted = new Set(m[2].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1').replace(/''/g, "'")));
    const subset = rows.filter((r) => wanted.has(String(r[keyField])));
    return json({ objectIdFieldName: 'OBJECTID', features: subset.map((r, i) => ({ attributes: { OBJECTID: i + 1, ...r } })), exceededTransferLimit: false });
  };
  return requests;
}

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const provider = { key: 'test', name: 'Test County', counties: ['Yakima'], sources: [] };
const prepared = (ids) => ids.map((id, i) => ({ f: { id: i + 1, properties: { PARC: id } }, merged: { parcel_id: id, _sourceFields: {}, _notes: {} } }));

test('id-list join chunks ids, quotes strings, keeps the latest sale and reads Esri dates as milliseconds', async () => {
  const url = 'https://example.test/arcgis/rest/services/Assessor/Sales/FeatureServer/11';
  const ids = Array.from({ length: 150 }, (_, i) => `1813${String(i).padStart(5, '0')}-${i % 3}`);
  const rows = [
    { ASSESSOR_N: ids[0], DOCUMENT_D: 63072000000, GROSS_SALE: 100000, GRANTEE: 'OLD BUYER' },
    { ASSESSOR_N: ids[0], DOCUMENT_D: 1718409600000, GROSS_SALE: 0, GRANTEE: "O'BRIEN TRUST" },
    { ASSESSOR_N: ids[149], DOCUMENT_D: 1500000000000, GROSS_SALE: 350000, GRANTEE: 'BUYER Z' },
    { ASSESSOR_N: 'not-requested', DOCUMENT_D: 1500000000000, GROSS_SALE: 1, GRANTEE: 'X' },
  ];
  const requests = stubLayer(url, { keyField: 'ASSESSOR_N', rows, fields: [F('ASSESSOR_N'), F('DOCUMENT_D', 'esriFieldTypeDate'), F('GROSS_SALE', 'esriFieldTypeDouble'), F('GRANTEE')] });
  const source = { id: 'test-sales', enrich: true, joinBy: 'ids', joinField: 'ASSESSOR_N', name: 'Sales', url, fields: { parcel_id: ['ASSESSOR_N'], sale_date: ['DOCUMENT_D'], sale_price: ['GROSS_SALE'], legal_owner: ['GRANTEE'], owner: false, situs_address: false, use_code: false, use_description: false } };
  const service = new ParcelService({ counties });
  const statuses = [];
  const res = await service.fetchIdEnrich(provider, source, prepared(ids), 'Yakima', (s) => statuses.push(s), undefined);
  const queries = requests.filter((r) => r.url.includes('/query'));
  // 150 raw ids + 150 bare (punctuation stripped) ids -> 3 chunks of 100
  assert.equal(queries.length, 3);
  assert.ok(queries.every((q) => q.method === 'POST'), 'long id lists are POSTed');
  assert.ok(queries[0].params.where.includes(`'${ids[0]}'`));
  const rec = res.byId.get(ids[0].replace(/[^0-9A-Za-z]/g, '').toUpperCase());
  assert.equal(rec.sale_date, '2024-06-15');
  assert.equal(rec.sale_price, 0);
  assert.equal(rec.legal_owner, "O'BRIEN TRUST");
  assert.equal(rec.valid_sale_date, '1972-01-01'); // pre-1973 epoch ms on a Date field
  assert.equal(rec.valid_sale_price, 100000);
  assert.equal(res.byId.get(ids[149].replace(/[^0-9A-Za-z]/g, '').toUpperCase()).legal_owner, 'BUYER Z');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].ok, true);
  assert.equal(statuses[0].role, 'enrich');
  assert.equal(statuses[0].count, 3);
  assert.equal(statuses[0].joined, 2);
});

test('id-list join against a numeric key field drops non-numeric ids and quotes nothing', async () => {
  const url = 'https://example.test/arcgis/rest/services/Assessor/SalesNum/FeatureServer/1';
  const rows = [{ PID: 12345, SaleDate: 1718409600000, SalePrice: 42 }];
  const requests = stubLayer(url, { keyField: 'PID', rows, fields: [F('PID', 'esriFieldTypeInteger'), F('SaleDate', 'esriFieldTypeDate'), F('SalePrice', 'esriFieldTypeDouble')] });
  const source = { id: 'test-num', enrich: true, joinBy: 'ids', name: 'Sales', url, fields: { parcel_id: ['PID'], owner: false, situs_address: false } };
  const service = new ParcelService({ counties });
  const res = await service.fetchIdEnrich(provider, source, prepared(['12345', 'P-99']), 'Yakima', () => {}, undefined);
  const q = requests.find((r) => r.url.includes('/query'));
  assert.equal(q.method, 'GET');
  assert.equal(q.params.where, 'PID IN (12345)');
  assert.equal(res.byId.get('12345').sale_price, 42);
});

test('a table without a resolvable parcel id field is reported as unavailable, not thrown', async () => {
  const url = 'https://example.test/arcgis/rest/services/Assessor/Weird/FeatureServer/0';
  stubLayer(url, { keyField: 'X', rows: [], fields: [F('SaleDate', 'esriFieldTypeDate'), F('SalePrice', 'esriFieldTypeDouble')] });
  const source = { id: 'test-weird', enrich: true, joinBy: 'ids', name: 'Weird', url, fields: { owner: false } };
  const statuses = [];
  const res = await new ParcelService({ counties }).fetchIdEnrich(provider, source, prepared(['1']), 'Yakima', (s) => statuses.push(s), undefined);
  assert.equal(res, null);
  assert.equal(statuses[0].ok, false);
  assert.match(statuses[0].error, /parcel id field/);
});

test('static extract join spans several shards and survives one shard failing', async () => {
  const loads = [];
  const loader = async (p) => {
    loads.push(p);
    if (p.endsWith('manifest.json')) return { generated: '2026-09-21T00:00:00Z', prefixLength: 4, shards: ['0220', '2009'], fields: {} };
    if (p.endsWith('0220.json')) return { '0220163009': { legal_owner: 'MULTICARE HEALTH SYSTEM', sale_date: '2020-06-15', sale_price: 12000000, sale_valid: 1, exemption: 'Non Profit Hospital' } };
    if (p.endsWith('2009.json')) { const e = new Error('HTTP 500'); e.code = 500; throw e; }
    const e = new Error('not found'); e.code = 404; throw e;
  };
  const service = new ParcelService({ counties, staticLoader: loader });
  const source = { id: 'test-extract', enrich: true, name: 'Extract', url: 'https://example.test/downloads', static: { manifest: 'data/x/manifest.json', shard: 'data/x/shards/{prefix}.json', prefixLength: 3 }, override: ['exemption'] };
  const statuses = [];
  const res = await service.fetchStaticEnrich(provider, source, prepared(['0220163009', '2009400010', '9999000001', '12']), 'Pierce', (s) => statuses.push(s), undefined);
  // manifest prefix length (4) overrides the source's 3; the unlisted 9999 shard is skipped
  assert.deepEqual(loads.filter((p) => p.includes('shards/')).sort(), ['data/x/shards/0220.json', 'data/x/shards/2009.json']);
  assert.equal(res.byId.get('0220163009').legal_owner, 'MULTICARE HEALTH SYSTEM');
  assert.deepEqual(res.byId.get('0220163009')._override, ['exemption']);
  assert.equal(statuses[0].ok, true);
  assert.equal(statuses[0].role, 'static');
  assert.equal(statuses[0].joined, 1);
  assert.equal(statuses[0].failedShards, 1);
  assert.match(statuses[0].note, /1 of 3 shard/);
});

test('a missing static manifest is reported with a pointer to the data workflow', async () => {
  const loader = async () => { const e = new Error('HTTP 404'); e.code = 404; throw e; };
  const service = new ParcelService({ counties, staticLoader: loader });
  // (static files are cached per path across services, so this manifest has its own path)
  const source = { id: 'test-extract', enrich: true, name: 'Extract', static: { manifest: 'data/missing/manifest.json', shard: 'data/missing/shards/{prefix}.json', prefixLength: 4 } };
  const statuses = [];
  const res = await service.fetchStaticEnrich(provider, source, prepared(['0220163009']), 'Pierce', (s) => statuses.push(s), undefined);
  assert.equal(res, null);
  assert.equal(statuses[0].ok, false);
  assert.match(statuses[0].error, /weekly data workflow/);
});
