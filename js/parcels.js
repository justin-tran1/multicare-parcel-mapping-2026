// ParcelService: routes a bounding box to the right county provider(s), queries the live
// ArcGIS layers, joins enrichment layers by parcel id, and normalizes features into records.

import { getLayerInfo, queryFeatures, request, ArcGISError } from './arcgis.js';
import { resolveFieldMap, toNumber, cleanText } from './fields.js';
import { PROVIDERS, STATEWIDE } from './providers.js';
import { decodeDOR } from './dor_codes.js';
import {
  geometryBBox, bboxIntersects, expandBBox, pointInGeometry, geometryAreaSqM, sqMToAcres, SQFT_PER_ACRE,
} from './geometry.js';

export const VALUE_KIND_LABELS = {
  taxable: 'Taxable value',
  total: 'Total market value',
  'land+impr': 'Land + improvement value',
  none: 'Value not published',
};

export function normalizeParcelId(id) {
  return String(id ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

const layerPrep = new Map(); // source.url -> Promise<{info, fieldMap, how}>

/** Rejects with an 'aborted' error when the signal fires, otherwise resolves like `promise`. */
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new ArcGISError('Cancelled', { code: 'aborted' }));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ArcGISError('Cancelled', { code: 'aborted' }));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

// The metadata fetch is shared by every caller, so it must not be bound to any one caller's
// abort signal; callers race the shared promise against their own signal instead.
async function prepareSource(source, { signal } = {}) {
  if (!layerPrep.has(source.url)) {
    const p = (async () => {
      const info = await getLayerInfo(source.url);
      const { map, how } = resolveFieldMap(info, source.fields || {});
      const missingComputed = {};
      for (const [attr, spec] of Object.entries(source.computed || {})) {
        const present = spec.sum.filter((f) => info.fieldNames.some((n) => n.toLowerCase() === f.toLowerCase()));
        missingComputed[attr] = present.length === spec.sum.length ? null : spec.sum.filter((f) => !present.includes(f));
      }
      // Coded-value domains (e.g. LANDUSE_CD 11 -> "Household, single family units",
      // COUNTY_NM "53" -> "Pierce") let us show names instead of codes.
      const domains = {};
      for (const f of info.fields) {
        const cv = f.domain?.codedValues;
        if (Array.isArray(cv) && cv.length) domains[f.name.toLowerCase()] = new Map(cv.map((c) => [String(c.code), String(c.name)]));
      }
      return { info, fieldMap: map, how, missingComputed, domains };
    })();
    layerPrep.set(source.url, p);
    p.catch(() => layerPrep.delete(source.url));
  }
  return withSignal(layerPrep.get(source.url), signal);
}

const isAbort = (err) => err?.code === 'aborted' || err?.name === 'AbortError';

// Code -> description lookup tables (e.g. the State service's county land-use code table),
// cached per table URL and partition value.
const lookupCache = new Map();

async function loadLookup(lookup, partition, signal) {
  const key = `${lookup.url}|${partition ?? ''}`;
  if (!lookupCache.has(key)) {
    const p = (async () => {
      const where = lookup.byField && partition !== null && partition !== undefined && partition !== ''
        ? `${lookup.byField}='${String(partition).replace(/'/g, "''")}'`
        : '1=1';
      const resp = await request(`${lookup.url}/query`, { where, outFields: `${lookup.keyField},${lookup.valueField}`, returnGeometry: false, f: 'json' }, { timeoutMs: 20000 });
      const map = new Map();
      for (const f of resp.features || []) {
        const a = f.attributes || {};
        const k = String(a[lookup.keyField] ?? '').trim();
        if (k) map.set(k, cleanText(a[lookup.valueField]));
      }
      return map;
    })();
    lookupCache.set(key, p);
    p.catch(() => lookupCache.delete(key));
  }
  return withSignal(lookupCache.get(key), signal);
}

/** Fills `target` from a lookup table for records that still lack it. Failures are silent. */
async function applyLookup(source, attrsList, signal) {
  const lookup = source.lookup;
  if (!lookup) return;
  const pending = attrsList.filter((a) => a._lookupCode && !a[lookup.target]);
  if (!pending.length) return;
  const partitions = new Set(pending.map((a) => (lookup.byField ? a._rawCounty || '' : '')));
  await Promise.all([...partitions].map(async (part) => {
    try {
      const table = await loadLookup(lookup, part, signal);
      for (const a of pending) {
        if ((lookup.byField ? a._rawCounty || '' : '') !== part) continue;
        const desc = table.get(String(a._lookupCode).trim());
        if (desc) {
          a[lookup.target] = desc;
          a._sourceFields[lookup.target] = `${lookup.sourceField} via ${lookup.valueField} lookup`;
        }
      }
    } catch (err) {
      if (isAbort(err)) throw err;
      /* lookup unavailable: keep codes */
    }
  }));
}

