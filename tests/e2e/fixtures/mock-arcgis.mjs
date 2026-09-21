// Mock ArcGIS REST services for end-to-end tests. Generates a synthetic parcel fabric
// around a centre point and answers layer-metadata and /query requests the way the real
// Tacoma (MapServer, GeoJSON) and Pierce County (FeatureServer) layers do, plus zoning
// district layers (hub-item resolution included), the statewide zoning atlas, and the
// pre-built Pierce assessor extract (manifest + shards) served next to the page.
import { makeProjector, circleBBox } from '../../../js/geometry.js';

export const ALLENMORE = { lat: 47.2418, lon: -122.4718 };

export const TACOMA_URL = 'https://esgis.tacoma.gov/arcgis/rest/services/Ref/ITD_Basemap/MapServer/2';
export const PIERCE_URL = 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0';
export const WA_URL = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0';
export const WAZA_URL = 'https://services6.arcgis.com/tboeqGwETr5ppr5Q/arcgis/rest/services/WAZA_Prototype_Layers/FeatureServer/0';
// Hub items resolved at run time by the app -> mocked hosted layers (Tacoma is found by a
// portal search, the county layer by item id, the DART service by layer name)
export const PIERCE_ZONING_ITEM = '068b1c905eb1465ab61812e9a8d1032e';
export const TACOMA_ZONING_URL = 'https://services.arcgis.com/mockTacoma/arcgis/rest/services/Zoning_Districts_2025/FeatureServer/0';
export const TACOMA_DART_URL = 'https://gis.cityoftacoma.org/arcgis/rest/services/DART/DARTzoning/MapServer';
export const PIERCE_ZONING_URL = 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Zoning_and_Land_Use_Designations/FeatureServer/0';

const OWNERS = [
  'Healthcare Realty', 'Ventas REIT', 'NATIONWIDE HEALTH PROPERTIES INC', 'Donald Hearon DDS', 'VFW', 'Reeder Management Inc',
  'Bank of America', 'Tacoma Elks Lodge # 174', 'Thomas & Kristi Lizotte', 'Wal-Mart', 'Oliphant Real Estate Services',
  'Mercedes G McGee', 'CARE NET/Allenmore Children & Youth', 'Life Center Church & School', 'STEVEN PAIGE', 'AAA Auto Club',
  'Key Bank', 'GLORIA DEI LUTHERAN CHURCH', 'DUGAN JON', 'Home Partners of America', 'Everlast Family & Cosmetic Dentistry',
];
const USES = [['1101', 'SINGLE FAMILY DWELLING'], ['6500', 'MEDICAL OFFICE'], ['4600', 'PARKING'], ['5300', 'RETAIL'], ['1300', 'MULTI-FAMILY'], ['9100', 'VACANT LAND'], ['7200', 'CHURCH']];

const bboxOf = (ring) => [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))];

/** Builds a grid of rectangular parcels (cols x rows) of w x h metres around the centre. */
export function makeParcels({ center = ALLENMORE, cols = 12, rows = 10, w = 70, h = 55, gap = 6 } = {}) {
  const proj = makeProjector([center.lon, center.lat]);
  const features = [];
  let oid = 1;
  const totalW = cols * (w + gap);
  const totalH = rows * (h + gap);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = -totalW / 2 + c * (w + gap);
      const y0 = -totalH / 2 + r * (h + gap);
      const ring = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]].map((xy) => proj.toLngLat(xy));
      const containsCenter = x0 <= 0 && 0 <= x0 + w && y0 <= 0 && 0 <= y0 + h;
      const i = oid - 1;
      let owner = OWNERS[i % OWNERS.length];
      if (containsCenter) owner = 'MULTICARE HEALTH SYSTEMS';
      if (i === 5) owner = 'PULSE HEART INSTITUTE LLC';
      if (i === 17) owner = 'Multi-Care Health System';
      const [code, desc] = USES[i % USES.length];
      const acres = (w * h) / 4046.8564224;
      const land = 100000 + (i % 13) * 25000;
      const impr = (i % 4 === 0) ? 0 : 300000 + (i % 7) * 120000;
      features.push({
        oid,
        parcel: String(2000000000 + oid).padStart(10, '0'),
        owner,
        code,
        desc,
        acres,
        land,
        impr,
        // exempt: the hospital campus, the VFW post and churches
        taxable: owner === 'VFW' || /CHURCH/i.test(owner) || containsCenter ? 0 : land + impr,
        // the weekly assessor extract covers two parcels in three (deed grantee = legal owner)
        inExtract: oid % 3 !== 0,
        centre: containsCenter,
        x0, y0,
        ring,
        bbox: bboxOf(ring),
      });
      oid += 1;
    }
  }
  return features;
}

