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
  'legal_owner',
  'zoning',
  'zoning_description',
  'sale_date',
  'sale_price',
  'sale_grantor',
  'sale_deed_type',
  'business_name',
  'exemption',
];

const ADDRESSY = /(addr|address|city|state|zip|mail|street|line)/i;

const HEURISTICS = {
  parcel_id: {
    include: /((^|[^a-z])(pin|apn|pid|pid_?num|acct|account|geo_?id|tax_?acct)([^a-z]|$)|parcel|prop_?id|rp_?acct)/i,
    exclude: /(link|url|desc|type|status|count|src|source|orig|prev|old|prior|_ct$|cnt|major|minor|area|acre|sqft|shape|flag|date|year|split|dup)/i,
    prefer: /^(pin|apn|parcel|taxparcel|tax_?parcel|taxparcelnumber|parcelid|parcel_?(id|no|num|number|nbr)|parcel_id_nr|pid|pid_num|prop_?id)$/i,
  },
  owner: {
    include: /(taxpayer|owner|ownr|tax_?payer)/i,
    // title/legal/deed-holder fields belong to legal_owner
    exclude: /(addr|address|city|state|zip|mail|line|type|code|count|pct|percent|flag|occup|id$|date|dt$|url|link|attn|care_?of|title|legal|deed|grantee|record)/i,
    prefer: /name/i,
    deprioritize: /[2-9]$/,
  },
  owner_address: {
    include: /(taxpayer|owner|ownr|mail).*?(addr|address|street|line)|(addr|address).*?(taxpayer|owner|mail)/i,
    exclude: /(city|state|zip)/i,
  },
  situs_address: {
    include: /(situs|site_?addr|site_?address|addr_?full|full_?addr|prop_?addr|property_?addr|location|address|street_?addr|physical_?addr)/i,
    exclude: /(owner|taxpayer|mail|deed|holder|purchaser|kctp|city|state|zip|_no$|number|num$|dir|suffix|prefix|unit|type|link|url|_st$|_sub$|hs_?num|bldg)/i,
    prefer: /(situs_?addr(ess)?$|full|site_?addr(ess)?$|addr_?full)/i,
  },
  situs_city: {
    include: /((situs|site|prop|property|location|postal|sit)_?city|^city$|^city_?(name|nm)$|ctyname|^situs_?cty)/i,
    exclude: /(owner|taxpayer|kctp|mail|deliv|zip|state|county|link|url|tax_?payer)/i,
  },
  taxable_value: {
    include: /(taxable|tax_?val|taxval|tax_?value|tx_?val)/i,
    exclude: /(land|impr|improv|bldg|building|prev|prior|year|yr|desc|code|status|stat$|flag|pct|rate|_dt|date|rsn|reason|ind$|exempt|adj)/i,
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
    // Only fields that are unambiguously square feet. Generic "area" fields (Shape_Area,
    // GIS_AREA, LAND_AREA) are in the layer's native units and are deliberately excluded;
    // acreage is computed from the geometry instead.
    include: /(sq_?ft|sqft|square_?f|lot_?size|lotsz|land_?sf|area_?sf|lot_?sq)/i,
    exclude: /(bldg|building|impr|improv|living|gross_?bldg|floor|footprint|nra|gla|desc|code|garage|basement|attic|porch|deck|finished|unfinished|carport|shop|barn|res_?sq|house)/i,
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
  legal_owner: {
    include: /(title_?owner|deed_?holder|legal_?owner|grantee|buyer|record_?owner|owner_?of_?record)/i,
    exclude: /(addr|address|city|state|zip|mail|id$|date|_dt$|type|code|count|flag)/i,
    prefer: /name/i,
  },
  zoning: {
    include: /(^zon(e|ing)|_zon(e|ing)|zone_?(code|cd|class|dist|district)|zoning_?(code|cd|class|dist|district)|zn_?code|zonecode|zoning$|zone$)/i,
    // tax code areas, UTM/time/climate zones, utility zones, ordinance and area fields are
    // not zoning districts
    exclude: /(desc|description|name|text|label|overlay|prev|prior|proposed|future|comp|plan|flood|fire|school|seismic|airport|uga|_id$|id$|link|url|date|tax|tca|levy|utm|sewer|water|climate|snow|wind|time|acre|area|ord|market|nbhd|neighbo|value|appr|assess|police|ems|transit|parking|noise|hazard|liquef|wetland|shoreline|critical)/i,
    prefer: /(^zoning$|^zone$|zone_?code|zone_?cd|zoning_?code|kca_?zoning|^zon_cur_cd$)/i,
  },
  zoning_description: {
    include: /(zon(e|ing).*(desc|description|name|label|text)|(desc|description|name).*zon(e|ing))/i,
    exclude: /(overlay|proposed|future|comp|plan|flood|fire|school|link|url|date|lu_?des|land_?use|designation)/i,
  },
  sale_date: {
    include: /(sale.*(date|_dt$|dt$)|(date|dt).*sale|deed_?date|document_?date|doc_?date|transfer_?date|trnsf_?date|xfer_?date|recording_?date|excise_?date|sold_?date|date_?sold|year_?sold|sale_?yr|sale_?year)/i,
    exclude: /(appraisal|assess|inspect|insp|create|edit|modif|update|retire|effective|expir|permit|build|record_?type|link|url)/i,
    prefer: /(sale_?date|saledate|document_?date|trnsf_?date|transfer_?date)/i,
  },
  sale_price: {
    include: /(sale.*(price|amt|amount|value|val)|(price|amt|amount).*sale|gross_?sale|consideration|selling_?price)/i,
    // validity / qualification flags and excise-tax fields sit beside prices in WA sales tables
    exclude: /(date|_dt$|per_?sq|psf|ratio|count|pct|percent|adj|prev|prior|link|url|verif|vrfy|type|code|flag|exclude|reason|excise|affidavit|reet|valid|qual|tax_?amt)/i,
    prefer: /(sale_?price|saleprice|sale_?amount|saleamount|gross_?sale)/i,
  },
  sale_grantor: {
    include: /(grantor|seller|sellr)/i,
    exclude: /(addr|address|city|state|zip|id$|date|type|code)/i,
  },
  sale_deed_type: {
    include: /(deed_?type|sale_?instrument|^instrument|transfer_?type|trnsf_?type|document_?type|doc_?type|sale_?type)/i,
    exclude: /(date|_dt$|nbr|num|id$|code$)/i,
  },
  // The business operating on the parcel (occupant), which is not the owner of record.
  business_name: {
    include: /(business_?name|bus_?name|busname|^dba$|dba_?name|occupant|tenant_?name)/i,
    exclude: /(addr|address|owner|taxpayer|id$|code|type|date|_dt$)/i,
  },
  exemption: {
    include: /(exempt)/i,
    exclude: /(amount|amt|value|val|pct|percent|date|_dt$|ind$|senior|count|id$|prior|prev|yr|year|flag|status|stat$)/i,
    prefer: /(type|desc|description|code)/i,
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
const VALUE_ATTRS = new Set(['taxable_value', 'land_value', 'improvement_value', 'total_value', 'land_acres', 'land_sqft', 'sale_price']);

/**
 * Parses an assessor date: epoch milliseconds (ArcGIS), ISO strings, "MM/DD/YYYY",
 * "YYYYMMDD", or a plain year. Returns an ISO date string (YYYY-MM-DD) or null.
 */
export function toISODate(v, { epochMs = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    // Esri date fields are always epoch milliseconds (negative before 1970).
    if (epochMs) return new Date(v).toISOString().slice(0, 10);
    if (v > 1e11) return new Date(v).toISOString().slice(0, 10); // epoch ms
    if (v > 1e9) return new Date(v * 1000).toISOString().slice(0, 10); // epoch s
    if (v >= 18000101 && v <= 21001231) return `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6, 8)}`;
    if (v >= 1800 && v <= 2100) return `${v}`;
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^([A-Za-z]{3})-(\d{4})$/); // "Jun-2026"
  if (m) {
    const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
    if (mi >= 0) return `${m[2]}-${String(mi + 1).padStart(2, '0')}`;
  }
  if (/^\d{4}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * @param {{fields: {name, alias, type}[]}} layerInfo
 * @param {Record<string, string[]|false>} candidates provider-supplied candidate field names per
 *   attribute; `false` disables the attribute for this layer (no candidates, no heuristics)
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
    if (candidates[attr] === false) {
      map[attr] = null;
      how[attr] = 'disabled';
      continue;
    }
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
        if (f.type === 'esriFieldTypeOID' || f.type === 'esriFieldTypeGeometry' || /^shape([._]|$)/i.test(f.name)) continue;
        let s = score(f, HEURISTICS[attr]);
        // exemption text (type / description / code): never a Y/N flag or a numeric field
        if (s && attr === 'exemption' && (f.type !== 'esriFieldTypeString' || (f.length && f.length <= 2))) continue;
        if (s && VALUE_ATTRS.has(attr)) {
          if (NUMERIC_TYPES.has(f.type)) s += 10;
          else if (f.type === 'esriFieldTypeString') {
            // short strings are flags/codes (e.g. TAXABLE = "Y"), never dollar or acre values
            if (f.length && f.length <= 5) continue;
            s -= 5;
          }
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
