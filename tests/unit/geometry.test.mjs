import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMeters, fromMeters, makeProjector, circlePolygon, circleBBox, projectPolygons,
  polygonsIntersectDisk, polygonsWithinDisk, labelPoint, pointInPolygonRings, geometryAreaSqM,
  sqMToAcres, expandBBox, bboxIntersects, geometryBBox, distanceFromOriginToPolygons,
} from '../../js/geometry.js';

const ALLENMORE = [-122.4718, 47.2418]; // approx MultiCare Allenmore Hospital, Tacoma

test('unit conversions are exact', () => {
  assert.equal(toMeters(250, 'yd'), 228.6);
  assert.equal(toMeters(1, 'mi'), 1609.344);
  assert.ok(Math.abs(toMeters(3, 'ft') - 0.9144) < 1e-12);
  assert.ok(Math.abs(fromMeters(228.6, 'yd') - 250) < 1e-12);
  assert.throws(() => toMeters(1, 'furlong'));
});

test('local projector metres-per-degree match WGS84 at Tacoma latitude', () => {
  const p = makeProjector(ALLENMORE);
  // At 47.24N: 1 deg lat ~ 111,183 m ; 1 deg lon ~ 75,690 m (ellipsoidal)
  assert.ok(Math.abs(p.metersPerDegLat - 111183) < 30, `lat m/deg ${p.metersPerDegLat}`);
  assert.ok(Math.abs(p.metersPerDegLon - 75690) < 40, `lon m/deg ${p.metersPerDegLon}`);
  const back = p.toLngLat(p.toXY([-122.47, 47.24]));
  assert.ok(Math.abs(back[0] + 122.47) < 1e-12 && Math.abs(back[1] - 47.24) < 1e-12);
});

test('circle polygon vertices sit exactly on the radius', () => {
  const r = toMeters(250, 'yd');
  const poly = circlePolygon(ALLENMORE, r, 128);
  const p = makeProjector(ALLENMORE);
  const ring = poly.coordinates[0];
  assert.equal(ring.length, 129);
  assert.deepEqual(ring[0], ring[128]);
  for (const c of ring) {
    const [x, y] = p.toXY(c);
    assert.ok(Math.abs(Math.hypot(x, y) - r) < 1e-6);
  }
  const bb = circleBBox(ALLENMORE, r);
  for (const [lon, lat] of ring) {
    assert.ok(lon >= bb[0] - 1e-12 && lon <= bb[2] + 1e-12 && lat >= bb[1] - 1e-12 && lat <= bb[3] + 1e-12);
  }
});

function squareAt(cx, cy, half) {
  return [[[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half]]];
}

test('disk intersection covers inside, straddling, touching, containing, and misses far parcels', () => {
  const r = 228.6;
  assert.equal(polygonsIntersectDisk([squareAt(50, 50, 20)], r), true, 'fully inside');
  assert.equal(polygonsIntersectDisk([squareAt(228, 0, 20)], r), true, 'straddling');
  assert.equal(polygonsIntersectDisk([squareAt(248.6, 0, 20)], r), true, 'edge exactly at radius');
  assert.equal(polygonsIntersectDisk([squareAt(248.61, 0, 20)], r), false, 'edge 1 cm outside');
  assert.equal(polygonsIntersectDisk([squareAt(0, 0, 1000)], r), true, 'parcel contains the whole ring');
  assert.equal(polygonsIntersectDisk([squareAt(600, 600, 20)], r), false, 'far away');
  // Parcel whose vertices are all outside the disk but whose edge crosses it
  const thin = [[[-500, 10], [500, 10], [500, 12], [-500, 12], [-500, 10]]];
  assert.equal(polygonsIntersectDisk([thin], r), true, 'edge crosses disk with no vertex inside');
  assert.equal(polygonsWithinDisk([squareAt(50, 50, 20)], r), true);
  assert.equal(polygonsWithinDisk([squareAt(228, 0, 20)], r), false);
});

test('distance from origin to polygon is zero inside and positive outside', () => {
  assert.equal(distanceFromOriginToPolygons([squareAt(0, 0, 10)]), 0);
  assert.ok(Math.abs(distanceFromOriginToPolygons([squareAt(30, 0, 10)]) - 20) < 1e-9);
  // hole containing origin -> outside
  const withHole = [squareAt(0, 0, 100)[0], squareAt(0, 0, 10)[0]];
  assert.ok(distanceFromOriginToPolygons([withHole]) > 0);
});

test('label point falls inside an L-shaped polygon', () => {
  const L = [[[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100], [0, 0]]];
  const pt = labelPoint([L]);
  assert.ok(pointInPolygonRings(pt, L), `label ${pt} not inside`);
  const sq = squareAt(0, 0, 10);
  assert.deepEqual(labelPoint([sq]).map((v) => Math.round(v * 1e6) / 1e6), [0, 0]);
});

test('geometry area of a 100 m square is 1 hectare (2.471 acres)', () => {
  const p = makeProjector(ALLENMORE);
  const ring = squareAt(0, 0, 50)[0].map((xy) => p.toLngLat(xy));
  const area = geometryAreaSqM({ type: 'Polygon', coordinates: [ring] });
  assert.ok(Math.abs(area - 10000) < 0.05, `area ${area}`);
  assert.ok(Math.abs(sqMToAcres(area) - 2.4710538) < 1e-4);
});

test('bbox helpers', () => {
  const bb = [-122.5, 47.2, -122.4, 47.3];
  const ex = expandBBox(bb, 1000);
  assert.ok(ex[0] < bb[0] && ex[1] < bb[1] && ex[2] > bb[2] && ex[3] > bb[3]);
  assert.equal(bboxIntersects(bb, [-122.45, 47.25, -122.3, 47.4]), true);
  assert.equal(bboxIntersects(bb, [-122.3, 47.25, -122.2, 47.4]), false);
  const g = { type: 'MultiPolygon', coordinates: [squareAt(0, 0, 1), squareAt(10, 10, 1)] };
  assert.deepEqual(geometryBBox(g), [-1, -1, 11, 11]);
  const p = makeProjector(ALLENMORE);
  const polys = projectPolygons(p, { type: 'Polygon', coordinates: [squareAt(0, 0, 0.001)[0].map(([x, y]) => [ALLENMORE[0] + x, ALLENMORE[1] + y])] });
  assert.equal(polys.length, 1);
  assert.equal(polys[0][0].length, 5);
});
