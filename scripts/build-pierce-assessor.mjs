#!/usr/bin/env node
// Builds the Pierce County assessor extract used by the map for legal owner (latest deed
// grantee), last sale date / price, business name, exemption and current values.
//
// Source: Pierce County Assessor-Treasurer "Data Downloads" (updated weekly), pipe-delimited
// text files without header rows, Windows-1252 encoded, zipped one file per table:
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
//
// Rows are folded into the per-parcel record map as they are parsed, so only one table's
// text is in memory at a time (the sale file alone is ~90 MB, 650k rows).

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

function textEntry(entries, name) {
  const e = entries.find((x) => /\.txt$/i.test(x.name)) || entries[0];
  if (!e) throw new Error(`${name}.zip contains no entries`);
  return e;
}

/** Decodes a county text file (Windows-1252; a UTF-8 BOM is stripped if ever present). */
export function decodeCountyText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  return new TextDecoder('windows-1252').decode(buf);
}

/**
 * Splits a pipe-delimited, header-less, unquoted text file into field objects, calling
 * `onRow` for each (or collecting them when no callback is given).
 */
export function parsePipe(text, layout, { onBadRow, onRow } = {}) {
  const rows = onRow ? null : [];
  let bad = 0;
  let total = 0;
  let start = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = n;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;
    total += 1;
    const parts = line.split('|');
    if (parts.length !== layout.length) {
      // Tolerate a trailing delimiter, otherwise count the row as malformed.
      if (parts.length === layout.length + 1 && parts[parts.length - 1] === '') parts.pop();
      else {
        bad += 1;
        if (onBadRow) onBadRow(total, line, parts.length);
        continue;
      }
    }
    const rec = {};
    for (let j = 0; j < layout.length; j++) rec[layout[j]] = parts[j].trim();
    if (onRow) onRow(rec);
    else rows.push(rec);
  }
  return { rows, bad, total };
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
 * Folds the three tables into one record per parcel number. Feed tax_account and
 * appraisal_account rows first; sale rows only attach to parcels those tables know
 * (retired parcel numbers in the decades-long sales history are skipped).
 */
export class RecordBuilder {
  constructor() {
    this.records = new Map();
    this.latest = new Map();
    this.latestValid = new Map();
    this.stats = { taxAccounts: 0, appraisalAccounts: 0, saleRows: 0, saleRowsSkipped: 0, parcelsWithSales: 0 };
  }

  get(pn) {
    let r = this.records.get(pn);
    if (!r) {
      r = {};
      this.records.set(pn, r);
    }
    return r;
  }

