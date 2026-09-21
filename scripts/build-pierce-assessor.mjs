#!/usr/bin/env node
// Builds the Pierce County assessor extract used by the map for legal owner (latest deed
// grantee), last sale date / price, business name, exemption and current values.
//
// Source: Pierce County Assessor-Treasurer "Data Downloads" (updated weekly), pipe-delimited
// text files without header rows, ISO-8859-1 encoded, zipped one file per table:
//   https://online.co.pierce.wa.us/datamart/tax_account.zip        (28 columns)
//   https://online.co.pierce.wa.us/datamart/appraisal_account.zip  (24 columns)
//   https://online.co.pierce.wa.us/datamart/sale.zip               (13 columns)
// Column layouts follow the county metadata PDFs
// (https://online.co.pierce.wa.us/cfapps/atr/datamart/metadata/<table>.pdf). Note that no
// public bulk table carries the taxpayer name (withheld under RCW 42.56.070(8)); the legal
// owner is therefore the grantee on the most recent recorded deed in the sale table.
//
// Output (default ./data/assessor/pierce):
//   manifest.json               generated time, file dates, counts, field labels
//   shards/<prefix>.json        { "<parcel number>": { normalized attributes } } by parcel prefix
//   multicare.json              parcels whose names match MultiCare patterns (for validation)
//
// Usage: node scripts/build-pierce-assessor.mjs [--out DIR] [--cache DIR] [--prefix-length N]
//        [--from DIR]   use already-downloaded <table>.zip or <table>.txt files instead of fetching

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { classifyOwner } from '../js/multicare.js';

export const BASE_URL = 'https://online.co.pierce.wa.us/datamart/';
export const METADATA_URL = 'https://online.co.pierce.wa.us/cfapps/atr/datamart/metadata/';

export const LAYOUTS = {
  tax_account: [
    'parcel_number', 'account_type', 'property_type', 'site_address', 'use_code', 'use_description',
    'tax_year_prior', 'tax_code_area_prior', 'exemption_type_prior', 'current_use_code_prior',
    'land_value_prior', 'improvement_value_prior', 'total_market_value_prior', 'taxable_value_prior',
    'tax_year', 'tax_code_area', 'exemption_type', 'current_use_code',
    'land_value', 'improvement_value', 'total_market_value', 'taxable_value',
    'range', 'township', 'section', 'quarter_section', 'subdivision_name', 'located_on_parcel',
  ],
  appraisal_account: [
    'parcel_number', 'appraisal_account_type', 'business_name', 'value_area_id', 'land_economic_area', 'buildings',
    'group_account_number', 'land_gross_acres', 'land_net_acres', 'land_gross_square_feet', 'land_net_square_feet',
    'land_gross_front_feet', 'land_width', 'land_depth', 'submerged_area_square_feet', 'appraisal_date',
    'waterfront_type', 'view_quality', 'utility_electric', 'utility_sewer', 'utility_water', 'street_type', 'latitude', 'longitude',
  ],
  sale: [
    'etn', 'parcel_count', 'parcel_number', 'sale_date', 'sale_price', 'deed_type', 'grantor', 'grantee',
    'valid_invalid', 'confirmed_unconfirmed', 'exclude_reason', 'improved_vacant', 'appraisal_account_type',
  ],
};

// ---------------------------------------------------------------------------
// Minimal ZIP reader (stored / deflate entries, no ZIP64): enough for the county's zips.
// ---------------------------------------------------------------------------
export function readZipEntries(buf) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({
      name, method, compressedSize, uncompressedSize,
      data() {
        if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`Corrupt ZIP local header for ${name}`);
        const lNameLen = buf.readUInt16LE(localOff + 26);
        const lExtraLen = buf.readUInt16LE(localOff + 28);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const raw = buf.subarray(start, start + compressedSize);
        if (method === 0) return raw;
        if (method === 8) return zlib.inflateRawSync(raw);
        throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
      },
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Splits a pipe-delimited, header-less, unquoted text file into field arrays. */
export function parsePipe(text, layout, { onBadRow } = {}) {
  const rows = [];
  let bad = 0;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split('|');
    if (parts.length !== layout.length) {
      // Tolerate a trailing delimiter, otherwise count the row as malformed.
      if (parts.length === layout.length + 1 && parts[parts.length - 1] === '') parts.pop();
      else {
        bad += 1;
        if (onBadRow) onBadRow(i + 1, line, parts.length);
        continue;
      }
    }
    const rec = {};
    for (let j = 0; j < layout.length; j++) rec[layout[j]] = parts[j].trim();
    rows.push(rec);
  }
  return { rows, bad, total: rows.length + bad };
}

