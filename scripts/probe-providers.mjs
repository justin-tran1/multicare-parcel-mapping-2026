// Live probe of every provider layer in js/providers.js: reads each layer's metadata,
// resolves the field mapping the app would use, runs a small envelope query near a point
// inside the county, and prints a report. Run from a machine with internet access:
//   node scripts/probe-providers.mjs            # human-readable report
//   node scripts/probe-providers.mjs --json     # JSON report (also written to probe-report.json)
// The CI workflow .github/workflows/probe.yml runs this on GitHub's runners.
import { readFileSync, writeFileSync } from 'node:fs';
import { PROVIDERS, STATEWIDE } from '../js/providers.js';
import { resolveFieldMap } from '../js/fields.js';
import { geometryBBox, makeProjector, circleBBox } from '../js/geometry.js';

const TIMEOUT = 25000;
const SAMPLES = {
  // known urban points (lon, lat) for a meaningful query; county centroid otherwise
  Pierce: [-122.4718, 47.2418], // MultiCare Allenmore Hospital, Tacoma
  King: [-122.2286, 47.3073], // Auburn Medical Center
  Spokane: [-117.4326, 47.6538], // Deaconess Hospital
  Thurston: [-122.9633, 47.0329], // Capital Medical Center
  Yakima: [-120.5322, 46.5949], // Yakima Memorial
  Snohomish: [-122.2015, 47.9790], // Everett
  Kitsap: [-122.6329, 47.5673], // Bremerton
  Clark: [-122.6615, 45.6387], // Vancouver
  Whatcom: [-122.4787, 48.7519], // Bellingham
  Skagit: [-122.3341, 48.4212], // Mount Vernon
  Cowlitz: [-122.9382, 46.1382], // Longview
  Clallam: [-123.4307, 48.1181], // Port Angeles
  Mason: [-123.1007, 47.2151], // Shelton
  'Grays Harbor': [-123.8157, 46.9754], // Aberdeen
  Lewis: [-122.9540, 46.6621], // Chehalis
  Chelan: [-120.3103, 47.4235], // Wenatchee
  Island: [-122.6435, 48.2932], // Oak Harbor
  'Walla Walla': [-118.3430, 46.0646],
  Franklin: [-119.1006, 46.2396], // Pasco
  Benton: [-119.1372, 46.2087], // Kennewick
  Kittitas: [-120.5478, 46.9965], // Ellensburg
};