/** Zoning districts: a hospital/medical strip through the centre, residential north and south. */
export function makeZones({ center = ALLENMORE } = {}) {
  const proj = makeProjector([center.lon, center.lat]);
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map((xy) => proj.toLngLat(xy));
  const zones = [
    { oid: 1, code: 'HMX', desc: 'Hospital Medical Mixed-Use District', ring: rect(-1200, -120, 1200, 120) },
    { oid: 2, code: 'R3', desc: 'Two-Family Dwelling District', ring: rect(-1200, 120, 1200, 1200) },
    { oid: 3, code: 'R2', desc: 'One-Family Dwelling District', ring: rect(-1200, -1200, 1200, -120) },
  ];
  for (const z of zones) z.bbox = bboxOf(z.ring);
  return zones;
}

/** Records of the mocked weekly Pierce assessor extract, keyed by parcel number. */
export function makeExtract(parcels) {
  const records = {};
  for (const f of parcels) {
    if (!f.inExtract) continue;
    const i = f.oid - 1;
    const invalid = f.oid % 4 === 0;
    records[f.parcel] = {
      situs_address: `${1900 + f.oid} S UNION AVE`,
      use_code: f.code,
      use_description: f.desc,
      exemption: f.centre ? 'Non Profit Hospital' : undefined,
      taxable_value: f.taxable,
      land_value: f.land,
      improvement_value: f.impr,
      total_value: f.land + f.impr,
      business_name: f.centre ? 'MULTICARE ALLENMORE HOSPITAL' : undefined,
      land_acres: Number(f.acres.toFixed(4)),
      legal_owner: f.centre ? 'MULTICARE HEALTH SYSTEM' : f.owner,
      sale_date: `20${String(10 + (i % 15)).padStart(2, '0')}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`,
      sale_price: invalid ? 0 : f.land + f.impr - 50000,
      sale_grantor: `${OWNERS[(i + 7) % OWNERS.length].toUpperCase()} (SELLER)`,
      sale_deed_type: invalid ? 'Quit Claim Deed' : 'Statutory Warranty Deed',
      sale_valid: invalid ? 0 : 1,
      sale_exclude_reason: invalid ? 'Living Trust' : undefined,
      sale_etn: String(202000000000 + f.oid),
    };
    for (const k of Object.keys(records[f.parcel])) if (records[f.parcel][k] === undefined) delete records[f.parcel][k];
  }
  return records;
}

function parseParams(request) {
  const url = new URL(request.url());
  const params = new URLSearchParams(url.search);
  if (request.method() === 'POST') {
    const body = request.postData() || '';
    for (const [k, v] of new URLSearchParams(body)) params.set(k, v);
  }
  return params;
}

