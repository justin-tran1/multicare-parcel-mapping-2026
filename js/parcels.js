// ParcelService: routes a bounding box to the right county provider(s), queries the live
// ArcGIS layers, joins enrichment layers by parcel id (spatially, by id list, or from a
// pre-built assessor extract), assigns zoning from zoning-district polygons, and normalizes
// features into records.

import { getLayerInfo, queryFeatures, request, fetchJson, ArcGISError } from './arcgis.js';
import { resolveFieldMap, toNumber, cleanText, toISODate } from './fields.js';
import { PROVIDERS, STATEWIDE } from './providers.js';
import { decodeDOR } from './dor_codes.js';
import {
  geometryBBox, bboxIntersects, expandBBox, pointInGeometry, geometryAreaSqM, sqMToAcres, SQFT_PER_ACRE,
  polygonsOf, labelPoint,
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

const SALE_GROUP = ['sale_date', 'sale_price', 'sale_grantor', 'sale_deed_type'];
const ID_JOIN_CHUNK = 100;

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

// Sources published only as an ArcGIS Online / Hub item (the service URL is not stable or
// not documented) are resolved through the portal's item endpoint: { id, layer, portal }.
const itemUrlCache = new Map();

function sourceKey(source) {
  return source.url || (source.item ? `item:${source.item.portal || ''}${source.item.id}/${source.item.layer ?? 0}` : source.id);
}

async function resolveSourceUrl(source) {
  if (source.url) return source.url;
  if (!source.item?.id) throw new ArcGISError('Source has neither a layer URL nor a portal item id', { code: 'config' });
  const { id, layer = 0, portal = 'https://www.arcgis.com' } = source.item;
  const key = `${portal}|${id}|${layer}`;
  if (!itemUrlCache.has(key)) {
    const p = (async () => {
      const item = await fetchJson(`${portal}/sharing/rest/content/items/${encodeURIComponent(id)}?f=json`, { timeoutMs: 20000 });
      if (!item?.url) throw new ArcGISError('Portal item has no service URL', { code: 'item', url: `${portal}/home/item.html?id=${id}` });
      let url = String(item.url).trim().replace(/\/+$/, '');
      if (!/\/\d+$/.test(url)) url = `${url}/${layer}`;
      return url;
    })();
    itemUrlCache.set(key, p);
    p.catch(() => itemUrlCache.delete(key));
  }
  return itemUrlCache.get(key);
}

// The metadata fetch is shared by every caller, so it must not be bound to any one caller's
// abort signal; callers race the shared promise against their own signal instead.
async function prepareSource(source, { signal } = {}) {
  const key = sourceKey(source);
  if (!layerPrep.has(key)) {
    const p = (async () => {
      const url = await resolveSourceUrl(source);
      // Sources are shared registry objects: remember the resolved URL for queries and reports.
      if (!source.url) source.url = url;
      const info = await getLayerInfo(url);
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
      const fieldTypes = {};
      for (const f of info.fields) fieldTypes[f.name.toLowerCase()] = f.type;
      return { url, info, fieldMap: map, how, missingComputed, domains, fieldTypes };
    })();
    layerPrep.set(key, p);
    p.catch(() => layerPrep.delete(key));
  }
  return withSignal(layerPrep.get(key), signal);
}

const isAbort = (err) => err?.code === 'aborted' || err?.name === 'AbortError';
const errText = (err) => err?.message || String(err);

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
        const code = String(a._lookupCode).trim();
        // the State table keys codes as "<county number>-<code>" (e.g. "53-1101")
        const desc = table.get(code) ?? table.get(`${part}-${code}`) ?? table.get(`${String(Number(part))}-${code}`);
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

// Pre-built assessor extracts (see scripts/build-pierce-assessor.mjs) published with the
// site as a manifest plus JSON shards keyed by normalized parcel number.
const staticCache = new Map(); // path -> Promise<object>

async function defaultStaticLoader(path, { signal } = {}) {
  let base = '';
  if (typeof document !== 'undefined' && document.baseURI) base = document.baseURI;
  else if (typeof location !== 'undefined' && location.href) base = location.href;
  let url = path;
  if (/^https?:\/\//i.test(path)) url = path;
  else if (base && /^https?:/i.test(base)) url = new URL(path, base).href;
  else if (base && /^file:/i.test(base) && globalThis.__STATIC_DATA_BASE) url = new URL(path, globalThis.__STATIC_DATA_BASE).href;
  // Own timeout: the shared cache promise is not bound to any caller's signal, so a stalled
  // request must fail on its own instead of hanging every study that joins it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new ArcGISError('Request timed out', { url, code: 'timeout' })), 30000);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    try {
      res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    } catch (err) {
      if (ctrl.signal.reason instanceof ArcGISError) throw ctrl.signal.reason;
      if (signal?.aborted) throw new ArcGISError('Cancelled', { url, code: 'aborted', cause: err });
      throw new ArcGISError(`Network error: ${err.message}`, { url, code: 'network', cause: err });
    }
    if (!res.ok) throw new ArcGISError(`HTTP ${res.status}`, { url, code: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function loadStatic(loader, path, signal) {
  if (!staticCache.has(path)) {
    const p = loader(path);
    staticCache.set(path, p);
    p.catch(() => staticCache.delete(path));
  }
  return withSignal(staticCache.get(path), signal);
}

export function clearStaticCache() {
  staticCache.clear();
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

const has = (v) => v !== null && v !== undefined && v !== '';

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
    legal_owner: cleanText(getField(props, m.legal_owner)),
    business_name: cleanText(getField(props, m.business_name)),
    exemption: cleanText(getField(props, m.exemption)),
    zoning: cleanText(getField(props, m.zoning)),
    zoning_description: cleanText(getField(props, m.zoning_description)),
    sale_date: toISODate(getField(props, m.sale_date), { epochMs: m.sale_date ? prep.fieldTypes?.[m.sale_date.toLowerCase()] === 'esriFieldTypeDate' : false }),
    sale_price: toNumber(getField(props, m.sale_price)),
    sale_grantor: cleanText(getField(props, m.sale_grantor)),
    sale_deed_type: cleanText(getField(props, m.sale_deed_type)),
    _sourceFields: {},
    _notes: {},
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
  if (out.zoning && !out.zoning_description) {
    const zName = decodeDomain(prep, m.zoning, getField(props, m.zoning));
    if (zName && zName !== out.zoning) {
      out.zoning_description = zName;
      out._sourceFields.zoning_description = `${m.zoning} (domain)`;
    }
  }
  // Parcel number stored as components (e.g. King County Major + Minor).
  if (Array.isArray(source.idCompose)) {
    const parts = source.idCompose.map((f) => cleanText(getField(props, f)));
    if (parts.every(Boolean)) {
      out.parcel_id = parts.join('');
      out._sourceFields.parcel_id = source.idCompose.join(' + ');
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
    const empty = !has(out[attr]);
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
  if (source.notesFor) for (const [attr, note] of Object.entries(source.notesFor)) if (has(out[attr])) out._notes[attr] = note;
  if (source.override) out._override = source.override;
  return out;
}

/** Normalizes one record of a pre-built extract (already in normalized attribute names). */
function staticAttrs(rec, source) {
  const out = { _sourceFields: {}, _notes: { ...(rec._notes || {}) } };
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    if (k === 'sale_date') out[k] = toISODate(v);
    else if (/_(value|price|acres|sqft)$/.test(k)) out[k] = toNumber(v);
    else out[k] = cleanText(v);
    if (has(out[k])) out._sourceFields[k] = rec._fields?.[k] || source.static.fieldLabels?.[k] || k;
  }
  if (source.notesFor) for (const [attr, note] of Object.entries(source.notesFor)) if (has(out[attr]) && !out._notes[attr]) out._notes[attr] = note;
  if (source.override) out._override = source.override;
  if (source.ownerNote && out.owner) out._ownerNote = source.ownerNote;
  return out;
}

const saleRank = (a) => `${a.sale_date || ''}|${String(a.sale_price ?? 0).padStart(15, '0')}`;
// Fields that describe the same transaction as sale_date and move with it. A legal owner
// that arrives on a row with a sale date is the buyer of that sale; a legal owner without a
// sale date (a title-owner field) is an ordinary attribute.
const VALID_SALE = ['valid_sale_date', 'valid_sale_price'];
// Validity metadata supplied with a sale (assessor flags, recording number): always describes
// the displayed sale, so it is replaced together with it.
const SALE_META = ['sale_valid', 'sale_exclude_reason', 'sale_etn', 'sale_parcel_count'];
const saleKeysOf = (row) => (row.sale_date && has(row.legal_owner) ? [...SALE_GROUP, 'legal_owner', ...SALE_META] : [...SALE_GROUP, ...SALE_META]);
const pricedOf = (row) => (row.sale_date && has(row.sale_price) && row.sale_price > 0 ? { date: row.sale_date, price: row.sale_price } : null);

/** Remembers the latest priced sale seen for a parcel so a $0 transfer can be qualified. */
function trackPriced(cur, row) {
  const cand = pricedOf(row);
  if (cand && (!cur._bestPriced || cand.date > cur._bestPriced.date)) cur._bestPriced = cand;
  if (has(row.valid_sale_date)) cur._validExplicit = true; // the source (Pierce extract) computed it
  if (cur._validExplicit) return;
  if (cur._bestPriced && cur._bestPriced.date !== cur.sale_date) {
    cur.valid_sale_date = cur._bestPriced.date;
    cur.valid_sale_price = cur._bestPriced.price;
  } else {
    delete cur.valid_sale_date;
    delete cur.valid_sale_price;
  }
}

/**
 * Stores one enrichment row under a parcel key. Sales tables carry several rows per
 * parcel: the most recent sale wins and other attributes fill gaps.
 */
export function putEnrich(byId, k, attrs) {
  const cur = byId.get(k);
  if (!cur) {
    trackPriced(attrs, attrs);
    byId.set(k, attrs);
    return;
  }
  const newer = attrs.sale_date && (!cur.sale_date || saleRank(attrs) > saleRank(cur));
  const saleKeys = new Set([...saleKeysOf(attrs), ...saleKeysOf(cur), ...VALID_SALE]);
  for (const [key, v] of Object.entries(attrs)) {
    if (key.startsWith('_')) continue;
    if (saleKeys.has(key)) {
      if (newer) {
        cur[key] = v;
        if (attrs._sourceFields[key]) cur._sourceFields[key] = attrs._sourceFields[key];
        if (attrs._notes?.[key]) cur._notes[key] = attrs._notes[key];
      }
      continue;
    }
    if (!has(cur[key]) && has(v)) {
      cur[key] = v;
      if (attrs._sourceFields[key]) cur._sourceFields[key] = attrs._sourceFields[key];
    }
  }
  if (newer) for (const key of [...VALID_SALE, ...SALE_META]) if (!has(attrs[key])) delete cur[key];
  trackPriced(cur, attrs);
}

export function mergeAttrs(primary, extras) {
  const out = { ...primary, _sourceFields: { ...primary._sourceFields }, _notes: { ...(primary._notes || {}) } }; // keeps _rawCounty/_lookupCode
  for (const extra of extras) {
    const override = new Set(extra._override || []);
    const label = (k) => `${extra._sourceFields?.[k] || k} (${extra._sourceName})`;
    const saleKeys = new Set([...saleKeysOf(extra), ...VALID_SALE]);
    for (const [k, v] of Object.entries(extra)) {
      if (k.startsWith('_') || saleKeys.has(k)) continue;
      const empty = !has(out[k]);
      if (has(v) && (empty || override.has(k))) {
        out[k] = v;
        out._sourceFields[k] = label(k);
        if (extra._notes?.[k]) out._notes[k] = extra._notes[k];
        else if (!empty) delete out._notes[k];
        if (k === 'owner') {
          if (extra._ownerNote) out._ownerNote = extra._ownerNote;
          else if (!empty) delete out._ownerNote;
        }
      }
    }
    // A more recent (or overriding) sale replaces the sale group as a unit so that the
    // date, price, grantor, deed type and buyer always describe the same transaction.
    if (extra.sale_date && (!out.sale_date || saleRank(extra) > saleRank(out) || override.has('sale_date'))) {
      for (const k of saleKeysOf(extra)) {
        if (has(extra[k])) {
          out[k] = extra[k];
          out._sourceFields[k] = label(k);
        } else if (SALE_META.includes(k)) delete out[k];
        else out[k] = null;
        if (extra._notes?.[k]) out._notes[k] = extra._notes[k];
      }
      for (const k of VALID_SALE) {
        if (has(extra[k])) out[k] = extra[k];
        else delete out[k];
      }
      // The previous latest sale becomes the "last market sale" when the new one is unpriced.
      if (!(extra.sale_price > 0) && primary.sale_price > 0 && primary.sale_date && !has(out.valid_sale_date)) {
        out.valid_sale_date = primary.sale_date;
        out.valid_sale_price = primary.sale_price;
      }
    } else if (extra.sale_date && has(out.sale_date) && !(out.sale_price > 0) && extra.sale_price > 0 && !has(out.valid_sale_date)) {
      out.valid_sale_date = extra.sale_date;
      out.valid_sale_price = extra.sale_price;
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
  if (has(attrs.taxable_value)) {
    value = attrs.taxable_value;
    valueKind = 'taxable';
  } else if (has(attrs.total_value)) {
    value = attrs.total_value;
    valueKind = 'total';
  } else if (has(attrs.land_value) || has(attrs.improvement_value)) {
    value = (attrs.land_value || 0) + (attrs.improvement_value || 0);
    valueKind = 'land+impr';
  }

  let acres = null;
  let acresSource = 'none';
  if (has(attrs.land_acres) && attrs.land_acres > 0) {
    acres = attrs.land_acres;
    acresSource = 'assessor';
  } else if (has(attrs.land_sqft) && attrs.land_sqft > 0) {
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

  const taxpayer = attrs.owner || '';
  const legalOwner = attrs.legal_owner || '';
  const owner = taxpayer || legalOwner;
  const zoningSource = attrs._zoningSource || (attrs.zoning ? 'assessor' : '');

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
    owner,
    ownerSource: taxpayer ? 'taxpayer' : legalOwner ? 'legal' : 'none',
    ownerNote: attrs._ownerNote || '',
    taxpayer,
    legalOwner,
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
    businessName: attrs.business_name || '',
    exemption: attrs.exemption || '',
    zoning: attrs.zoning || '',
    zoningDescription: attrs.zoning_description || '',
    zoningSource,
    zoningJurisdiction: attrs._zoningJurisdiction || '',
    saleDate: attrs.sale_date || null,
    salePrice: has(attrs.sale_price) ? attrs.sale_price : null,
    saleGrantor: attrs.sale_grantor || '',
    saleDeedType: attrs.sale_deed_type || '',
    saleValid: attrs.sale_valid === undefined || attrs.sale_valid === null || attrs.sale_valid === '' ? null : String(attrs.sale_valid) === '1' || attrs.sale_valid === true || String(attrs.sale_valid).toLowerCase() === 'true',
    saleExcludeReason: attrs.sale_exclude_reason || '',
    saleEtn: attrs.sale_etn || '',
    validSaleDate: attrs.valid_sale_date || null,
    validSalePrice: has(attrs.valid_sale_price) ? attrs.valid_sale_price : null,
    notes: attrs._notes || {},
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

function pointInBBox([x, y], [minX, minY, maxX, maxY]) {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** Assigns zoning from district polygons to parcels that have none, by label point. */
function assignZoning(prepared, zoningSets) {
  let assigned = 0;
  for (const p of prepared) {
    if (p.merged.zoning) continue;
    const geom = p.f.geometry;
    if (!geom) continue;
    if (!p._label) {
      const polys = polygonsOf(geom);
      if (!polys.length) continue;
      p._label = labelPoint(polys);
    }
    const pt = p._label;
    outer: for (const z of zoningSets) {
      for (const zf of z.features) {
        if (!pointInBBox(pt, zf.bbox) || !pointInGeometry(pt, zf.geometry)) continue;
        p.merged.zoning = zf.code;
        p.merged.zoning_description = zf.description || '';
        p.merged._zoningSource = z.source.name;
        p.merged._zoningJurisdiction = zf.jurisdiction || z.source.jurisdiction || '';
        p.merged._sourceFields.zoning = `${z.fieldMap.zoning} (${z.source.name}, at parcel label point)`;
        if (zf.description) p.merged._sourceFields.zoning_description = `${z.fieldMap.zoning_description} (${z.source.name})`;
        z.assigned += 1;
        assigned += 1;
        break outer;
      }
    }
  }
  return assigned;
}

export class ParcelService {
  /**
   * @param {{counties: GeoJSON.FeatureCollection, providers?: object[], statewide?: object, staticLoader?: Function}} opts
   */
  constructor({ counties, providers = PROVIDERS, statewide = STATEWIDE, staticLoader = defaultStaticLoader }) {
    this.counties = counties;
    this.providers = providers;
    this.statewide = statewide;
    this.staticLoader = staticLoader;
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
        if (added !== false && added > 0) return { county, ok: true, provider };
      }
      return { county, ok: false, provider };
    });
    const results = await Promise.all(countyJobs);
    const failed = results.filter((r) => !r.ok);
    if (failed.length || counties.length === 0) {
      // Zoning districts of the counties being back-filled still apply to the State parcels.
      const zoning = failed.flatMap((r) => r.provider?.zoning || []);
      await this.runProvider(this.statewide, bbox, null, records, report, signal, counties.length ? new Set(failed.map((r) => r.county.toLowerCase())) : null, zoning);
    }
    return { records: [...records.values()], statuses, counties };
  }

  /** Queries zoning-district polygons for the area; resolves the sets that answered. */
  async fetchZoning(provider, zoningSources, bbox, county, report, signal) {
    if (!zoningSources.length) return [];
    const area = expandBBox(bbox, 400);
    const sets = await Promise.all(zoningSources.map(async (source) => {
      // City layers carry an approximate extent so that studies elsewhere skip them.
      if (source.extent && !bboxIntersects(source.extent, area)) return null;
      try {
        const prep = await prepareSource(source, { signal });
        const fm = prep.fieldMap;
        if (!fm.zoning) throw new ArcGISError('No zoning code field found on this layer', { url: source.url, code: 'schema' });
        const fc = await queryFeatures(source.url, { bbox: area, info: prep.info, signal, outFields: [fm.zoning, fm.zoning_description, source.jurisdictionField].filter(Boolean) });
        const exclude = source.exclude ? new RegExp(source.exclude, 'i') : null;
        const features = [];
        for (const f of fc.features) {
          if (!f.geometry) continue;
          const props = f.properties || {};
          const code = cleanText(getField(props, fm.zoning));
          if (!code || (exclude && exclude.test(code))) continue;
          let description = cleanText(getField(props, fm.zoning_description));
          if (!description) description = decodeDomain(prep, fm.zoning, getField(props, fm.zoning)) || '';
          if (description === code) description = '';
          const jurisdiction = source.jurisdictionField ? cleanText(getField(props, source.jurisdictionField)) : '';
          features.push({ geometry: f.geometry, bbox: geometryBBox(f.geometry), code, description, jurisdiction });
        }
        const set = { source, features, fieldMap: fm, assigned: 0 };
        report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: true, role: 'zoning', count: features.length, truncated: fc.truncated, fieldMap: fm, county, confidence: source.confidence, jurisdiction: source.jurisdiction || '' });
        return set;
      } catch (err) {
        if (isAbort(err) || signal?.aborted) throw err;
        report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, role: 'zoning', error: errText(err), county, jurisdiction: source.jurisdiction || '' });
        return null;
      }
    }));
    return sets.filter(Boolean);
  }

  /** Attribute-only layer joined by bbox: returns a Map(normalized parcel id -> attrs). */
  async fetchBBoxEnrich(provider, source, bbox, county, report, signal) {
    try {
      const prep = await prepareSource(source, { signal });
      const fc = await queryFeatures(source.url, { bbox, info: prep.info, signal, outFields: ['*'], returnGeometry: false });
      const byId = new Map();
      for (const f of fc.features) {
        const attrs = extractAttrs(f.properties || {}, prep, source);
        attrs._sourceName = source.name;
        const k = normalizeParcelId(attrs.parcel_id);
        if (k) putEnrich(byId, k, attrs);
      }
      report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: true, count: fc.features.length, role: 'enrich', fieldMap: prep.fieldMap, county, confidence: source.confidence });
      return { source, byId, prep };
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw err;
      report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, role: 'enrich', error: errText(err), county });
      return null;
    }
  }

  /** Attribute table joined by parcel id list (WHERE <id> IN (...), in chunks). */
  async fetchIdEnrich(provider, source, prepared, county, report, signal) {
    try {
      const prep = await prepareSource(source, { signal });
      const joinField = source.joinField || prep.fieldMap.parcel_id;
      if (!joinField) throw new ArcGISError('No parcel id field found on this table', { url: source.url, code: 'schema' });
      const numeric = /Integer|Double|Single|OID/i.test(prep.fieldTypes[joinField.toLowerCase()] || '');
      const values = new Set();
      for (const p of prepared) {
        const v = source.joinValue ? source.joinValue(p.merged, p.f.properties || {}) : p.merged.parcel_id;
        if (has(v)) values.add(String(v).trim());
      }
      const list = [...values];
      const byId = new Map();
      let rows = 0;
      for (let i = 0; i < list.length; i += ID_JOIN_CHUNK) {
        if (signal?.aborted) throw new ArcGISError('Cancelled', { code: 'aborted' });
        const chunk = list.slice(i, i + ID_JOIN_CHUNK);
        const lits = numeric ? chunk.filter((v) => /^-?\d+(\.\d+)?$/.test(v)) : chunk.map((v) => `'${v.replace(/'/g, "''")}'`);
        if (!lits.length) continue;
        const where = `${joinField} IN (${lits.join(',')})`;
        const fc = await queryFeatures(source.url, { where, info: prep.info, signal, outFields: ['*'], returnGeometry: false });
        for (const f of fc.features) {
          const attrs = extractAttrs(f.properties || {}, prep, source);
          attrs._sourceName = source.name;
          const k = normalizeParcelId(attrs.parcel_id || getField(f.properties || {}, joinField));
          if (k) putEnrich(byId, k, attrs);
          rows += 1;
        }
      }
      report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: true, count: rows, role: 'enrich', joined: byId.size, fieldMap: prep.fieldMap, county, confidence: source.confidence });
      return { source, byId, prep };
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw err;
      report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, role: 'enrich', error: errText(err), county });
      return null;
    }
  }

  /** Pre-built assessor extract (manifest + shards keyed by normalized parcel id). */
  async fetchStaticEnrich(provider, source, prepared, county, report, signal) {
    const st = source.static;
    try {
      const manifest = await loadStatic(this.staticLoader, st.manifest, signal);
      const prefixLength = Number(manifest.prefixLength || st.prefixLength || 3);
      const available = Array.isArray(manifest.shards) ? new Set(manifest.shards.map(String)) : null;
      const prefixes = new Set();
      for (const p of prepared) {
        const k = normalizeParcelId(p.merged.parcel_id);
        if (k.length >= prefixLength) prefixes.add(k.slice(0, prefixLength));
      }
      const byId = new Map();
      let rows = 0;
      await Promise.all([...prefixes].map(async (prefix) => {
        if (available && !available.has(prefix)) return;
        let shard;
        try {
          shard = await loadStatic(this.staticLoader, st.shard.replace('{prefix}', prefix), signal);
        } catch (err) {
          if (isAbort(err)) throw err;
          if (err?.code === 404) return; // no parcels with this prefix
          throw err;
        }
        const recs = shard.records || shard;
        for (const [id, rec] of Object.entries(recs)) {
          if (id.startsWith('_') || !rec || typeof rec !== 'object') continue;
          const attrs = staticAttrs(rec, source);
          attrs._sourceName = source.name;
          const k = normalizeParcelId(id);
          if (k) putEnrich(byId, k, attrs);
          rows += 1;
        }
      }));
      let joined = 0;
      for (const p of prepared) if (byId.has(normalizeParcelId(p.merged.parcel_id))) joined += 1;
      const url = source.url || (manifest.sourceUrl || st.manifest);
      report({
        provider: provider.key, providerName: provider.name, source: source.name, url, ok: true, role: 'static', count: rows, joined,
        generated: manifest.generated || '', asOf: manifest.asOf || '', county, confidence: source.confidence, fieldMap: manifest.fields || {}, note: manifest.notes || source.notes || '',
      });
      return { source, byId, prep: null };
    } catch (err) {
      if (isAbort(err) || signal?.aborted) throw err;
      const missing = err?.code === 404 || err?.code === 'network';
      report({
        provider: provider.key, providerName: provider.name, source: source.name, url: source.url || st.manifest, ok: false, role: 'static', county,
        error: missing ? `${errText(err)} — the assessor extract is published with the site by the weekly data workflow` : errText(err),
      });
      return null;
    }
  }

  async runProvider(provider, bbox, county, records, report, signal, onlyCounties = null, extraZoning = []) {
    // Zoning: the jurisdiction layers handed down by a county fallback first, then the
    // provider's own list (else the statewide atlas); deduplicated by id, first wins.
    const seenZoning = new Set();
    const zoningSources = [...extraZoning, ...(provider.zoning || this.statewide?.zoning || [])].filter((s) => !seenZoning.has(s.id) && seenZoning.add(s.id));
    const isBBoxEnrich = (s) => s.enrich && !s.static && s.joinBy !== 'ids';
    // Zoning districts and attribute-only join layers do not depend on which geometry layer
    // answers, so they run alongside the primary query.
    const zoningJob = this.fetchZoning(provider, zoningSources, bbox, county, report, signal);
    const earlyJobs = provider.sources.filter((s) => isBBoxEnrich(s) && !s.geometry).map((s) => this.fetchBBoxEnrich(provider, s, bbox, county, report, signal));
    const settle = () => Promise.allSettled([zoningJob, ...earlyJobs]);

    let primary = null;
    let primaryPrep = null;
    let primaryFC = null;
    const errors = [];
    const unusable = new Set(); // geometry sources that failed or answered empty this run
    const geometrySources = provider.sources.filter((s) => s.geometry);
    try {
      for (const source of geometrySources) {
        if (signal?.aborted) throw new ArcGISError('Cancelled', { code: 'aborted' });
        try {
          const prep = await prepareSource(source, { signal });
          const fc = await queryFeatures(source.url, { bbox, info: prep.info, signal, outFields: ['*'] });
          if (!fc.features.length) unusable.add(source);
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
          unusable.add(source);
          errors.push({ source: source.name, url: source.url, error: errText(err) });
          report({ provider: provider.key, providerName: provider.name, source: source.name, url: source.url, ok: false, error: errText(err), county });
        }
      }
    } catch (err) {
      await settle();
      throw err;
    }
    if (!primary) {
      await settle();
      return false;
    }

    const prepared = [];
    for (const f of primaryFC.features) {
      const props = f.properties || {};
      const attrs = extractAttrs(props, primaryPrep, primary);
      attrs._sourceName = primary.name;
      if (attrs.county) attrs.county = this.countyName(attrs.county);
      const featureCounty = attrs.county || county || (provider.counties[0] !== '*' ? provider.counties[0] : '');
      if (onlyCounties && featureCounty && !onlyCounties.has(String(featureCounty).toLowerCase())) continue;
      prepared.push({ f, merged: attrs, featureCounty });
    }

    // Geometry layers that double as attribute joins (other than the primary and any that
    // just failed or answered empty), then joins that need the parcel list: id-list tables
    // and pre-built extracts.
    const lateJobs = provider.sources.filter((s) => isBBoxEnrich(s) && s.geometry && s !== primary && !unusable.has(s)).map((s) => this.fetchBBoxEnrich(provider, s, bbox, county, report, signal));
    const idEnrichers = provider.sources.filter((s) => s.enrich && s !== primary && (s.static || s.joinBy === 'ids'));
    const idJobs = prepared.length
      ? idEnrichers.map((s) => (s.static ? this.fetchStaticEnrich(provider, s, prepared, county, report, signal) : this.fetchIdEnrich(provider, s, prepared, county, report, signal)))
      : [];
    const [zoningSets, ...enrichResults] = await Promise.all([zoningJob, ...earlyJobs, ...lateJobs, ...idJobs]);
    if (signal?.aborted) throw new ArcGISError('Cancelled', { code: 'aborted' });
    // Provider order defines join precedence.
    const order = new Map(provider.sources.map((s, i) => [s, i]));
    const enrichMaps = enrichResults.filter(Boolean).sort((a, b) => (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99));

    for (const p of prepared) {
      const k = normalizeParcelId(p.merged.parcel_id);
      const extras = k ? enrichMaps.map((e) => e.byId.get(k)).filter(Boolean) : [];
      if (extras.length) p.merged = mergeAttrs(p.merged, extras);
    }
    if (primary.lookup) {
      for (const p of prepared) {
        // lookup metadata lives on the primary's raw attributes
        if (p.merged._rawCounty === undefined) p.merged._rawCounty = '';
      }
      await applyLookup(primary, prepared.map((p) => p.merged), signal);
    }
    let zoned = zoningSets.length ? assignZoning(prepared, zoningSets) : 0;
    // Large parcels that touch the envelope can have their label point beyond the area the
    // zoning layers were queried for; fetch those spots once more (without re-reporting).
    if (zoningSources.length) {
      const area = expandBBox(bbox, 400);
      const outside = prepared.filter((p) => !p.merged.zoning && p._label && !pointInBBox(p._label, area));
      if (outside.length) {
        const pts = outside.map((p) => p._label);
        const ptBBox = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
        const extraSets = await this.fetchZoning(provider, zoningSources, ptBBox, county, () => {}, signal);
        if (extraSets.length) zoned += assignZoning(outside, extraSets);
      }
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
        zoned,
      });
    }
    return added;
  }
}
