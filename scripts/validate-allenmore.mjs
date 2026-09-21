#!/usr/bin/env node
// Runs the reference study (MultiCare Allenmore Hospital, 1901 S Union Ave, Tacoma; 250 yards)
// headless against the live county, city and State services exactly as the browser does, then
// prints the parcel table, data coverage (owner, legal owner, zoning, last sale), the MultiCare
// matches, and a comparison with the owner names on the CBRE reference exhibit.
//
// Intended for the deployment workflow (GitHub's runners can reach the GIS hosts). Exits with
// code 1 only when no parcel service answers at all.
//
// Usage: node scripts/validate-allenmore.mjs [--lat 47.2418 --lon -122.4718] [--radius 250 --unit yd]
//          [--address "1901 S Union Ave, Tacoma, WA"]   geocode with the Census geocoder instead
//          [--static-base site]                          directory holding data/assessor/... (default: the published site)
//          [--json report.json]                          also write the full report as JSON

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ParcelService } from '../js/parcels.js';
import { classifyParcel, normalizeName } from '../js/multicare.js';
import { SITE_BASE } from '../js/config.js';
import {
  makeProjector, projectPolygons, distanceFromOriginToPolygons, circleBBox, expandBBox, toMeters, labelPoint,
} from '../js/geometry.js';

function parseArgs(argv) {
  const a = { lat: null, lon: null, radius: 250, unit: 'yd', address: '', staticBase: '', json: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--lat') { a.lat = Number(v); i++; } else if (k === '--lon') { a.lon = Number(v); i++; } else if (k === '--radius') { a.radius = Number(v); i++; } else if (k === '--unit') { a.unit = v; i++; } else if (k === '--address') { a.address = v; i++; } else if (k === '--static-base') { a.staticBase = v; i++; } else if (k === '--json') { a.json = v; i++; }
  }
  return a;
}