const counties = JSON.parse(readFileSync(new URL('../data/wa_counties.json', import.meta.url), 'utf8'));
function samplePoint(county) {
  if (SAMPLES[county]) return SAMPLES[county];
  const f = counties.features.find((c) => c.properties.name === county);
  if (!f) return SAMPLES.Pierce;
  const b = geometryBBox(f.geometry);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

async function getJson(url, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const started = Date.now();
  try {
    // Send an Origin header so the CORS response header reflects what a browser would see.
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', Origin: 'https://example.github.io', Referer: 'https://example.github.io/' } });
    const cors = res.headers.get('access-control-allow-origin');
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}, non-JSON body: ${text.slice(0, 80)}`); }
    if (json.error) throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message}`);
    return { json, cors, ms: Date.now() - started, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

async function probeSource(provider, source) {
  const out = { provider: provider.key, county: provider.counties[0], id: source.id, url: source.url, confidence: source.confidence, geometry: !!source.geometry, enrich: !!source.enrich };
  try {
    const meta = await getJson(`${source.url}?f=json`);
    const info = meta.json;
    out.ok = true;
    out.layerName = info.name;
    out.geometryType = info.geometryType;
    out.maxRecordCount = info.maxRecordCount;
    out.formats = info.supportedQueryFormats;
    out.cors = meta.cors;
    out.metaMs = meta.ms;
    out.fieldCount = (info.fields || []).length;
    const layerInfo = { fields: (info.fields || []).map((f) => ({ name: f.name, alias: f.alias || f.name, type: f.type })) };
    const { map, how } = resolveFieldMap(layerInfo, source.fields || {});
    out.fieldMap = Object.fromEntries(Object.entries(map).filter(([, v]) => v).map(([k, v]) => [k, `${v}${how[k] === 'heuristic' ? ' (heuristic)' : ''}`]));
    out.missing = ['owner', 'taxable_value', 'total_value', 'land_acres', 'use_code', 'use_description', 'parcel_id'].filter((a) => !map[a] && !(source.computed && source.computed[a]));
    out.allFields = (info.fields || []).map((f) => f.name);
    if (info.geometryType || source.enrich) {
      const pt = samplePoint(provider.counties[0] === '*' ? 'Pierce' : provider.counties[0]);
      const bbox = circleBBox(pt, 400);
      // A tiny envelope keeps the sample small without pagination parameters, which some
      // MapServer layers reject ("Pagination is not supported").
      const small = circleBBox(pt, 40);
      const q = new URLSearchParams({
        where: '1=1', geometry: small.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
        outFields: '*', returnGeometry: 'false', f: 'json',
      });
      const qr = await getJson(`${source.url}/query?${q}`);
      out.queryMs = qr.ms;
      out.sampleCount = (qr.json.features || []).length;
      // prefer a feature with a parcel number (some layers carry empty placeholder rows)
      const feats = qr.json.features || [];
      const first = (feats.find((f) => map.parcel_id && f.attributes?.[map.parcel_id]) || feats[0])?.attributes;
      if (first) {
        out.sample = Object.fromEntries(Object.entries(map).filter(([, v]) => v).map(([k, v]) => [k, first[v] ?? first[Object.keys(first).find((f) => f.toLowerCase() === v.toLowerCase())]]));
        for (const [attr, spec] of Object.entries(source.computed || {})) {
          const names = spec.sum || spec.diff;
          out.sample[`${attr} (computed from ${names.join(spec.sum ? ' + ' : ' - ')})`] = names.map((n) => first[n]);
        }
      }
      const cq = new URLSearchParams({ where: '1=1', geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnCountOnly: 'true', f: 'json' });
      const cr = await getJson(`${source.url}/query?${cq}`);
      out.countIn800mBox = cr.json.count;
    }
  } catch (err) {
    out.ok = false;
    out.error = err.name === 'AbortError' ? `timeout after ${TIMEOUT} ms` : err.message;
  }
  return out;
}

async function probeGeocoders() {
  const tests = [
    ['Nominatim', 'https://nominatim.openstreetmap.org/search?q=1901+S+Union+Ave+Tacoma+WA&format=jsonv2&limit=1'],
    ['Census', 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1901+S+Union+Ave+Tacoma+WA&benchmark=Public_AR_Current&format=json'],
    ['Photon', 'https://photon.komoot.io/api/?q=1901+S+Union+Ave+Tacoma&limit=1'],
  ];
  const out = [];
  for (const [name, url] of tests) {
    try {
      const r = await getJson(url, 15000);
      const body = r.json;
      const hit = Array.isArray(body) ? body[0] : body?.result?.addressMatches?.[0] || body?.features?.[0];
      out.push({ name, ok: true, cors: r.cors, ms: r.ms, sample: hit ? JSON.stringify(hit).slice(0, 160) : 'no match' });
    } catch (err) {
      out.push({ name, ok: false, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  return out;
}

const results = [];
for (const provider of [...PROVIDERS, STATEWIDE]) {
  for (const source of provider.sources) {
    results.push(await probeSource(provider, source));
  }
}
if (STATEWIDE.sources[0].lookup) {
  const lk = STATEWIDE.sources[0].lookup;
  try {
    const r = await getJson(`${lk.url}/query?where=${encodeURIComponent("COUNTY_NM='53'")}&outFields=${lk.keyField},${lk.valueField}&returnGeometry=false&resultRecordCount=3&f=json`);
    results.push({ provider: 'wa', id: 'land-use-lookup', url: lk.url, ok: true, sampleCount: r.json.features?.length, sample: r.json.features?.map((f) => f.attributes) });
  } catch (err) {
    results.push({ provider: 'wa', id: 'land-use-lookup', url: lk.url, ok: false, error: err.message });
  }
}
const geocoders = await probeGeocoders();
const report = { generatedAt: new Date().toISOString(), sources: results, geocoders };
writeFileSync('probe-report.json', JSON.stringify(report, null, 2));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of results) {
    console.log(`\n### ${r.provider} / ${r.id} [${r.confidence || ''}] ${r.ok ? 'ONLINE' : 'FAILED'}`);
    console.log(`    ${r.url}`);
    if (!r.ok) { console.log(`    error: ${r.error}`); continue; }
    console.log(`    layer: ${r.layerName} | ${r.geometryType || 'table'} | max ${r.maxRecordCount} | formats ${r.formats} | CORS ${r.cors} | meta ${r.metaMs} ms`);
    if (r.fieldMap) console.log(`    mapping: ${JSON.stringify(r.fieldMap)}`);
    if (r.missing?.length) console.log(`    MISSING: ${r.missing.join(', ')}`);
    if (r.countIn800mBox !== undefined) console.log(`    parcels in 800 m box at sample point: ${r.countIn800mBox} (query ${r.queryMs} ms)`);
    if (r.sample) console.log(`    sample: ${JSON.stringify(r.sample)}`);
    if (r.allFields) console.log(`    fields: ${r.allFields.join(', ')}`);
  }
  console.log('\n### Geocoders');
  for (const g of geocoders) console.log(`    ${g.name}: ${g.ok ? `ONLINE CORS=${g.cors} ${g.ms} ms ${g.sample}` : `FAILED ${g.error}`}`);
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} sources online; ${bad.length} failed: ${bad.map((b) => b.id).join(', ') || 'none'}`);
}
