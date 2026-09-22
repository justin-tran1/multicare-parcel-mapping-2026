import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAddress, NOT_AVAILABLE } from '../../js/format.js';
import { formatDistance, toMeters } from '../../js/geometry.js';
import { missingOwnerText } from '../../js/table.js';

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
  assert.equal(formatAddress(''), '');
  assert.equal(formatAddress(null), '');
  assert.equal(formatAddress(undefined), '');
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