async function censusGeocode(address) {
  const u = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  u.searchParams.set('address', address);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  const j = await res.json();
  const m = j?.result?.addressMatches?.[0];
  if (!m) throw new Error(`Census geocoder found no match for "${address}"`);
  return { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress };
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const money = (n) => (n === null || n === undefined ? '' : `$${Math.round(n).toLocaleString('en-US')}`);
const tokens = (s) => new Set(normalizeName(s).split(' ').filter((t) => t.length > 1 && !['THE', 'AND', 'INC', 'LLC', 'OF', 'TTEE', 'ET', 'AL', 'ETAL'].includes(t)));

/** Loose owner-name match: containment either way or a strong token overlap. */
export function ownersMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common += 1;
  return common / Math.min(ta.size, tb.size) >= 0.6 && common >= 2;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reference = JSON.parse(await readFile(path.join(root, 'data/reference_allenmore.json'), 'utf8'));
  const counties = JSON.parse(await readFile(path.join(root, 'data/wa_counties.json'), 'utf8'));

  let center = { lat: reference.center.lat, lon: reference.center.lon, label: `${reference.center.address} (stored approximate centre)` };
  if (Number.isFinite(args.lat) && Number.isFinite(args.lon)) center = { lat: args.lat, lon: args.lon, label: `${args.lat}, ${args.lon}` };
  else {
    // Geocode the reference address exactly as the app would; fall back to the stored centre.
    const address = args.address || reference.center.address;
    try {
      center = await censusGeocode(address);
      console.log(`Geocoded "${address}" -> ${center.lat}, ${center.lon} (${center.label})`);
    } catch (err) {
      console.warn(`Geocoding failed (${err.message}); using the stored centre ${center.lat}, ${center.lon}`);
    }
  }

  const staticLoader = async (p) => {
    if (args.staticBase) {
      const file = path.resolve(args.staticBase, p);
      try {
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') {
          const e = new Error(`Not found: ${file}`);
          e.code = 404;
          throw e;
        }
        throw err;
      }
    }
    const res = await fetch(new URL(p, SITE_BASE));
    if (!res.ok) { const e = new Error(`HTTP ${res.status} for ${p}`); e.code = res.status; throw e; }
    return res.json();
  };
  const service = new ParcelService({ counties, staticLoader });

  const radiusM = toMeters(args.radius, args.unit);
  const c = [center.lon, center.lat];
  const bbox = expandBBox(circleBBox(c, radiusM), 2);
  console.log(`\nStudy: ${center.label}; ${args.radius} ${args.unit} (${radiusM.toFixed(1)} m); county ${service.countyForPoint(c) || 'unknown'}`);
  const t0 = Date.now();
  const statuses = [];
  const result = await service.fetchParcels(bbox, {
    onStatus: (s) => {
      statuses.push(s);
      const what = s.ok ? `ok${s.count !== undefined ? ` (${s.count}${s.joined !== undefined ? `, ${s.joined} matched` : ''}${s.zoned ? `, zoning for ${s.zoned}` : ''})` : ''}` : `UNAVAILABLE: ${s.error}`;
      console.log(`  [${s.role || 'primary'}] ${s.providerName}: ${s.source} -> ${what}`);
    },
  });
  console.log(`Fetched ${result.records.length} parcel records in the envelope in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const projector = makeProjector(c);
  const hits = [];
  for (const rec of result.records) {
    const polys = projectPolygons(projector, rec.geometry);
    const d = distanceFromOriginToPolygons(polys);
    if (d <= radiusM) {
      rec.distanceM = d;
      rec.labelLngLat = projector.toLngLat(labelPoint(polys));
      const { multicare, business } = classifyParcel(rec);
      rec.multicare = multicare;
      rec.occupiedBiz = business;
      hits.push(rec);
    }
  }
  hits.sort((a, b) => a.distanceM - b.distanceM || String(a.owner).localeCompare(String(b.owner)) || String(a.parcelId).localeCompare(String(b.parcelId)));
  hits.forEach((r, i) => { r.id = i + 1; });

  console.log(`\n${hits.length} parcels intersect the ring (reference exhibit: ${reference.owners.length} listed)\n`);
  console.log(`${pad('ID', 3)} ${pad('Parcel', 11)} ${pad('Owner', 34)} ${pad('Legal owner (deed)', 30)} ${pad('Taxable', 12)} ${pad('AC', 7)} ${pad('Use', 24)} ${pad('Zoning', 8)} ${pad('Last sale', 11)} ${pad('Price', 12)} MC`);
  for (const r of hits) {
    console.log(`${pad(r.id, 3)} ${pad(r.parcelId, 11)} ${pad((r.owner || '(not published)') + (r.ownerSource === 'legal' ? ' §' : ''), 34)} ${pad(r.legalOwner, 30)} ${pad(money(r.value) + (r.valueKind !== 'taxable' && r.value !== null ? '*' : ''), 12)} ${pad(r.acres !== null ? r.acres.toFixed(2) : '', 7)} ${pad(r.useText, 24)} ${pad(r.zoning, 8)} ${pad(r.saleDate || '', 11)} ${pad(money(r.salePrice), 12)} ${r.multicare ? `${r.multicare.relationship} (${r.multicare.matchedOn})` : ''}${r.occupiedBiz ? ' occupied:' + r.businessName : ''}`);
  }

  const cov = (f) => hits.filter(f).length;
  const coverage = {
    parcels: hits.length,
    owner: cov((r) => r.owner),
    taxpayer: cov((r) => r.taxpayer),
    legalOwner: cov((r) => r.legalOwner),
    taxableValue: cov((r) => r.valueKind === 'taxable'),
    anyValue: cov((r) => r.value !== null),
    acresAssessor: cov((r) => r.acresSource === 'assessor'),
    use: cov((r) => r.useText),
    zoning: cov((r) => r.zoning),
    saleDate: cov((r) => r.saleDate),
    salePrice: cov((r) => r.salePrice !== null),
  };
  console.log('\nCoverage:', Object.entries(coverage).map(([k, v]) => `${k} ${v}/${hits.length}`).join(' · '));
  const zoningSources = [...new Set(hits.map((r) => r.zoningSource).filter(Boolean))];
  console.log(`Zoning sources used: ${zoningSources.join('; ') || 'none'}`);

  const mc = hits.filter((r) => r.multicare || r.occupiedBiz);
  console.log(`\nMultiCare matches (${mc.length}):`);
  for (const r of mc) console.log(`  #${r.id} ${r.parcelId} owner="${r.owner}" legal="${r.legalOwner}" business="${r.businessName}" -> ${r.multicare ? `${r.multicare.entity} [${r.multicare.relationship}, ${r.multicare.matchedOn}]` : ''}${r.occupiedBiz ? ` occupied by ${r.businessName}` : ''}`);

  // Reference comparison (owner names only; the exhibit predates the current roll)
  const names = hits.flatMap((r) => [r.owner, r.legalOwner, r.businessName].filter(Boolean));
  const unmatched = [];
  let matched = 0;
  reference.owners.forEach((o, i) => {
    if (o.startsWith('Ground lease')) return; // exhibit annotation, not an assessor name
    if (names.some((n) => ownersMatch(n, o))) matched += 1;
    else unmatched.push(`#${i + 1} ${o}`);
  });
  console.log(`\nReference exhibit owners found among live owner / legal-owner / business names: ${matched} of ${reference.owners.length - 1}`);
  if (unmatched.length) console.log(`  not found (renamed, resold, or name withheld): ${unmatched.join('; ')}`);
  const mcRef = reference.multicare.owned.map((i) => reference.owners[i - 1]);
  const mcFound = mc.filter((r) => r.multicare && ['owned', 'historical_name', 'foundation'].includes(r.multicare.relationship)).length;
  console.log(`MultiCare-owned parcels: reference ${mcRef.length}, live ${mcFound}`);

  const failed = statuses.filter((s) => !s.ok);
  if (failed.length) console.log(`\nSources unavailable from this runner: ${failed.map((s) => `${s.source} (${s.error})`).join('; ')}`);

  if (args.json) {
    await writeFile(args.json, JSON.stringify({ generated: new Date().toISOString(), center, radius: { value: args.radius, unit: args.unit }, coverage, statuses: statuses.map(({ fieldMap, how, ...s }) => s), matchedReference: matched, unmatchedReference: unmatched, parcels: hits.map(({ geometry, raw, bbox: b, ...r }) => r) }, null, 1));
    console.log(`Report written to ${args.json}`);
  }
  if (!hits.length) {
    console.error('No parcels returned: every parcel service failed or the envelope is empty.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const timer = setTimeout(() => { console.error('Timed out after 10 minutes'); process.exit(1); }, 10 * 60 * 1000);
  main().then(() => clearTimeout(timer)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
