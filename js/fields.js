// Maps a layer's raw attribute fields to the normalized parcel attributes used by the app.
// Resolution order: explicit provider candidates (exact, case-insensitive) -> name
// heuristics -> alias heuristics. Every mapping records how it was resolved so the UI
// can show the user exactly which source field feeds each column.

export const ATTRS = [
  'parcel_id',
  'owner',
  'owner_address',
  'situs_address',
  'situs_city',
  'taxable_value',
  'land_value',
  'improvement_value',
  'total_value',
  'land_acres',
  'land_sqft',
  'use_code',
  'use_description',
  'assessor_link',
  'county',
];

const ADDRESSY = /(addr|address|city|state|zip|mail|street|line)/i;

const HEURISTICS = {
  parcel_id: {
    include: /((^|[^a-z])(pin|apn|pid|pid_?num|acct|account|geo_?id|tax_?acct)([^a-z]|$)|parcel|prop_?id|rp_?acct)/i,
    exclude: /(link|url|desc|type|status|count|src|source|orig|prev|old|prior|_ct$|cnt|major|minor|area|acre|sqft|shape|flag|date|year|split|dup)/i,
    prefer: /^(pin|apn|parcel|taxparcel|tax_?parcel|taxparcelnumber|parcelid|parcel_?(id|no|num|number|nbr)|parcel_id_nr|pid|pid_num|prop_?id)$/i,
  },
  owner: {
    include: /(taxpayer|owner|ownr|deed_?holder|tax_?payer)/i,
    exclude: /(addr|address|city|state|zip|mail|line|type|code|count|pct|percent|flag|occup|_id$|\bid$|date|dt$|url|link)/i,
    prefer: /name/i,
    deprioritize: /[2-9]$/,
  },
  owner_address: {
    include: /(taxpayer|owner|ownr|mail).*?(addr|address|street|line)|(addr|address).*?(taxpayer|owner|mail)/i,
    exclude: /(city|state|zip)/i,
  },
  situs_address: {
    include: /(situs|site_?addr|site_?address|addr_?full|full_?addr|prop_?addr|property_?addr|location|address|street_?addr)/i,
    exclude: /(owner|taxpayer|mail|city|state|zip|_no$|number|num$|dir|suffix|prefix|unit|type|link|url)/i,
    prefer: /(situs_?addr(ess)?$|full|site_?addr(ess)?$|addr_?full)/i,
  },
  situs_city: {
    include: /(situs|site|prop|property|location)?.*city/i,
    exclude: /(owner|taxpayer|mail|zip|state|county|link|url)/i,
  },
  taxable_value: {
    include: /(taxable|tax_?val|taxval|tax_?value|tx_?val)/i,
    exclude: /(land|impr|improv|bldg|building|prev|prior|year|yr|desc|code|status|flag|pct|rate|_dt|date)/i,
    prefer: /(total|ttl|tot|taxable_?value|taxable_?val)/i,
  },
  land_value: {
    include: /((land|lnd).*(val|value|market|assess|appr)|(val|value|appr|assess).*(land|lnd)|apprlnd)/i,
    exclude: /(taxable|prev|prior|desc|code|status|flag|pct|rate|date|_dt|acre|sqft|sq_ft|size|use)/i,
    prefer: /(market|assess|appr|current|curr)/i,
  },
  improvement_value: {
    include: /((impr|improv|imp_|bldg|building|struct).*(val|value|market|assess|appr)|(val|value|appr|assess).*(impr|improv|bldg|building|struct)|appr_?impr|apprimp)/i,
    exclude: /(taxable|prev|prior|desc|code|status|flag|pct|rate|date|_dt|type|count|sqft|sq_ft|area|year|yr)/i,
    prefer: /(market|assess|appr|current|curr)/i,
  },
  total_value: {
    include: /((total|ttl|tot|mkt|market|assess|assessed|appraised|av)_?(val|value|mkt|market|assess)|(val|value).*(total|ttl|tot)|total_?(market|assessed)|market_?(total|value)|assessed_?(total|value)|appraised_?(total|value)|^av_?total|totmkt|mktttl|mkttl|total_?av)/i,
    exclude: /(taxable|land|impr|improv|bldg|building|prev|prior|desc|code|status|flag|pct|rate|date|_dt|acre|sqft|sq_ft|size|year|yr|exempt)/i,
    prefer: /(total|ttl|tot)/i,
  },
  land_acres: {
    include: /(acre|acreage|ac_|_ac$|gis_?ac)/i,
    exclude: /(desc|code|status|flag|type|date|_dt|bldg|impr|water|road|deeded_?desc)/i,
    prefer: /(land|deeded|legal|assess|tax|gross|parcel|total)/i,
  },
  land_sqft: {
    include: /(sq_?ft|sqft|square_?f|lot_?size|lotsz|land_?sf|land_?area|lot_?area|parcel_?area|gis_?area|shape_?area|area_?sf)/i,
    exclude: /(bldg|building|impr|improv|living|gross_?bldg|floor|footprint|nra|gla|desc|code)/i,
    prefer: /(lot|land|parcel|legal|deeded)/i,
  },
  use_code: {
    include: /(use_?code|use_?cd|usecode|usecd|landuse_?cd|land_?use_?code|lu_?code|lucode|present_?use|presentuse|prop(erty)?_?class|prop_?type_?code|useclass_?cd|dor_?code|dor_?use|land_?use$|landuse$|use_?type_?code|use$)/i,
    exclude: /(desc|description|name|text|zoning|zone|link|url|date|_dt|prev|prior|highest|best)/i,
    prefer: /(dor|land_?use|landuse|use_?code|present_?use|prop_?class)/i,
  },
  use_description: {
    include: /((use|landuse|land_?use|lu|present_?use|prop_?class|property_?class|class|usecode|use_?code|dor).*(desc|description|name|text|label|txt)|use_?desc|usedesc|landuse_?desc|property_?type$|prop_?type$|land_?use_?type|use_?type$|use_?category|class_?desc)/i,
    exclude: /(zoning|zone|link|url|date|_dt|prev|prior|highest|best|owner|taxpayer)/i,
    prefer: /(land_?use|landuse|use_?desc|present|dor)/i,
  },
  assessor_link: {
    include: /(link|url|website|web_?page|hyperlink|assessor_?url|data_?link)/i,
    exclude: /(photo|image|img|sketch|map_?link|gis_?link)/i,
  },
  county: {
    include: /(county|cnty|co_?name|county_?nm|county_?name)/i,
    exclude: /(fips|code|_cd$|id$|num)/i,
  },
};

