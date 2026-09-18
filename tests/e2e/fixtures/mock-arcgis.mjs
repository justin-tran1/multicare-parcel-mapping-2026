// Mock ArcGIS REST services for end-to-end tests. Generates a synthetic parcel fabric
// around a centre point and answers layer-metadata and /query requests the way the real
// Tacoma (MapServer, GeoJSON) and Pierce County (FeatureServer) layers do.
import { makeProjector, circleBBox } from '../../../js/geometry.js';

export const ALLENMORE = { lat: 47.2418, lon: -122.4718 };

export const TACOMA_URL = 'https://esgis.tacoma.gov/arcgis/rest/services/Ref/ITD_Basemap/MapServer/2';
export const PIERCE_URL = 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0';
export const WA_URL = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0';

const OWNERS = [
  'Healthcare Realty', 'Ventas REIT', 'NATIONWIDE HEALTH PROPERTIES INC', 'Donald Hearon DDS', 'VFW', 'Reeder Management Inc',
  'Bank of America', 'Tacoma Elks Lodge # 174', 'Thomas & Kristi Lizotte', 'Wal-Mart', 'Oliphant Real Estate Services',
  'Mercedes G McGee', 'CARE NET/Allenmore Children & Youth', 'Life Center Church & School', 'STEVEN PAIGE', 'AAA Auto Club',
  'Key Bank', 'GLORIA DEI LUTHERAN CHURCH', 'DUGAN JON', 'Home Partners of America', 'Everlast Family & Cosmetic Dentistry',
];
const USES = [['1101', 'SINGLE FAMILY DWELLING'], ['6500', 'MEDICAL OFFICE'], ['4600', 'PARKING'], ['5300', 'RETAIL'], ['1300', 'MULTI-FAMILY'], ['9100', 'VACANT LAND'], ['7200', 'CHURCH']];

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
        taxable: owner === 'VFW' || /CHURCH/i.test(owner) ? 0 : land + impr,
        ring,
        bbox: [Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))],
      });
      oid += 1;
    }
  }
  return features;
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

function tacomaLayerInfo() {
  const F = (name, type, alias = name) => ({ name, type, alias });
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
  const F = (name, type, alias = name) => ({ name, type, alias });
  return {
    id: 0, name: 'Tax_Parcels', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', objectIdField: 'OBJECTID',
    displayField: 'Site_Address', maxRecordCount: 2000, supportedQueryFormats: 'JSON, geoJSON, PBF', capabilities: 'Query',
    advancedQueryCapabilities: { supportsPagination: true },
    fields: [
      F('OBJECTID', 'esriFieldTypeOID'), F('TaxParcelNumber', 'esriFieldTypeString'), F('Site_Address', 'esriFieldTypeString'),
      F('Business_Name', 'esriFieldTypeString'), F('Land_Acres', 'esriFieldTypeDouble'), F('Land_Value', 'esriFieldTypeDouble'),
      F('Improvement_Value', 'esriFieldTypeDouble'), F('Taxable_Value', 'esriFieldTypeDouble'), F('Use_Code', 'esriFieldTypeString'),
      F('Landuse_Description', 'esriFieldTypeString'), F('Shape__Area', 'esriFieldTypeDouble'),
    ],
  };
}

function waLayerInfo() {
  const F = (name, type, alias = name) => ({ name, type, alias });
  return {
    id: 0, name: 'Parcels_2026', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', objectIdField: 'OBJECTID',
    maxRecordCount: 2000, supportedQueryFormats: 'JSON, geoJSON, PBF', capabilities: 'Query', advancedQueryCapabilities: { supportsPagination: true },
    fields: [
      F('OBJECTID', 'esriFieldTypeOID'), F('COUNTY_NM', 'esriFieldTypeString'), F('PARCEL_ID_NR', 'esriFieldTypeString'), F('SITUS_ADDRESS', 'esriFieldTypeString'),
      F('SITUS_CITY_NM', 'esriFieldTypeString'), F('LANDUSE_CD', 'esriFieldTypeSmallInteger', 'DOR Land Use Code'), F('VALUE_LAND', 'esriFieldTypeDouble'), F('VALUE_BLDG', 'esriFieldTypeDouble'), F('DATA_LINK', 'esriFieldTypeString'),
    ],
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
 * Returns a log of requests per layer.
 */
export async function installMockArcGIS(page, { parcels = makeParcels(), fail = new Set(), pierceOwnerNames = false, tacomaPageSize = 1000, delayMs = 0 } = {}) {
  const log = { tacoma: [], pierce: [], wa: [], tiles: 0, other: [] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  const handler = (key, url, info, propsOf, esri = false, pageSize = 1000) => async (route, request) => {
    const params = parseParams(request);
    log[key].push({ url: request.url(), method: request.method(), params: Object.fromEntries(params) });
    if (fail.has(url)) return json(route, { error: { code: 500, message: 'mock failure' } }, 500);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const path = new URL(request.url()).pathname;
    if (!path.endsWith('/query')) return json(route, info);
    if (params.get('returnCountOnly') === 'true') return json(route, { count: parcels.filter(envelopeFilter(params)).length });
    const filtered = parcels.filter(envelopeFilter(params));
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
  }), false, tacomaPageSize));

  await page.route(`${PIERCE_URL}**`, handler('pierce', PIERCE_URL, pierceLayerInfo(), (f) => ({
    OBJECTID: f.oid, TaxParcelNumber: f.parcel, Site_Address: `${1900 + f.oid} S UNION AVE`, Business_Name: pierceOwnerNames ? f.owner : (/(INC|LLC|REIT|BANK)/i.test(f.owner) ? f.owner : null),
    Land_Acres: Number(f.acres.toFixed(4)), Land_Value: f.land, Improvement_Value: f.impr, Taxable_Value: f.taxable, Use_Code: f.code, Landuse_Description: f.desc,
  })));

  await page.route(`${WA_URL}**`, handler('wa', WA_URL, waLayerInfo(), (f) => ({
    OBJECTID: f.oid, COUNTY_NM: 'Pierce', PARCEL_ID_NR: f.parcel, SITUS_ADDRESS: `${1900 + f.oid} S UNION AVE`, SITUS_CITY_NM: 'TACOMA', LANDUSE_CD: Number(f.code.slice(0, 2)),
    VALUE_LAND: f.land, VALUE_BLDG: f.impr, DATA_LINK: `https://atip.piercecountywa.gov/app/v2/propertyDetail/${f.parcel}/summary`,
  })));

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