export function toISO(mdy) {
  const m = String(mdy || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/**
 * Joins the three tables into one record per parcel number.
 * @returns {{ records: Map<string, object>, stats: object }}
 */
export function buildRecords({ taxAccounts, appraisalAccounts, sales }) {
  const records = new Map();
  const get = (pn) => {
    let r = records.get(pn);
    if (!r) {
      r = {};
      records.set(pn, r);
    }
    return r;
  };
  for (const t of taxAccounts) {
    const pn = t.parcel_number;
    if (!pn) continue;
    const r = get(pn);
    Object.assign(r, {
      account_type: t.account_type || undefined,
      situs_address: t.site_address || undefined,
      use_code: t.use_code || undefined,
      use_description: t.use_description || undefined,
      exemption: t.exemption_type || undefined,
      tax_year: int(t.tax_year) ?? undefined,
      land_value: int(t.land_value) ?? undefined,
      improvement_value: int(t.improvement_value) ?? undefined,
      total_value: int(t.total_market_value) ?? undefined,
      taxable_value: int(t.taxable_value) ?? undefined,
    });
  }
  for (const a of appraisalAccounts) {
    const pn = a.parcel_number;
    if (!pn) continue;
    const r = get(pn);
    const netAcres = num(a.land_net_acres);
    const grossAcres = num(a.land_gross_acres);
    Object.assign(r, {
      appraisal_type: a.appraisal_account_type || undefined,
      business_name: a.business_name || undefined,
      land_acres: netAcres && netAcres > 0 ? netAcres : undefined,
      land_gross_acres: grossAcres && grossAcres > 0 && grossAcres !== netAcres ? grossAcres : undefined,
      land_sqft: num(a.land_net_square_feet) > 0 ? num(a.land_net_square_feet) : undefined,
      appraisal_date: toISO(a.appraisal_date) ?? undefined,
    });
  }
  // Most recent recorded deed per parcel (ties: highest ETN), plus the latest sale the
  // assessor treats as a valid (arm's-length) market sale with a price.
  const latest = new Map();
  const latestValid = new Map();
  let saleRows = 0;
  for (const s of sales) {
    const pn = s.parcel_number;
    const iso = toISO(s.sale_date);
    if (!pn || !iso) continue;
    saleRows += 1;
    const key = `${iso}|${String(s.etn).padStart(12, '0')}`;
    const cur = latest.get(pn);
    if (!cur || key > cur.key) latest.set(pn, { key, s, iso });
    if (s.valid_invalid === '1' && num(s.sale_price) > 0) {
      const cv = latestValid.get(pn);
      if (!cv || key > cv.key) latestValid.set(pn, { key, s, iso });
    }
  }
  for (const [pn, { s, iso }] of latest) {
    const r = get(pn);
    r.sale_date = iso;
    r.sale_price = num(s.sale_price) ?? undefined;
    r.sale_grantor = s.grantor || undefined;
    r.legal_owner = s.grantee || undefined;
    r.sale_deed_type = s.deed_type || undefined;
    r.sale_valid = s.valid_invalid === '1' ? 1 : 0;
    r.sale_exclude_reason = s.exclude_reason || undefined;
    r.sale_etn = s.etn || undefined;
    if (int(s.parcel_count) > 1) r.sale_parcel_count = int(s.parcel_count);
    const v = latestValid.get(pn);
    if (v && v.iso !== iso) {
      r.valid_sale_date = v.iso;
      r.valid_sale_price = num(v.s.sale_price) ?? undefined;
    }
  }
  for (const r of records.values()) for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return { records, stats: { taxAccounts: taxAccounts.length, appraisalAccounts: appraisalAccounts.length, saleRows, parcelsWithSales: latest.size } };
}

/** Parcels whose grantee, grantor or business name matches a MultiCare pattern. */
export function findMultiCare(records) {
  const out = [];
  for (const [pn, r] of records) {
    const fields = [['legal_owner', r.legal_owner], ['business_name', r.business_name], ['sale_grantor', r.sale_grantor]];
    const matches = [];
    for (const [field, value] of fields) {
      const m = value ? classifyOwner(value, { county: 'Pierce' }) : null;
      if (m) matches.push({ field, value, entity: m.entity, relationship: m.relationship });
    }
    if (matches.length) {
      out.push({
        parcel: pn, situs_address: r.situs_address, use_description: r.use_description, exemption: r.exemption, taxable_value: r.taxable_value,
        legal_owner: r.legal_owner, business_name: r.business_name, sale_date: r.sale_date, sale_price: r.sale_price, sale_grantor: r.sale_grantor, sale_deed_type: r.sale_deed_type,
        matches,
      });
    }
  }
  out.sort((a, b) => a.parcel.localeCompare(b.parcel));
  return out;
}

export const FIELD_LABELS = {
  legal_owner: 'sale.txt Grantee on the most recent recorded deed',
  sale_date: 'sale.txt Sale Date (most recent deed)',
  sale_price: 'sale.txt Sale Price (most recent deed)',
  sale_grantor: 'sale.txt Grantor (most recent deed)',
  sale_deed_type: 'sale.txt Deed Type',
  sale_valid: 'sale.txt Valid/Invalid (1 = valid market sale per assessor)',
  sale_exclude_reason: 'sale.txt Exclude Reason',
  sale_etn: 'sale.txt ETN (Auditor recording number)',
  valid_sale_date: 'sale.txt Sale Date of the latest valid market sale',
  valid_sale_price: 'sale.txt Sale Price of the latest valid market sale',
  business_name: 'appraisal_account.txt Business Name (occupant, not owner)',
  land_acres: 'appraisal_account.txt Land Net Acres',
  land_gross_acres: 'appraisal_account.txt Land Gross Acres',
  land_sqft: 'appraisal_account.txt Land Net Square Feet',
  appraisal_type: 'appraisal_account.txt Appraisal Account Type',
  situs_address: 'tax_account.txt Site Address (XXX prefix = GIS-estimated)',
  use_code: 'tax_account.txt Use Code',
  use_description: 'tax_account.txt Use Description',
  exemption: 'tax_account.txt Exemption Type (current year)',
  land_value: 'tax_account.txt Land Value (current year)',
  improvement_value: 'tax_account.txt Improvement Value (current year)',
  total_value: 'tax_account.txt Total Market Value (current year)',
  taxable_value: 'tax_account.txt Taxable Value (current year)',
  tax_year: 'tax_account.txt Tax Year (current)',
  account_type: 'tax_account.txt Account Type',
};

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'multicare-parcel-mapping (GitHub Actions; assessor extract build)' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, lastModified: res.headers.get('last-modified') || '' };
    } catch (err) {
      lastErr = err;
      console.warn(`  attempt ${i + 1} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function loadTable(name, { from, cache }) {
  const layout = LAYOUTS[name];
  let text;
  let dated = '';
  let source = '';
  if (from) {
    const txt = path.join(from, `${name}.txt`);
    const zip = path.join(from, `${name}.zip`);
    if (existsSync(txt)) {
      text = (await readFile(txt)).toString('latin1');
      source = txt;
      dated = (await stat(txt)).mtime.toISOString();
    } else if (existsSync(zip)) {
      const entries = readZipEntries(await readFile(zip));
      const e = entries.find((x) => /\.txt$/i.test(x.name)) || entries[0];
      text = e.data().toString('latin1');
      source = zip;
      dated = (await stat(zip)).mtime.toISOString();
    } else throw new Error(`Neither ${txt} nor ${zip} exists`);
  } else {
    const url = `${BASE_URL}${name}.zip`;
    console.log(`Downloading ${url}`);
    const { buf, lastModified } = await fetchWithRetry(url);
    console.log(`  ${(buf.length / 1048576).toFixed(1)} MB${lastModified ? `, last modified ${lastModified}` : ''}`);
    if (cache) {
      await mkdir(cache, { recursive: true });
      await writeFile(path.join(cache, `${name}.zip`), buf);
    }
    const entries = readZipEntries(buf);
    const e = entries.find((x) => /\.txt$/i.test(x.name)) || entries[0];
    if (!e) throw new Error(`${name}.zip contains no entries`);
    text = e.data().toString('latin1');
    source = url;
    dated = lastModified ? new Date(lastModified).toISOString() : '';
  }
  const preview = text.split(/\r?\n/, 3).map((l) => l.slice(0, 160));
  console.log(`  ${name}: first lines:\n    ${preview.join('\n    ')}`);
  const badSamples = [];
  const { rows, bad, total } = parsePipe(text, layout, { onBadRow: (n, line, count) => { if (badSamples.length < 3) badSamples.push(`line ${n}: ${count} fields: ${line.slice(0, 120)}`); } });
  console.log(`  ${name}: ${rows.length.toLocaleString()} rows parsed, ${bad.toLocaleString()} malformed`);
  if (bad) console.log(`    e.g. ${badSamples.join(' | ')}`);
  if (total && bad / total > 0.01) throw new Error(`${name}: ${bad} of ${total} rows do not have ${layout.length} fields; the county layout may have changed (see ${METADATA_URL}${name}.pdf)`);
  return { rows, source, dated, bad };
}

export async function writeOutput({ records, stats, outDir, prefixLength, files, multicare }) {
  const shardsDir = path.join(outDir, 'shards');
  await mkdir(shardsDir, { recursive: true });
  const shards = new Map();
  for (const [pn, rec] of records) {
    const key = String(pn).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (key.length < prefixLength) continue;
    const prefix = key.slice(0, prefixLength);
    if (!shards.has(prefix)) shards.set(prefix, {});
    shards.get(prefix)[key] = rec;
  }
  let bytes = 0;
  for (const [prefix, obj] of shards) {
    const json = JSON.stringify(obj);
    bytes += json.length;
    await writeFile(path.join(shardsDir, `${prefix}.json`), json);
  }
  const manifest = {
    generated: new Date().toISOString(),
    source: 'Pierce County Assessor-Treasurer Data Downloads (weekly extract)',
    sourceUrl: 'https://www.piercecountywa.gov/736/Data-Downloads',
    files,
    asOf: Object.values(files).map((f) => f.dated).filter(Boolean).sort().pop() || '',
    prefixLength,
    shards: [...shards.keys()].sort(),
    records: records.size,
    stats,
    multicareCandidates: multicare.length,
    fields: FIELD_LABELS,
    notes: 'Taxpayer names are not included in any public Pierce County bulk table (RCW 42.56.070(8)); legal_owner is the grantee on the most recent recorded deed. Values are whole dollars for the current tax year.',
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  await writeFile(path.join(outDir, 'multicare.json'), JSON.stringify({ generated: manifest.generated, count: multicare.length, parcels: multicare }, null, 1));
  return { manifest, bytes, shardCount: shards.size };
}

function parseArgs(argv) {
  const args = { out: 'data/assessor/pierce', cache: '', from: '', prefixLength: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--cache') args.cache = argv[++i];
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--prefix-length') args.prefixLength = Number(argv[++i]);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const t0 = Date.now();
  const files = {};
  const tables = {};
  for (const name of ['tax_account', 'appraisal_account', 'sale']) {
    const { rows, source, dated, bad } = await loadTable(name, { from: args.from, cache: args.cache });
    tables[name] = rows;
    files[name] = { source, dated, rows: rows.length, malformed: bad, columns: LAYOUTS[name].length };
  }
  const { records, stats } = buildRecords({ taxAccounts: tables.tax_account, appraisalAccounts: tables.appraisal_account, sales: tables.sale });
  const multicare = findMultiCare(records);
  const { manifest, bytes, shardCount } = await writeOutput({ records, stats, outDir: args.out, prefixLength: args.prefixLength, files, multicare });
  console.log(`\nWrote ${records.size.toLocaleString()} parcel records in ${shardCount} shards (${(bytes / 1048576).toFixed(1)} MB) to ${args.out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Sales: ${stats.saleRows.toLocaleString()} rows, ${stats.parcelsWithSales.toLocaleString()} parcels with a recorded deed`);
  console.log(`MultiCare-matching parcels (grantee / business name / grantor): ${multicare.length}`);
  for (const m of multicare.slice(0, 200)) {
    console.log(`  ${m.parcel}  ${m.matches.map((x) => `${x.field}=${x.value}`).join('; ')}  ${m.situs_address || ''}  ${m.use_description || ''}  ${m.exemption ? `[${m.exemption}]` : ''}`);
  }
  if (multicare.length > 200) console.log(`  … ${multicare.length - 200} more (see multicare.json)`);
  console.log(`Extract dated ${manifest.asOf || 'unknown'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