function score(field, h) {
  const name = field.name || '';
  const alias = field.alias || '';
  let best = 0;
  for (const [text, base] of [[name, 100], [alias, 60]]) {
    if (!text) continue;
    if (!h.include.test(text)) continue;
    if (h.exclude && h.exclude.test(text)) continue;
    let s = base;
    if (h.prefer && h.prefer.test(text)) s += 20;
    if (h.deprioritize && h.deprioritize.test(text)) s -= 30;
    if (s > best) best = s;
  }
  return best;
}

const NUMERIC_TYPES = new Set(['esriFieldTypeDouble', 'esriFieldTypeSingle', 'esriFieldTypeInteger', 'esriFieldTypeSmallInteger', 'esriFieldTypeBigInteger']);
const VALUE_ATTRS = new Set(['taxable_value', 'land_value', 'improvement_value', 'total_value', 'land_acres', 'land_sqft']);

/**
 * @param {{fields: {name, alias, type}[]}} layerInfo
 * @param {Record<string, string[]>} candidates provider-supplied candidate field names per attribute
 * @returns {{ map: Record<string,string|null>, how: Record<string,string> }}
 */
export function resolveFieldMap(layerInfo, candidates = {}) {
  const fields = layerInfo.fields || [];
  const byLower = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  const byAliasLower = new Map(fields.map((f) => [(f.alias || '').toLowerCase(), f]));
  const map = {};
  const how = {};
  const used = new Set();

  for (const attr of ATTRS) {
    let chosen = null;
    let method = null;
    for (const cand of candidates[attr] || []) {
      const f = byLower.get(String(cand).toLowerCase()) || byAliasLower.get(String(cand).toLowerCase());
      if (f && !used.has(f.name)) {
        chosen = f;
        method = 'provider';
        break;
      }
    }
    if (!chosen && HEURISTICS[attr]) {
      let bestScore = 0;
      for (const f of fields) {
        if (used.has(f.name)) continue;
        if (f.type === 'esriFieldTypeOID' || f.type === 'esriFieldTypeGeometry' || /^shape([._]|$)/i.test(f.name)) {
          if (attr !== 'land_sqft' || !/shape[._]?area/i.test(f.name)) continue;
        }
        let s = score(f, HEURISTICS[attr]);
        if (s && VALUE_ATTRS.has(attr)) {
          if (NUMERIC_TYPES.has(f.type)) s += 10;
          else if (f.type === 'esriFieldTypeString') s -= 5;
        }
        if (s > bestScore) {
          bestScore = s;
          chosen = f;
        }
      }
      if (chosen) method = 'heuristic';
    }
    map[attr] = chosen ? chosen.name : null;
    how[attr] = method;
    if (chosen && attr !== 'county') used.add(chosen.name);
  }
  return { map, how };
}

/** Parses an assessor value that may be a number or a formatted string ("$1,234"). */
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!/\d/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cleanText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}
