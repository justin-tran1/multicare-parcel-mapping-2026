import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readZipEntries, parsePipe, buildRecords, findMultiCare, writeOutput, LAYOUTS, toISO } from '../../scripts/build-pierce-assessor.mjs';

/** Minimal ZIP writer (deflate) mirroring the county's single-file archives. */
function makeZip(name, content) {
  const data = Buffer.from(content, 'latin1');
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, eocd]);
}

const taxRow = (pn, extra = {}) => {
  const r = Object.fromEntries(LAYOUTS.tax_account.map((k) => [k, '']));
  Object.assign(r, { parcel_number: pn, account_type: 'REAL', property_type: 'ASIMP', site_address: '1901 S UNION AVE', use_code: '6500', use_description: 'Hospital', tax_year: '2026', exemption_type: 'Non Profit Hospital', land_value: '1500000', improvement_value: '25000000', total_market_value: '26500000', taxable_value: '0' }, extra);
  return LAYOUTS.tax_account.map((k) => r[k]).join('|');
};
const apprRow = (pn, extra = {}) => {
  const r = Object.fromEntries(LAYOUTS.appraisal_account.map((k) => [k, '']));
  Object.assign(r, { parcel_number: pn, appraisal_account_type: 'Commercial', business_name: 'MULTICARE ALLENMORE HOSPITAL', land_gross_acres: '12.5000', land_net_acres: '4.2500', land_net_square_feet: '185130.0000', appraisal_date: '05/01/2026', latitude: '47.24180', longitude: '-122.47180' }, extra);
  return LAYOUTS.appraisal_account.map((k) => r[k]).join('|');
};
const saleRow = (o) => LAYOUTS.sale.map((k) => o[k] ?? '').join('|');

test('zip reader inflates a county-style single file archive', () => {
  const zip = makeZip('sale.txt', 'a|b|c\r\nd|e|f\r\n');
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'sale.txt');
  assert.equal(entries[0].data().toString('latin1'), 'a|b|c\r\nd|e|f\r\n');
});

test('pipe parser assigns columns positionally and counts malformed rows', () => {
  const text = `${taxRow('0220163009')}\r\n${taxRow('0220163010')}|\r\nbad|row\r\n\r\n`;
  const { rows, bad } = parsePipe(text, LAYOUTS.tax_account);
  assert.equal(rows.length, 2);
  assert.equal(bad, 1);
  assert.equal(rows[0].parcel_number, '0220163009');
  assert.equal(rows[0].taxable_value, '0');
  assert.equal(rows[1].parcel_number, '0220163010'); // trailing delimiter tolerated
  assert.equal(toISO('06/15/2024'), '2024-06-15');
  assert.equal(toISO(''), null);
});

test('records join the three tables and keep the most recent deed plus the last market sale', async () => {
  const tax = parsePipe([taxRow('0220163009'), taxRow('2009400010', { use_code: '1101', use_description: 'Single Family Dwelling', exemption_type: '', taxable_value: '450000' })].join('\n'), LAYOUTS.tax_account).rows;
  const appr = parsePipe([apprRow('0220163009'), apprRow('2009400010', { business_name: '', appraisal_account_type: 'Residential', land_net_acres: '0.1500' })].join('\n'), LAYOUTS.appraisal_account).rows;
  const sales = parsePipe([
    saleRow({ etn: '201001010001', parcel_count: '1', parcel_number: '2009400010', sale_date: '03/02/2010', sale_price: '250000.00', deed_type: 'Statutory Warranty Deed', grantor: 'SMITH JOHN', grantee: 'DOE JANE', valid_invalid: '1', confirmed_unconfirmed: '1', exclude_reason: '', improved_vacant: '1', appraisal_account_type: 'Residential' }),
    saleRow({ etn: '202405010009', parcel_count: '1', parcel_number: '2009400010', sale_date: '05/01/2024', sale_price: '0.00', deed_type: 'Quit Claim Deed', grantor: 'DOE JANE', grantee: 'DOE FAMILY TRUST', valid_invalid: '2', confirmed_unconfirmed: '1', exclude_reason: 'Living Trust', improved_vacant: '1', appraisal_account_type: 'Residential' }),
    saleRow({ etn: '202006150003', parcel_count: '3', parcel_number: '0220163009', sale_date: '06/15/2020', sale_price: '12000000.00', deed_type: 'Special Warranty Deed', grantor: 'HEALTHCARE REALTY TRUST', grantee: 'MULTICARE HEALTH SYSTEM', valid_invalid: '1', confirmed_unconfirmed: '1', exclude_reason: '', improved_vacant: '1', appraisal_account_type: 'Commercial' }),
  ].join('\n'), LAYOUTS.sale).rows;
  const { records, stats } = buildRecords({ taxAccounts: tax, appraisalAccounts: appr, sales });
  assert.equal(records.size, 2);
  assert.equal(stats.parcelsWithSales, 2);
  const res = records.get('2009400010');
  assert.equal(res.sale_date, '2024-05-01');
  assert.equal(res.sale_price, 0);
  assert.equal(res.legal_owner, 'DOE FAMILY TRUST');
  assert.equal(res.sale_grantor, 'DOE JANE');
  assert.equal(res.sale_valid, 0);
  assert.equal(res.sale_exclude_reason, 'Living Trust');
  assert.equal(res.valid_sale_date, '2010-03-02');
  assert.equal(res.valid_sale_price, 250000);
  assert.equal(res.taxable_value, 450000);
  assert.equal(res.land_acres, 0.15);
  assert.equal(res.business_name, undefined);
  const hosp = records.get('0220163009');
  assert.equal(hosp.legal_owner, 'MULTICARE HEALTH SYSTEM');
  assert.equal(hosp.sale_parcel_count, 3);
  assert.equal(hosp.valid_sale_date, undefined); // latest deed is itself the valid sale
  assert.equal(hosp.exemption, 'Non Profit Hospital');
  assert.equal(hosp.land_acres, 4.25);
  assert.equal(hosp.land_gross_acres, 12.5);
  assert.equal(hosp.business_name, 'MULTICARE ALLENMORE HOSPITAL');

  const mc = findMultiCare(records);
  assert.equal(mc.length, 1);
  assert.equal(mc[0].parcel, '0220163009');
  assert.deepEqual(mc[0].matches.map((m) => m.field).sort(), ['business_name', 'legal_owner']);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'pierce-'));
  const { manifest, shardCount } = await writeOutput({ records, stats, outDir: dir, prefixLength: 4, files: { sale: { dated: '2026-09-18T00:00:00.000Z' } }, multicare: mc });
  assert.equal(shardCount, 2);
  assert.deepEqual(manifest.shards, ['0220', '2009']);
  assert.equal(manifest.asOf, '2026-09-18T00:00:00.000Z');
  const shard = JSON.parse(await readFile(path.join(dir, 'shards', '0220.json'), 'utf8'));
  assert.equal(shard['0220163009'].legal_owner, 'MULTICARE HEALTH SYSTEM');
  const mcFile = JSON.parse(await readFile(path.join(dir, 'multicare.json'), 'utf8'));
  assert.equal(mcFile.count, 1);
});
