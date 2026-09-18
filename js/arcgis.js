// Minimal ArcGIS REST client for MapServer / FeatureServer layers.
// Handles layer metadata discovery, paginated spatial queries (envelope or polygon),
// GeoJSON or Esri JSON output, and conversion of Esri geometry to GeoJSON.

import { ringSignedArea, pointInRing, labelPoint } from './geometry.js';

export class ArcGISError extends Error {
  constructor(message, { code, url, details, cause } = {}) {
    super(message);
    this.name = 'ArcGISError';
    this.code = code;
    this.url = url;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

const layerInfoCache = new Map();
const MAX_GET_URL = 1900;

export function normalizeLayerUrl(url) {
  return String(url).trim().replace(/\?.*$/, '').replace(/\/+$/, '');
}

/**
 * fetch() wrapper with timeout, JSON parsing and ArcGIS error envelope detection.
 */
export async function fetchJson(url, { method = 'GET', body = null, timeoutMs = 25000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new ArcGISError('Request timed out', { url, code: 'timeout' })), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    let res;
    try {
      res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      });
    } catch (err) {
      if (err instanceof ArcGISError) throw err;
      if (signal?.aborted) throw new ArcGISError('Cancelled', { url, code: 'aborted', cause: err });
      if (ctrl.signal.aborted && ctrl.signal.reason instanceof ArcGISError) throw ctrl.signal.reason;
      throw new ArcGISError(`Network error (blocked, offline, or no CORS): ${err.message}`, { url, code: 'network', cause: err });
    }
    if (!res.ok) throw new ArcGISError(`HTTP ${res.status} ${res.statusText}`.trim(), { url, code: res.status });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new ArcGISError('Response was not JSON', { url, code: 'parse', cause: err });
    }
    if (json && json.error) {
      throw new ArcGISError(json.error.message || 'ArcGIS service error', {
        url,
        code: json.error.code,
        details: json.error.details,
      });
    }
    return json;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function encodeParams(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return usp.toString();
}

/** GET when short enough, otherwise POST (form-encoded) to avoid URL length limits. */
export async function request(endpoint, params, opts = {}) {
  const qs = encodeParams(params);
  const getUrl = `${endpoint}?${qs}`;
  if (getUrl.length <= MAX_GET_URL) return fetchJson(getUrl, opts);
  return fetchJson(endpoint, { ...opts, method: 'POST', body: qs });
}

/**
 * Loads and caches layer metadata (fields, record limits, capabilities).
 */
export async function getLayerInfo(layerUrl, { signal, force = false } = {}) {
  const url = normalizeLayerUrl(layerUrl);
  if (!force && layerInfoCache.has(url)) return layerInfoCache.get(url);
  const p = (async () => {
    const info = await fetchJson(`${url}?f=json`, { signal, timeoutMs: 20000 });
    if (!info || (!info.fields && !info.geometryType && !info.type)) {
      throw new ArcGISError('Not a layer (no fields/geometryType in metadata)', { url, code: 'notlayer' });
    }
    const fields = (info.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type, length: f.length, domain: f.domain || null }));
    const formats = String(info.supportedQueryFormats || '').toLowerCase();
    const aqc = info.advancedQueryCapabilities || {};
    const oid = info.objectIdField || fields.find((f) => f.type === 'esriFieldTypeOID')?.name || 'OBJECTID';
    return {
      url,
      name: info.name || '',
      type: info.type || '',
      description: info.description || '',
      copyrightText: info.copyrightText || '',
      geometryType: info.geometryType || '',
      fields,
      fieldNames: fields.map((f) => f.name),
      objectIdField: oid,
      displayField: info.displayField || '',
      maxRecordCount: Number(info.maxRecordCount) > 0 ? Number(info.maxRecordCount) : 1000,
      supportsPagination: Boolean(aqc.supportsPagination),
      supportsGeoJSON: formats.includes('geojson'),
      supportsQuery: /query/i.test(String(info.capabilities || 'Query')),
      currentVersion: info.currentVersion,
      extent: info.extent,
      editingInfo: info.editingInfo,
      raw: info,
    };
  })();
  layerInfoCache.set(url, p);
  try {
    return await p;
  } catch (err) {
    layerInfoCache.delete(url);
    throw err;
  }
}

export function clearLayerInfoCache() {
  layerInfoCache.clear();
}

// ---------------------------------------------------------------------------
// Esri JSON -> GeoJSON
// ---------------------------------------------------------------------------

/**
 * Converts Esri geometry to GeoJSON. Esri polygons: outer rings clockwise, holes
 * counter-clockwise. Holes are assigned to the outer ring that contains them. If a
 * server ignores the orientation convention (all rings the same direction) every
 * ring is treated as an outer ring.
 */
export function esriGeometryToGeoJSON(g) {
  if (!g) return null;
  if (Array.isArray(g.rings)) {
    const outers = [];
    const holes = [];
    for (const ring of g.rings) {
      if (!ring || ring.length < 4) continue;
      const a = ringSignedArea(ring);
      if (Math.abs(a) < 1e-14) continue;
      // Esri: clockwise (negative signed area with y up) = outer
      if (a < 0) outers.push(ring.slice().reverse()); // GeoJSON prefers CCW outers
      else holes.push(ring.slice().reverse()); // and CW holes
    }
    let polys;
    if (outers.length === 0) {
      polys = holes.map((h) => [h.slice().reverse()]);
    } else {
      polys = outers.map((o) => [o]);
      for (const hole of holes) {
        // probe a point strictly inside the hole (a vertex may sit on the outer boundary)
        const probe = labelPoint([[hole]]);
        let placed = false;
        for (const poly of polys) {
          if (pointInRing(probe, poly[0])) {
            poly.push(hole);
            placed = true;
            break;
          }
        }
        if (!placed) polys.push([hole.slice().reverse()]);
      }
    }
    if (polys.length === 0) return null;
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    return { type: 'MultiPolygon', coordinates: polys };
  }
  if (Array.isArray(g.paths)) {
    if (g.paths.length === 1) return { type: 'LineString', coordinates: g.paths[0] };
    return { type: 'MultiLineString', coordinates: g.paths };
  }
  if (Array.isArray(g.points)) return { type: 'MultiPoint', coordinates: g.points };
  if (typeof g.x === 'number' && typeof g.y === 'number') return { type: 'Point', coordinates: [g.x, g.y] };
  return null;
}

