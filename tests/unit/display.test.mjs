import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAddress, NOT_AVAILABLE } from '../../js/format.js';
import { formatDistance, toMeters } from '../../js/geometry.js';
import { ResultsTable, missingOwnerText } from '../../js/table.js';

test('site addresses are cased like a mailing label', () => {
  assert.equal(formatAddress('1901 S UNION AVE'), '1901 S Union Ave');
  assert.equal(formatAddress('1901  S UNION AVE  '), '1901 S Union Ave');
  assert.equal(formatAddress('3315 S 23RD ST STE 200'), '3315 S 23rd St Ste 200');
  assert.equal(formatAddress('1112 6TH AVE #200A'), '1112 6th Ave #200A');
  assert.equal(formatAddress('11315 BRIDGEPORT WAY SW'), '11315 Bridgeport Way SW');
  assert.equal(formatAddress('401 15TH AVE SE'), '401 15th Ave SE');
  assert.equal(formatAddress('1901-1903 S UNION AVE'), '1901-1903 S Union Ave');
  assert.equal(formatAddress('3402 MCKINLEY AVE E'), '3402 McKinley Ave E');
  assert.equal(formatAddress("120 O'BRIEN LN"), "120 O'Brien Ln");
  assert.equal(formatAddress('PACIFIC HWY / 108TH ST'), 'Pacific Hwy / 108th St');
  assert.equal(formatAddress('TACOMA WA 98405'), 'Tacoma WA 98405');
  assert.equal(formatAddress('1901 S UNION AVE (REAR)'), '1901 S Union Ave (Rear)');
  // Pierce County marks GIS-estimated house numbers with an XXX prefix; keep it
  assert.equal(formatAddress('XXX S UNION AVE'), 'XXX S Union Ave');
  assert.equal(formatAddress('1901 S Union Ave'), '1901 S Union Ave');
  assert.equal(formatAddress('1901 s union ave ste#200a'), '1901 S Union Ave Ste#200A');
  // possessives keep a lower-case s; initials before an apostrophe stay capitals
  assert.equal(formatAddress("1901 FISHERMAN'S BAY RD"), "1901 Fisherman's Bay Rd");
  assert.equal(formatAddress("1901 KING'S WAY"), "1901 King's Way");
  assert.equal(formatAddress('1901 KING’S WAY'), '1901 King’s Way');
  assert.equal(formatAddress("120 D'ANGELO CT"), "120 D'Angelo Ct");
  assert.equal(formatAddress("120 O'SULLIVAN LN"), "120 O'Sullivan Ln");
  // designators glued to numbers or punctuation are cased too
  assert.equal(formatAddress('PACIFIC HWY/108TH ST'), 'Pacific Hwy/108th St');
  assert.equal(formatAddress('HWY 99/OLD HWY 99'), 'Hwy 99/Old Hwy 99');
  assert.equal(formatAddress('1901 S UNION AVE STE#200'), '1901 S Union Ave Ste#200');
  assert.equal(formatAddress('1901 S UNION AVE STE.200'), '1901 S Union Ave Ste.200');
  assert.equal(formatAddress('1901 S UNION AVE LOT2'), '1901 S Union Ave Lot2');
  assert.equal(formatAddress('1901 S UNION AVE 3RD/4TH FL'), '1901 S Union Ave 3rd/4th Fl');
  assert.equal(formatAddress('1901 S UNION AVE,108TH'), '1901 S Union Ave,108th');
  assert.equal(formatAddress('1901 S UNION AVE (7-ELEVEN)'), '1901 S Union Ave (7-Eleven)');
  assert.equal(formatAddress('1000 I-5 EXIT 132 SR-512 US-101'), '1000 I-5 Exit 132 SR-512 US-101');
  assert.equal(formatAddress('1901 N.E. 8TH ST'), '1901 N.E. 8th St');
  assert.equal(formatAddress('P.O. BOX 1234'), 'P.O. Box 1234');
  assert.equal(formatAddress('1901 S UNION AVE APT B'), '1901 S Union Ave Apt B');
  assert.equal(formatAddress('123 1/2 S UNION AVE'), '123 1/2 S Union Ave');
  // non-ASCII letters are letters
  assert.equal(formatAddress('1901 CAÑON ST'), '1901 Cañon St');
  assert.equal(formatAddress('SAN JOSÉ AVE'), 'San José Ave');
  // place names with internal capitals, military installations
  assert.equal(formatAddress('SEATAC'), 'SeaTac');
  assert.equal(formatAddress('DUPONT'), 'DuPont');
  assert.equal(formatAddress('1000 DUPONT-STEILACOOM RD'), '1000 DuPont-Steilacoom Rd');
  assert.equal(formatAddress('MCCHORD AFB'), 'McChord AFB');
  assert.equal(formatAddress('JBLM'), 'JBLM');
  assert.equal(formatAddress(''), '');
  assert.equal(formatAddress('   '), '');
  assert.equal(formatAddress(null), '');
  assert.equal(formatAddress(undefined), '');
});