  addTax(t) {
    const pn = t.parcel_number;
    if (!pn) return;
    this.stats.taxAccounts += 1;
    Object.assign(this.get(pn), {
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

  addAppraisal(a) {
    const pn = a.parcel_number;
    if (!pn) return;
    this.stats.appraisalAccounts += 1;
    const netAcres = num(a.land_net_acres);
    const grossAcres = num(a.land_gross_acres);
    Object.assign(this.get(pn), {
      appraisal_type: a.appraisal_account_type || undefined,
      business_name: a.business_name || undefined,
      land_acres: netAcres && netAcres > 0 ? netAcres : undefined,
      land_gross_acres: grossAcres && grossAcres > 0 && grossAcres !== netAcres ? grossAcres : undefined,
      land_sqft: num(a.land_net_square_feet) > 0 ? num(a.land_net_square_feet) : undefined,
      appraisal_date: toISO(a.appraisal_date) ?? undefined,
    });
  }

  addSale(s) {
    const pn = s.parcel_number;
    const iso = toISO(s.sale_date);
    if (!pn || !iso) return;
    if (!this.records.has(pn)) {
      this.stats.saleRowsSkipped += 1;
      return;
    }
    this.stats.saleRows += 1;
    // Most recent recorded deed per parcel (ties: highest ETN), plus the latest sale the
    // assessor treats as a valid (arm's-length) market sale with a price.
    const key = `${iso}|${String(s.etn).padStart(12, '0')}`;
    const cur = this.latest.get(pn);
    if (!cur || key > cur.key) {
      this.latest.set(pn, {
        key, iso, etn: s.etn, price: num(s.sale_price), grantor: s.grantor, grantee: s.grantee, deed: s.deed_type,
        valid: s.valid_invalid === '1', reason: s.exclude_reason, count: int(s.parcel_count),
      });
    }
    if (s.valid_invalid === '1' && num(s.sale_price) > 0) {
      const cv = this.latestValid.get(pn);
      if (!cv || key > cv.key) this.latestValid.set(pn, { key, iso, price: num(s.sale_price) });
    }
  }

  finish() {
    for (const [pn, d] of this.latest) {
      const r = this.get(pn);
      r.sale_date = d.iso;
      r.sale_price = d.price ?? undefined;
      r.sale_grantor = d.grantor || undefined;
      r.legal_owner = d.grantee || undefined;
      r.sale_deed_type = d.deed || undefined;
      r.sale_valid = d.valid ? 1 : 0;
      r.sale_exclude_reason = d.reason || undefined;
      r.sale_etn = d.etn || undefined;
      if (d.count > 1) r.sale_parcel_count = d.count;
      const v = this.latestValid.get(pn);
      if (v && v.iso !== d.iso) {
        r.valid_sale_date = v.iso;
        r.valid_sale_price = v.price ?? undefined;
      }
    }
    this.stats.parcelsWithSales = this.latest.size;
    for (const r of this.records.values()) for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    this.latest.clear();
    this.latestValid.clear();
    return { records: this.records, stats: this.stats };
  }
}

/** Convenience wrapper over RecordBuilder for already-parsed arrays (tests, small runs). */
export function buildRecords({ taxAccounts, appraisalAccounts, sales }) {
  const b = new RecordBuilder();
  for (const t of taxAccounts) b.addTax(t);
  for (const a of appraisalAccounts) b.addAppraisal(a);
  for (const s of sales) b.addSale(s);
  return b.finish();
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

const RETRYABLE = (status) => status === 429 || status >= 500;

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'multicare-parcel-mapping (GitHub Actions; assessor extract build)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        err.retryable = RETRYABLE(res.status);
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, lastModified: res.headers.get('last-modified') || '' };
    } catch (err) {
      lastErr = err;
      const retryable = err.retryable !== false && (err.retryable === true || !/^HTTP \d/.test(err.message));
      console.warn(`  attempt ${i + 1} failed: ${err.message}${retryable && i < attempts - 1 ? ', retrying' : ''}`);
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

function isoOrEmpty(dateText) {
  const ms = Date.parse(dateText || '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Loads one table and streams its rows into `onRow`; returns file metadata. */
async function loadTable(name, { from, cache, onRow }) {
  const layout = LAYOUTS[name];
  let text;
  let dated = '';
  let source = '';
  if (from) {
    const txt = path.join(from, `${name}.txt`);
    const zip = path.join(from, `${name}.zip`);
    if (existsSync(txt)) {
      text = decodeCountyText(await readFile(txt));
      source = txt;
      dated = (await stat(txt)).mtime.toISOString();
    } else if (existsSync(zip)) {
      text = decodeCountyText(textEntry(readZipEntries(await readFile(zip)), name).data());
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
    text = decodeCountyText(textEntry(readZipEntries(buf), name).data());
    source = url;
    dated = isoOrEmpty(lastModified);
    if (lastModified && !dated) console.warn(`  Last-Modified header not parseable: ${lastModified}`);
  }
  const preview = text.split(/\r?\n/, 3).map((l) => l.slice(0, 160));
  console.log(`  ${name}: first lines:\n    ${preview.join('\n    ')}`);
  const badSamples = [];
  const { bad, total } = parsePipe(text, layout, {
    onRow,
    onBadRow: (n, line, count) => { if (badSamples.length < 3) badSamples.push(`line ${n}: ${count} fields: ${line.slice(0, 120)}`); },
  });
  text = null; // release the decoded file before the next table
  console.log(`  ${name}: ${(total - bad).toLocaleString()} rows parsed, ${bad.toLocaleString()} malformed`);
  if (bad) console.log(`    e.g. ${badSamples.join(' | ')}`);
  checkLayout(name, bad, total);
  return { source, dated, rows: total - bad, malformed: bad, columns: layout.length };
}

/** Aborts the build when more than 1% of a table's rows do not match the documented layout. */
export function checkLayout(name, bad, total) {
  if (total && bad / total > 0.01) throw new Error(`${name}: ${bad} of ${total} rows do not have ${LAYOUTS[name].length} fields; the county layout may have changed (see ${METADATA_URL}${name}.pdf)`);
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
  const builder = new RecordBuilder();
  const handlers = { tax_account: (r) => builder.addTax(r), appraisal_account: (r) => builder.addAppraisal(r), sale: (r) => builder.addSale(r) };
  for (const name of ['tax_account', 'appraisal_account', 'sale']) {
    files[name] = await loadTable(name, { from: args.from, cache: args.cache, onRow: handlers[name] });
  }
  const { records, stats } = builder.finish();
  const multicare = findMultiCare(records);
  const { manifest, bytes, shardCount } = await writeOutput({ records, stats, outDir: args.out, prefixLength: args.prefixLength, files, multicare });
  console.log(`\nWrote ${records.size.toLocaleString()} parcel records in ${shardCount} shards (${(bytes / 1048576).toFixed(1)} MB) to ${args.out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Sales: ${stats.saleRows.toLocaleString()} rows for current parcels (${stats.saleRowsSkipped.toLocaleString()} rows for retired parcel numbers skipped), ${stats.parcelsWithSales.toLocaleString()} parcels with a recorded deed`);
  console.log(`MultiCare-matching parcels (grantee / business name / grantor): ${multicare.length}`);
  for (const m of multicare.slice(0, 200)) {
    console.log(`  ${m.parcel}  ${m.matches.map((x) => `${x.field}=${x.value}`).join('; ')}  ${m.situs_address || ''}  ${m.use_description || ''}  ${m.exemption ? `[${m.exemption}]` : ''}`);
  }
  if (multicare.length > 200) console.log(`  … ${multicare.length - 200} more (see multicare.json)`);
  console.log(`Extract dated ${manifest.asOf || 'unknown'}; peak heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