export function esriFeatureSetToGeoJSON(fs) {
  const oid = fs.objectIdFieldName || 'OBJECTID';
  return {
    type: 'FeatureCollection',
    features: (fs.features || []).map((f) => {
      const props = f.attributes || {};
      const id = props[oid];
      return { type: 'Feature', id, properties: props, geometry: esriGeometryToGeoJSON(f.geometry) };
    }),
    exceededTransferLimit: Boolean(fs.exceededTransferLimit),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function geometryParams({ bbox, polygon }) {
  if (bbox) {
    const [xmin, ymin, xmax, ymax] = bbox;
    return {
      geometry: `${xmin},${ymin},${xmax},${ymax}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
    };
  }
  if (polygon) {
    const rings = polygon.type === 'Polygon' ? polygon.coordinates : polygon.coordinates.flat();
    return {
      geometry: { rings, spatialReference: { wkid: 4326 } },
      geometryType: 'esriGeometryPolygon',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
    };
  }
  return {};
}

function exceeded(page) {
  return Boolean(page.exceededTransferLimit || page.properties?.exceededTransferLimit);
}

/**
 * Queries a layer for features intersecting a bbox ([minLon, minLat, maxLon, maxLat]) or
 * a GeoJSON polygon, following the server's transfer limit with pagination (or an
 * objectIds sweep when pagination is unsupported). Resolves to a GeoJSON FeatureCollection.
 */
export async function queryFeatures(layerUrl, {
  bbox,
  polygon,
  where = '1=1',
  outFields = ['*'],
  info,
  maxFeatures = 25000,
  signal,
  onPage,
  timeoutMs = 45000,
  returnGeometry = true,
} = {}) {
  const url = normalizeLayerUrl(layerUrl);
  info = info || (await getLayerInfo(url, { signal }));
  const endpoint = `${url}/query`;
  const useGeoJSON = info.supportsGeoJSON;
  const pageSize = Math.max(1, Math.min(info.maxRecordCount || 1000, 2000));
  const base = {
    where,
    outFields: Array.isArray(outFields) ? outFields.join(',') : outFields,
    returnGeometry,
    outSR: 4326,
    geometryPrecision: 7,
    f: useGeoJSON ? 'geojson' : 'json',
    ...geometryParams({ bbox, polygon }),
  };
  const features = [];
  let truncated = false;
  let pages = 0;
  const pushPage = (raw) => {
    const fc = useGeoJSON ? raw : esriFeatureSetToGeoJSON(raw);
    for (const f of fc.features || []) {
      if (returnGeometry && !f.geometry) continue;
      if (f.id === undefined && f.properties) f.id = f.properties[info.objectIdField];
      features.push(f);
    }
    pages += 1;
    if (onPage) onPage({ pages, count: features.length });
    return fc;
  };

  if (info.supportsPagination) {
    let offset = 0;
    for (;;) {
      const raw = await request(endpoint, { ...base, resultOffset: offset, resultRecordCount: pageSize }, { signal, timeoutMs });
      const fc = pushPage(raw);
      const n = (fc.features || []).length;
      const more = exceeded(raw) || exceeded(fc) || n >= pageSize;
      if (!more || n === 0) break;
      offset += n;
      if (features.length >= maxFeatures) {
        truncated = true;
        break;
      }
    }
  } else {
    // First page; if the server truncated, sweep the remaining object ids.
    const raw = await request(endpoint, base, { signal, timeoutMs });
    const fc = pushPage(raw);
    if (exceeded(raw) || exceeded(fc) || (fc.features || []).length >= pageSize) {
      const idsResp = await request(endpoint, { where: base.where, geometry: base.geometry, geometryType: base.geometryType, inSR: base.inSR, spatialRel: base.spatialRel, returnIdsOnly: true, f: 'json' }, { signal, timeoutMs });
      const oidField = idsResp.objectIdFieldName || info.objectIdField;
      const have = new Set(features.map((f) => f.properties?.[oidField] ?? f.id));
      const ids = (idsResp.objectIds || []).filter((id) => !have.has(id));
      for (let i = 0; i < ids.length; i += pageSize) {
        if (features.length >= maxFeatures) {
          truncated = true;
          break;
        }
        const chunk = ids.slice(i, i + pageSize);
        const rawChunk = await request(endpoint, { where: '1=1', objectIds: chunk.join(','), outFields: base.outFields, returnGeometry, outSR: 4326, geometryPrecision: 7, f: base.f }, { signal, timeoutMs });
        pushPage(rawChunk);
      }
    }
  }
  return { type: 'FeatureCollection', features, truncated, pages, layer: url };
}

/** Returns the count of features matching a bbox (cheap pre-flight). */
export async function countFeatures(layerUrl, { bbox, polygon, where = '1=1', signal } = {}) {
  const url = normalizeLayerUrl(layerUrl);
  const resp = await request(`${url}/query`, { where, returnCountOnly: true, f: 'json', ...geometryParams({ bbox, polygon }) }, { signal, timeoutMs: 20000 });
  return Number(resp.count ?? 0);
}