test('table cells show N/A for a blank site address or a missing distance', () => {
  const t = new ResultsTable({ addEventListener() {} });
  t.optional.situs = true;
  t.optional.distance = true;
  t.unit = 'yd';
  const cols = t.columns();
  const situs = cols.find((c) => c.key === 'situs');
  const dist = cols.find((c) => c.key === 'distance');
  const na = `<span class="muted">${NOT_AVAILABLE}</span>`;
  assert.equal(situs.html({ situs: '' }), na);
  assert.equal(situs.html({ situs: null }), na);
  assert.equal(situs.html({ situs: '1901 S UNION AVE' }), '1901 S Union Ave');
  assert.equal(situs.html({ situs: '<b>1901</b>' }), '&lt;B&gt;1901&lt;/B&gt;');
  assert.equal(dist.html({ distanceM: null }), na);
  assert.equal(dist.html({ distanceM: undefined }), na);
  assert.equal(dist.html({ distanceM: 0 }), 'Contains pin');
  assert.equal(dist.html({ distanceM: toMeters(184, 'yd') }), '184 yards');
  assert.equal(dist.value({ distanceM: undefined }), '');
  // the CSV carries both the metre figure and the formatted distance in the study unit
  t.records = [{ id: 1, distanceM: toMeters(184, 'yd'), situs: '1901 S UNION AVE', city: 'TACOMA' }, { id: 2, distanceM: 0, situs: '', city: '' }];
  const lines = t.toCSV().split('\r\n');
  const head = lines[0].split(',');
  const row1 = lines[1].split(',');
  const row2 = lines[2].split(',');
  assert.equal(row1[head.indexOf('Distance')], '184 yards');
  assert.equal(row2[head.indexOf('Distance')], 'Contains pin');
  assert.equal(row1[head.indexOf('Site address')], '1901 S Union Ave');
  assert.equal(row1[head.indexOf('City')], 'Tacoma');
  assert.equal(row2[head.indexOf('Site address')], '');
});

test('distances spell out the unit, singular for exactly one', () => {
  assert.equal(formatDistance(toMeters(184, 'yd'), 'yd'), '184 yards');
  assert.equal(formatDistance(toMeters(1, 'yd'), 'yd'), '1 yard');
  assert.equal(formatDistance(toMeters(1.4, 'yd'), 'yd'), '1 yard');
  assert.equal(formatDistance(toMeters(0.25, 'mi'), 'mi'), '0.25 miles');
  assert.equal(formatDistance(toMeters(1, 'mi'), 'mi'), '1 mile');
  assert.equal(formatDistance(toMeters(1250, 'ft'), 'ft'), '1,250 feet');
  assert.equal(formatDistance(1, 'ft'), '3 feet');
  assert.equal(formatDistance(1, 'm'), '1 meter');
  assert.equal(formatDistance(1500, 'km'), '1.5 kilometers');
  // a parcel a few yards away is not "0 miles"
  assert.equal(formatDistance(toMeters(7, 'yd'), 'mi'), '0.004 miles');
  assert.equal(formatDistance(toMeters(0.05, 'mi'), 'mi'), '0.05 miles');
  assert.equal(formatDistance(toMeters(0.2, 'mi'), 'mi'), '0.2 miles');
  assert.equal(formatDistance(50, 'km'), '0.05 kilometers');
  assert.equal(formatDistance(0.3, 'm'), 'less than 1 meter');
  assert.equal(formatDistance(0.2, 'yd'), 'less than 1 yard');
  assert.equal(formatDistance(0.2, 'mi'), 'less than 0.001 miles');
  assert.equal(formatDistance(0, 'yd'), '0 yards');
});

test('missing owner text and the not-available placeholder', () => {
  assert.equal(missingOwnerText({ ownerPublished: false }), 'Not Published');
  assert.equal(missingOwnerText({ ownerPublished: true }), 'Blank in assessor record');
  assert.equal(NOT_AVAILABLE, 'N/A');
});