function getField(props, name) {
  if (!name) return undefined;
  if (name in props) return props[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return undefined;
}

function sumFields(props, names) {
  let total = 0;
  let any = false;
  for (const n of names) {
    const v = toNumber(getField(props, n));
    if (v !== null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function decodeDomain(prep, fieldName, value) {
  if (!fieldName || value === null || value === undefined || value === '') return null;
  const dom = prep.domains?.[fieldName.toLowerCase()];
  if (!dom) return null;
  return dom.get(String(value)) ?? null;
}

/** Extracts normalized attributes from one source's feature properties. */
function extractAttrs(props, prep, source) {
  const m = prep.fieldMap;
  const out = {
    parcel_id: cleanText(getField(props, m.parcel_id)),
    owner: cleanText(getField(props, m.owner)),
    owner_address: cleanText(getField(props, m.owner_address)),
    situs_address: cleanText(getField(props, m.situs_address)),
    situs_city: cleanText(getField(props, m.situs_city)),
    taxable_value: toNumber(getField(props, m.taxable_value)),
    land_value: toNumber(getField(props, m.land_value)),
    improvement_value: toNumber(getField(props, m.improvement_value)),
    total_value: toNumber(getField(props, m.total_value)),
    land_acres: toNumber(getField(props, m.land_acres)),
    land_sqft: toNumber(getField(props, m.land_sqft)),
    use_code: cleanText(getField(props, m.use_code)),
    use_description: cleanText(getField(props, m.use_description)),
    assessor_link: cleanText(getField(props, m.assessor_link)),
    county: cleanText(getField(props, m.county)),
    _sourceFields: {},
  };
  const countyName = decodeDomain(prep, m.county, getField(props, m.county));
  if (countyName) out.county = countyName;
  if (!out.use_description) {
    const useName = decodeDomain(prep, m.use_code, getField(props, m.use_code));
    if (useName) {
      out.use_description = useName;
      out._sourceFields.use_description = `${m.use_code} (domain)`;
    }
  }
  // Situs address stored as components (number, direction, street, suffix, unit): the
  // composed address takes precedence over any single heuristically matched field.
  if (Array.isArray(source.situsCompose)) {
    const parts = source.situsCompose.map((f) => cleanText(getField(props, f))).filter(Boolean);
    const composed = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (composed) {
      out.situs_address = composed;
      out._sourceFields.situs_address = source.situsCompose.join(' + ');
    }
  }
  if (source.linkIdField) out._linkId = cleanText(getField(props, source.linkIdField));
  // Some assessors split owner into organisation / last / first / middle name fields.
  if (!out.owner && source.ownerCompose) {
    const c = source.ownerCompose;
    const org = cleanText(getField(props, c.org));
    const last = cleanText(getField(props, c.last));
    const first = cleanText(getField(props, c.first));
    const middle = cleanText(getField(props, c.middle));
    out.owner = org || [last, [first, middle].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (out.owner) out._sourceFields.owner = [c.org, c.last, c.first, c.middle].filter(Boolean).join(' / ');
  }
  for (const [attr, spec] of Object.entries(source.computed || {})) {
    // A computed value beats a heuristically matched field (e.g. one of several land value
    // components) but never a field the provider named explicitly.
    const empty = out[attr] === null || out[attr] === undefined || out[attr] === '';
    if (empty || prep.how?.[attr] === 'heuristic') {
      if (spec.sum) {
        const v = sumFields(props, spec.sum);
        if (v !== null) {
          out[attr] = v;
          out._sourceFields[attr] = `${spec.sum.join(' + ')}`;
        }
      } else if (spec.diff) {
        const a = toNumber(getField(props, spec.diff[0]));
        const b = toNumber(getField(props, spec.diff[1]));
        if (a !== null && b !== null && a - b >= 0) {
          out[attr] = a - b;
          out._sourceFields[attr] = `${spec.diff[0]} - ${spec.diff[1]}`;
        }
      }
    }
  }
  if (m.county) out._rawCounty = cleanText(getField(props, m.county));
  if (source.lookup) out._lookupCode = cleanText(getField(props, source.lookup.sourceField));
  for (const [attr, field] of Object.entries(m)) if (field && !out._sourceFields[attr]) out._sourceFields[attr] = field;
  // A caveat attached to owner names from this source (e.g. business names only, or a
  // dated compilation), optionally only when a particular field supplied the name.
  if (source.ownerNote && out.owner) {
    const cond = source.ownerNoteField ? new RegExp(source.ownerNoteField, 'i') : null;
    if (!cond || (m.owner && cond.test(m.owner))) out._ownerNote = source.ownerNote;
  }
  return out;
}

function mergeAttrs(primary, extras) {
  const out = { ...primary, _sourceFields: { ...primary._sourceFields } }; // keeps _rawCounty/_lookupCode
  for (const extra of extras) {
    for (const [k, v] of Object.entries(extra)) {
      if (k.startsWith('_')) continue;
      const cur = out[k];
      const empty = cur === null || cur === undefined || cur === '';
      const has = v !== null && v !== undefined && v !== '';
      if (empty && has) {
        out[k] = v;
        out._sourceFields[k] = `${extra._sourceFields[k]} (${extra._sourceName})`;
        if (k === 'owner' && extra._ownerNote) out._ownerNote = extra._ownerNote;
      }
    }
  }
  return out;
}

function useCodeText(provider, attrs) {
  if (attrs.use_description) return attrs.use_description;
  const code = attrs.use_code;
  if (!code) return '';
  // Some layers store "91 Undeveloped Land" (code and description in one string)
  const combined = String(code).match(/^\(?(\d{1,4})\)?\s*[-:]?\s+([A-Za-z].*)$/);
  if (combined) return `${combined[2].trim()} (${combined[1]})`;
  if (provider.useCodeScheme === 'dor' || provider.useCodeScheme === 'dor-prefix') {
    const d = decodeDOR(code);
    if (d) return provider.useCodeScheme === 'dor' ? d : `${d} (${code})`;
  }
  return String(code);
}

/** Builds the normalized record used by the map, table and export. */
export function buildRecord({ feature, provider, source, attrs, county }) {
  const geometry = feature.geometry;
  const bbox = geometryBBox(geometry);
  const parcelId = attrs.parcel_id || String(feature.id ?? '');
  // Parcel numbers are not always unique (stacked condominium units, split parcels), so the
  // key also carries the layer object id, which is stable across queries of the same layer.
  const normId = normalizeParcelId(parcelId);
  const key = `${provider.key}:${normId || 'na'}:${feature.id ?? ''}`;
  // Stable key for user marks: parcel number when there is one (survives layer fallbacks
  // and object-id reassignment), otherwise the feature key.
  const markKey = normId ? `${provider.key}:${normId}` : key;

  let value = null;
  let valueKind = 'none';
  if (attrs.taxable_value !== null && attrs.taxable_value !== undefined) {
    value = attrs.taxable_value;
    valueKind = 'taxable';
  } else if (attrs.total_value !== null && attrs.total_value !== undefined) {
    value = attrs.total_value;
    valueKind = 'total';
  } else if (attrs.land_value !== null || attrs.improvement_value !== null) {
    value = (attrs.land_value || 0) + (attrs.improvement_value || 0);
    valueKind = 'land+impr';
  }

  let acres = null;
  let acresSource = 'none';
  if (attrs.land_acres !== null && attrs.land_acres !== undefined && attrs.land_acres > 0) {
    acres = attrs.land_acres;
    acresSource = 'assessor';
  } else if (attrs.land_sqft !== null && attrs.land_sqft !== undefined && attrs.land_sqft > 0) {
    acres = attrs.land_sqft / SQFT_PER_ACRE;
    acresSource = 'sqft';
  } else if (geometry) {
    acres = sqMToAcres(geometryAreaSqM(geometry));
    acresSource = 'gis';
  }

  let link = attrs.assessor_link || '';
  const linkId = attrs._linkId || parcelId;
  if (!link && provider.assessorLink && linkId) link = provider.assessorLink.replace('{parcel}', encodeURIComponent(linkId));
  if (link && !/^https?:\/\//i.test(link)) link = '';

  return {
    key,
    markKey,
    id: null, // assigned when numbered within a ring
    provider: provider.key,
    providerName: provider.name,
    sourceName: source.name,
    layerUrl: source.url,
    objectId: feature.id,
    parcelId,
    owner: attrs.owner || '',
    ownerNote: attrs._ownerNote || '',
    ownerAddress: attrs.owner_address || '',
    situs: attrs.situs_address || '',
    city: attrs.situs_city || '',
    county: attrs.county || county || (provider.counties[0] !== '*' ? provider.counties[0] : '') || '',
    value,
    valueKind,
    taxableValue: attrs.taxable_value,
    landValue: attrs.land_value,
    improvementValue: attrs.improvement_value,
    totalValue: attrs.total_value,
    acres,
    acresSource,
    useCode: attrs.use_code || '',
    useDescription: attrs.use_description || '',
    useText: useCodeText(provider, attrs),
    link,
    geometry,
    bbox,
    sourceFields: attrs._sourceFields,
    raw: feature.properties,
    multicare: null, // filled by the app (owner classification)
    occupied: false,
    distanceM: null,
  };
}

// ---------------------------------------------------------------------------

export class ParcelService {
  /**
   * @param {{counties: GeoJSON.FeatureCollection, providers?: object[], statewide?: object}} opts
   */
  constructor({ counties, providers = PROVIDERS, statewide = STATEWIDE }) {
    this.counties = counties;
    this.providers = providers;
    this.statewide = statewide;
    this.countyBBoxes = counties.features.map((f) => ({ f, bbox: geometryBBox(f.geometry), name: f.properties.name }));
    // "53067", "067", "67" -> "Thurston": the statewide layer stores county FIPS numbers.
    this.fipsToName = new Map();
    for (const f of counties.features) {
      const fips = String(f.properties.fips || '');
      const three = fips.slice(-3);
      for (const k of [fips, three, String(Number(three))]) if (k) this.fipsToName.set(k, f.properties.name);
    }
  }

  /** Normalizes a county attribute (name or FIPS code) to the county name. */
  countyName(value) {
    const v = String(value ?? '').trim();
    if (!v) return '';
    if (/^\d+$/.test(v)) return this.fipsToName.get(v) || this.fipsToName.get(String(Number(v))) || v;
    return v.replace(/\s+county$/i, '');
  }

  /** Coarse county polygons touching the bbox (expanded by a safety margin). */
  countiesForBBox(bbox, marginM = 1500) {
    const ex = expandBBox(bbox, marginM);
    const [minX, minY, maxX, maxY] = ex;
    const probes = [
      [(minX + maxX) / 2, (minY + maxY) / 2],
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
      [(minX + maxX) / 2, minY], [(minX + maxX) / 2, maxY], [minX, (minY + maxY) / 2], [maxX, (minY + maxY) / 2],
    ];
    const hits = [];
    for (const c of this.countyBBoxes) {
      if (!bboxIntersects(c.bbox, ex)) continue;
      let hit = probes.some((p) => pointInGeometry(p, c.f.geometry));
      if (!hit) {
        // a county vertex inside the bbox (bbox straddles a boundary)
        outer: for (const poly of c.f.geometry.type === 'Polygon' ? [c.f.geometry.coordinates] : c.f.geometry.coordinates) {
          for (const [x, y] of poly[0]) {
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) { hit = true; break outer; }
          }
        }
      }
      if (hit) hits.push(c.name);
    }
    return hits;
  }

  countyForPoint(lonLat) {
    for (const c of this.countyBBoxes) if (pointInGeometry(lonLat, c.f.geometry)) return c.name;
    return null;
  }

  providerFor(county) {
    const c = String(county).toLowerCase();
    return this.providers.find((p) => p.counties.some((n) => n.toLowerCase() === c)) || null;
  }

  /**
   * Fetches parcels intersecting `bbox` from every relevant provider.
   * Resolves { records, statuses, counties }.
   */
  async fetchParcels(bbox, { signal, onStatus } = {}) {
    const counties = this.countiesForBBox(bbox);
    const statuses = [];
    const records = new Map();
    const report = (s) => {
      statuses.push(s);
      if (onStatus) onStatus(s, statuses);
    };

    const countyJobs = counties.map(async (county) => {
      const provider = this.providerFor(county);
      if (provider) {
        const added = await this.runProvider(provider, bbox, county, records, report, signal);
        // A provider that answered with no parcels at all (a city-limited layer, a stale
        // extract) is treated as unavailable so the statewide layer can fill the area.
        if (added !== false && added > 0) return { county, ok: true };
      }
      return { county, ok: false };
    });
    const results = await Promise.all(countyJobs);
    const needStatewide = results.filter((r) => !r.ok).map((r) => r.county);
    if (needStatewide.length || counties.length === 0) {
      const r = await this.runProvider(this.statewide, bbox, null, records, report, signal, counties.length ? new Set(needStatewide.map((c) => c.toLowerCase())) : null);
      if (r === false && !statuses.some((s) => s.ok && s.role === 'primary')) {
        // nothing answered anywhere; surfaces as "unavailable" in the UI via statuses
      }
    }
    return { records: [...records.values()], statuses, counties };
  }

  async runProvider(provider, bbox, county, records, report, signal, onlyCounties = null) {
    let primary = null;
    let primaryPrep = null;
    let primaryFC = null;
    const errors = [];
    const geometrySources = provider.sources.filter((s) => s.geometry);
    for (const source of geometrySources) {
      if (signal?.aborted) throw new ArcGISError('Cancelled', { code: 'aborted' });
      try {
        const prep = await prepareSource(source, { signal });
        const fc = await queryFeatures(source.url, { bbox, info: prep.info, signal, outFields: ['*'] });
        if (!fc.features.length && !primary) {
          // keep as a last resort but try the next geometry source for actual coverage
          primary = source;
          primaryPrep = prep;
          primaryFC = fc;
          report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: true, role: 'primary', count: 0, county, confidence: source.confidence, fieldMap: prep.fieldMap, note: 'no parcels in this area' });
          continue;
        }
        if (fc.features.length) {
          primary = source;
          primaryPrep = prep;
          primaryFC = fc;
          break;
        }
      } catch (err) {
        if (isAbort(err) || signal?.aborted) throw err;
        errors.push({ source: source.name, url: source.url, error: err.message || String(err) });
        report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, error: err.message || String(err), county });
      }
    }
    if (!primary) return false;

    // Enrichment sources (attribute-only joins on parcel id)
    const enrichers = provider.sources.filter((s) => s.enrich && s !== primary);
    const enrichMaps = [];
    await Promise.all(enrichers.map(async (source) => {
      try {
        const prep = await prepareSource(source, { signal });
        const fc = await queryFeatures(source.url, { bbox, info: prep.info, signal, outFields: ['*'], returnGeometry: false });
        const byId = new Map();
        for (const f of fc.features) {
          const attrs = extractAttrs(f.properties || {}, prep, source);
          attrs._sourceName = source.name;
          const k = normalizeParcelId(attrs.parcel_id);
          if (k) byId.set(k, attrs);
        }
        enrichMaps.push({ source, byId, prep });
        report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: true, count: fc.features.length, role: 'enrich', fieldMap: prep.fieldMap, county, confidence: source.confidence });
      } catch (err) {
        if (isAbort(err) || signal?.aborted) throw err;
        report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, role: 'enrich', error: err.message || String(err), county });
      }
    }));
    if (signal?.aborted) throw new ArcGISError('Cancelled', { code: 'aborted' });

    const prepared = [];
    for (const f of primaryFC.features) {
      const props = f.properties || {};
      const attrs = extractAttrs(props, primaryPrep, primary);
      attrs._sourceName = primary.name;
      if (attrs.county) attrs.county = this.countyName(attrs.county);
      const featureCounty = attrs.county || county || (provider.counties[0] !== '*' ? provider.counties[0] : '');
      if (onlyCounties && featureCounty && !onlyCounties.has(String(featureCounty).toLowerCase())) continue;
      const k = normalizeParcelId(attrs.parcel_id);
      const extras = k ? enrichMaps.map((e) => e.byId.get(k)).filter(Boolean) : [];
      const merged = extras.length ? mergeAttrs(attrs, extras) : attrs;
      prepared.push({ f, merged, featureCounty });
    }
    if (primary.lookup) {
      for (const p of prepared) {
        // lookup metadata lives on the primary's raw attributes
        if (p.merged._rawCounty === undefined) p.merged._rawCounty = '';
      }
      await applyLookup(primary, prepared.map((p) => p.merged), signal);
    }
    let added = 0;
    for (const { f, merged, featureCounty } of prepared) {
      const rec = buildRecord({ feature: f, provider, source: primary, attrs: merged, county: featureCounty });
      if (!records.has(rec.key)) {
        records.set(rec.key, rec);
        added += 1;
      }
    }
    if (primaryFC.features.length) {
      report({
        provider: provider.key,
        providerName: provider.name,
        source: primary.name,
        url: primary.url,
        ok: true,
        role: 'primary',
        count: added,
        truncated: primaryFC.truncated,
        fieldMap: primaryPrep.fieldMap,
        how: primaryPrep.how,
        layerName: primaryPrep.info.name,
        county,
        errors,
        confidence: primary.confidence,
      });
    }
    return added;
  }
}