function envelopeFilter(params) {
  const g = params.get('geometry');
  if (!g) return () => true;
  if (params.get('geometryType') === 'esriGeometryEnvelope' || /^[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+$/.test(g)) {
    const [xmin, ymin, xmax, ymax] = g.split(',').map(Number);
    return (f) => f.bbox[0] <= xmax && f.bbox[2] >= xmin && f.bbox[1] <= ymax && f.bbox[3] >= ymin;
  }
  return () => true;
}

// Esri expects clockwise outer rings
const cw = (ring) => ring.slice().reverse();
const F = (name, type, alias = name) => ({ name, type, alias });

function tacomaLayerInfo() {
  return {
    id: 2, name: 'Pierce County Tax Parcels (with ATS Info)', type: 'Feature Layer', geometryType: 'esriGeometryPolygon',
    displayField: 'TAXPAYERNAME', objectIdField: 'OBJECTID', maxRecordCount: 1000, supportedQueryFormats: 'JSON, geoJSON',
    capabilities: 'Map,Query,Data', currentVersion: 10.91,
    advancedQueryCapabilities: { supportsPagination: true, supportsStatistics: true },
    fields: [
      F('OBJECTID', 'esriFieldTypeOID'), F('TaxParcelNumber', 'esriFieldTypeString'), F('TaxParcelType', 'esriFieldTypeString'),
      F('TAXPAYERNAME', 'esriFieldTypeString', 'Taxpayer Name'), F('LandGrossAcres', 'esriFieldTypeDouble'), F('Use_Code', 'esriFieldTypeString'),
      F('LandValuePriorYear', 'esriFieldTypeInteger'), F('ImprovementValuePriorYear', 'esriFieldTypeInteger'),
      F('TotalMarketValuePriorYear', 'esriFieldTypeInteger'), F('TaxableValuePriorYear', 'esriFieldTypeInteger'),
      F('TotalMarketValueCurrentYear', 'esriFieldTypeInteger'), F('TaxableValueCurrentYear', 'esriFieldTypeInteger'),
      F('LandValueCurrentYear', 'esriFieldTypeInteger'), F('ImprovementValueCurrentYear', 'esriFieldTypeInteger'),
      F('CurrentUseCodeCurrentYear', 'esriFieldTypeString'), F('Shape', 'esriFieldTypeGeometry'),
    ],
  };
}

function pierceLayerInfo() {
  return {
    id: 0, name: 'Tax_Parcels', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', objectIdField: 'OBJECTID',
    displayField: 'Site_Address', maxRecordCount: 2000, supportedQueryFormats: 'JSON, geoJSON, PBF', capabilities: 'Query',
    advancedQueryCapabilities: { supportsPagination: true },
    fields: [
      F('OBJECTID', 'esriFieldTypeOID'), F('TaxParcelNumber', 'esriFieldTypeString'), F('Site_Address', 'esriFieldTypeString'),
      F('Business_Name', 'esriFieldTypeString'), F('Land_Acres', 'esriFieldTypeDouble'), F('Land_Value', 'esriFieldTypeDouble'),
      F('Improvement_Value', 'esriFieldTypeDouble'), F('Taxable_Value', 'esriFieldTypeDouble'), F('Use_Code', 'esriFieldTypeString'),
      F('Landuse_Description', 'esriFieldTypeString'), F('Exemption_Code', 'esriFieldTypeString'), F('Shape__Area', 'esriFieldTypeDouble'),
    ],
  };
}

function waLayerInfo() {
  return {
    id: 0, name: 'Parcels_2026', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', objectIdField: 'OBJECTID',
    maxRecordCount: 2000, supportedQueryFormats: 'JSON, geoJSON, PBF', capabilities: 'Query', advancedQueryCapabilities: { supportsPagination: true },
    fields: [
      F('OBJECTID', 'esriFieldTypeOID'), F('COUNTY_NM', 'esriFieldTypeString'), F('PARCEL_ID_NR', 'esriFieldTypeString'), F('SITUS_ADDRESS', 'esriFieldTypeString'),
      F('SITUS_CITY_NM', 'esriFieldTypeString'), F('LANDUSE_CD', 'esriFieldTypeSmallInteger', 'DOR Land Use Code'), F('VALUE_LAND', 'esriFieldTypeDouble'), F('VALUE_BLDG', 'esriFieldTypeDouble'), F('DATA_LINK', 'esriFieldTypeString'),
    ],
  };
}

function zoningLayerInfo(name, codeField, descField) {
  return {
    id: 0, name, type: 'Feature Layer', geometryType: 'esriGeometryPolygon', objectIdField: 'OBJECTID',
    maxRecordCount: 2000, supportedQueryFormats: 'JSON, geoJSON, PBF', capabilities: 'Query', advancedQueryCapabilities: { supportsPagination: true },
    fields: [F('OBJECTID', 'esriFieldTypeOID'), F(codeField, 'esriFieldTypeString'), ...(descField ? [F(descField, 'esriFieldTypeString')] : []), F('Shape__Area', 'esriFieldTypeDouble')],
  };
}

function geojsonPage(features, params, propsOf, pageSize) {
  const offset = Number(params.get('resultOffset') || 0);
  const count = Number(params.get('resultRecordCount') || pageSize);
  const slice = features.slice(offset, offset + count);
  const returnGeometry = params.get('returnGeometry') !== 'false';
  return {
    type: 'FeatureCollection',
    features: slice.map((f) => ({ type: 'Feature', id: f.oid, properties: propsOf(f), geometry: returnGeometry ? { type: 'Polygon', coordinates: [f.ring] } : null })),
    exceededTransferLimit: offset + count < features.length,
  };
}

function esriPage(features, params, propsOf, pageSize) {
  const offset = Number(params.get('resultOffset') || 0);
  const count = Number(params.get('resultRecordCount') || pageSize);
  const slice = features.slice(offset, offset + count);
  return {
    objectIdFieldName: 'OBJECTID',
    geometryType: 'esriGeometryPolygon',
    spatialReference: { wkid: 4326 },
    features: slice.map((f) => ({ attributes: propsOf(f), geometry: { rings: [cw(f.ring)] } })),
    exceededTransferLimit: offset + count < features.length,
  };
}

/**
 * Installs route handlers. options.fail = Set of layer URLs that should return HTTP 500.
 * options.extract = false disables the mocked weekly assessor extract (404s).
 * Returns a log of requests per layer.
 */
export async function installMockArcGIS(page, { parcels = makeParcels(), zones = makeZones(), countyZones = [], wazaZones = [], fail = new Set(), pierceOwnerNames = false, tacomaPageSize = 1000, delayMs = 0, extract = true } = {}) {
  const log = { tacoma: [], pierce: [], wa: [], tacomaZoning: [], pierceZoning: [], waza: [], items: [], searches: [], dart: [], extract: [], tiles: 0, other: [], blocked: [] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  // Tests must never reach a real service. Any ArcGIS REST host that is not explicitly
  // mocked below answers with a failure (routes registered later take precedence).
  await page.route(/\/rest\/services\//, (route) => {
    log.blocked.push(route.request().url());
    return json(route, { error: { code: 503, message: 'unmocked service blocked by test fixture' } }, 503);
  });

  const handler = (key, url, info, propsOf, { esri = false, pageSize = 1000, features = parcels } = {}) => async (route, request) => {
    const params = parseParams(request);
    log[key].push({ url: request.url(), method: request.method(), params: Object.fromEntries(params) });
    if (fail.has(url)) return json(route, { error: { code: 500, message: 'mock failure' } }, 500);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const path = new URL(request.url()).pathname;
    if (!path.endsWith('/query')) return json(route, info);
    const filtered = features.filter(envelopeFilter(params));
    if (params.get('returnCountOnly') === 'true') return json(route, { count: filtered.length });
    if (params.get('returnIdsOnly') === 'true') return json(route, { objectIdFieldName: 'OBJECTID', objectIds: filtered.map((f) => f.oid) });
    const ids = params.get('objectIds');
    const subset = ids ? filtered.filter((f) => ids.split(',').map(Number).includes(f.oid)) : filtered;
    const wantGeo = params.get('f') === 'geojson';
    if (wantGeo && !esri) return json(route, geojsonPage(subset, params, propsOf, pageSize));
    return json(route, esriPage(subset, params, propsOf, pageSize));
  };

  await page.route(`${TACOMA_URL}**`, handler('tacoma', TACOMA_URL, tacomaLayerInfo(), (f) => ({
    OBJECTID: f.oid, TaxParcelNumber: f.parcel, TaxParcelType: 'Base', TAXPAYERNAME: f.owner, LandGrossAcres: Number(f.acres.toFixed(4)), Use_Code: f.code,
    LandValuePriorYear: f.land, ImprovementValuePriorYear: f.impr, TotalMarketValuePriorYear: f.land + f.impr, TaxableValuePriorYear: f.taxable,
    TotalMarketValueCurrentYear: f.land + f.impr, TaxableValueCurrentYear: f.taxable, LandValueCurrentYear: f.land, ImprovementValueCurrentYear: f.impr, CurrentUseCodeCurrentYear: f.code,
  }), { pageSize: tacomaPageSize }));

  await page.route(`${PIERCE_URL}**`, handler('pierce', PIERCE_URL, pierceLayerInfo(), (f) => ({
    OBJECTID: f.oid, TaxParcelNumber: f.parcel, Site_Address: `${1900 + f.oid} S UNION AVE`,
    // Business_Name is the business on the parcel (occupant), never the taxpayer
    Business_Name: pierceOwnerNames ? f.owner : (f.centre ? 'MULTICARE ALLENMORE HOSPITAL' : /(INC|LLC|REIT|BANK)/i.test(f.owner) ? f.owner : null),
    Land_Acres: Number(f.acres.toFixed(4)), Land_Value: f.land, Improvement_Value: f.impr, Taxable_Value: f.taxable, Use_Code: f.code, Landuse_Description: f.desc,
    // the county layer only carries an exemption code; the extract has the descriptive type
    Exemption_Code: f.taxable === 0 ? 'EX' : null,
  })));

  await page.route(`${WA_URL}**`, handler('wa', WA_URL, waLayerInfo(), (f) => ({
    OBJECTID: f.oid, COUNTY_NM: 'Pierce', PARCEL_ID_NR: f.parcel, SITUS_ADDRESS: `${1900 + f.oid} S UNION AVE`, SITUS_CITY_NM: 'TACOMA', LANDUSE_CD: Number(f.code.slice(0, 2)),
    VALUE_LAND: f.land, VALUE_BLDG: f.impr, DATA_LINK: `https://atip.piercecountywa.gov/app/v2/propertyDetail/${f.parcel}/summary`,
  })));

  // Zoning: hub items resolve to hosted layers; Tacoma has districts, the county layer and the
  // statewide atlas answer with no polygons here (incorporated area).
  await page.route(/https:\/\/www\.arcgis\.com\/sharing\/rest\/content\/items\/([0-9a-f]+)/, async (route, request) => {
    const id = request.url().match(/items\/([0-9a-f]+)/)[1];
    log.items.push(id);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const url = { [PIERCE_ZONING_ITEM]: PIERCE_ZONING_URL.replace(/\/0$/, '') }[id];
    if (!url) return json(route, { error: { code: 400, message: 'Item does not exist or is inaccessible.' } }, 400);
    return json(route, { id, type: 'Feature Service', title: 'mock zoning', url });
  });
  // Portal search used to locate the Tacoma zoning service; a decoy (Tempe, AZ) comes first.
  await page.route(/https:\/\/www\.arcgis\.com\/sharing\/rest\/search\?/, async (route, request) => {
    const q = new URL(request.url()).searchParams.get('q') || '';
    log.searches.push(q);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return json(route, {
      total: 2,
      results: [
        { id: 'decoy', title: 'zoning_districts', owner: 'TempeData', type: 'Feature Service', url: 'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/zoning_districts/FeatureServer' },
        { id: 'tacoma2025', title: 'Zoning Districts 2025 (Tacoma)', owner: 'tacoma', type: 'Feature Service', url: TACOMA_ZONING_URL.replace(/\/0$/, '') },
      ],
    });
  });
  // The DART map service root lists its layers; the app picks "Zoning Districts" (id 3) by name.
  await page.route(`${TACOMA_DART_URL}**`, async (route, request) => {
    log.dart.push(request.url());
    const path = new URL(request.url()).pathname;
    if (/MapServer\/?$/.test(path)) return json(route, { layers: [{ id: 0, name: 'Land Use Designations' }, { id: 3, name: 'Zoning Districts' }, { id: 4, name: 'Historic Zoning Districts Overlay 1' }] });
    return json(route, { error: { code: 503, message: 'DART layer not mocked' } }, 503);
  });
  await page.route(`${TACOMA_DART_URL}/3**`, handler('dart', `${TACOMA_DART_URL}/3`, zoningLayerInfo('Zoning Districts', 'Zoning', 'Zone_Desc'), (z) => ({ OBJECTID: z.oid, Zoning: z.code, Zone_Desc: z.desc }), { features: zones }));
  await page.route(`${TACOMA_ZONING_URL}**`, handler('tacomaZoning', TACOMA_ZONING_URL, zoningLayerInfo('Zoning Districts 2025', 'Zoning', 'Zoning_Desc'), (z) => ({ OBJECTID: z.oid, Zoning: z.code, Zoning_Desc: z.desc }), { features: zones }));
  await page.route(`${PIERCE_ZONING_URL}**`, handler('pierceZoning', PIERCE_ZONING_URL, zoningLayerInfo('Zoning and Land Use Designations', 'ZON_CUR_CD', 'ZON_CUR_NA'), (z) => ({ OBJECTID: z.oid, ZON_CUR_CD: z.code, ZON_CUR_NA: z.desc }), { features: countyZones }));
  await page.route(`${WAZA_URL}**`, handler('waza', WAZA_URL, { ...zoningLayerInfo('WAZA_Prototype_Layers', 'ZoneID', 'ZoneName'), fields: [F('OBJECTID', 'esriFieldTypeOID'), F('Jurisdiction', 'esriFieldTypeString'), F('ZoneID', 'esriFieldTypeString'), F('ZoneName', 'esriFieldTypeString')] }, (z) => ({ OBJECTID: z.oid, Jurisdiction: 'Tacoma', ZoneID: z.code, ZoneName: z.desc }), { features: wazaZones }));

  // Weekly Pierce assessor extract published next to the page
  const extractRecords = makeExtract(parcels);
  await page.route(/\/data\/assessor\/pierce\/(manifest\.json|shards\/[0-9A-Z]+\.json)$/, async (route, request) => {
    const url = request.url();
    log.extract.push(url);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (!extract) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not built' });
    if (url.endsWith('manifest.json')) {
      return json(route, { generated: '2026-09-21T13:20:00.000Z', asOf: '2026-09-18T07:00:00.000Z', prefixLength: 4, shards: ['2000'], records: Object.keys(extractRecords).length, fields: { legal_owner: 'sale.txt Grantee on the most recent recorded deed' }, notes: 'mock extract' });
    }
    const prefix = url.match(/shards\/([0-9A-Z]+)\.json$/)[1];
    const shard = {};
    for (const [k, v] of Object.entries(extractRecords)) if (k.startsWith(prefix)) shard[k] = v;
    if (!Object.keys(shard).length) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no shard' });
    return json(route, shard);
  });

  // Basemap tiles and geocoders are not reachable in CI; answer with a blank tile / empty result.
  const blankPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route(/basemaps\.cartocdn\.com|tile\.openstreetmap\.org|arcgisonline\.com|nationalmap\.gov/, (route) => {
    log.tiles += 1;
    return route.fulfill({ status: 200, contentType: 'image/png', body: blankPng });
  });
  await page.route(/nominatim\.openstreetmap\.org|geocoding\.geo\.census\.gov|photon\.komoot\.io/, (route) => {
    log.other.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return log;
}

export { circleBBox };
