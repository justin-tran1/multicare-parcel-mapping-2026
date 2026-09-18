import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esriGeometryToGeoJSON, esriFeatureSetToGeoJSON, normalizeLayerUrl } from '../../js/arcgis.js';
import { ringSignedArea } from '../../js/geometry.js';

const cw = (ring) => (ringSignedArea(ring) < 0 ? ring : ring.slice().reverse());
const ccw = (ring) => (ringSignedArea(ring) > 0 ? ring : ring.slice().reverse());
const sq = (cx, cy, h) => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]];

test('esri polygon with a hole becomes a single GeoJSON Polygon with two rings', () => {
  const g = { rings: [cw(sq(0, 0, 10)), ccw(sq(0, 0, 2))] };
  const gj = esriGeometryToGeoJSON(g);
  assert.equal(gj.type, 'Polygon');
  assert.equal(gj.coordinates.length, 2);
  assert.ok(ringSignedArea(gj.coordinates[0]) > 0, 'outer ring CCW in GeoJSON');
  assert.ok(ringSignedArea(gj.coordinates[1]) < 0, 'hole CW in GeoJSON');
});

test('two disjoint outer rings become a MultiPolygon', () => {
  const g = { rings: [cw(sq(0, 0, 1)), cw(sq(10, 10, 1))] };
  const gj = esriGeometryToGeoJSON(g);
  assert.equal(gj.type, 'MultiPolygon');
  assert.equal(gj.coordinates.length, 2);
});

test('servers that ignore orientation still yield polygons', () => {
  const g = { rings: [ccw(sq(0, 0, 1)), ccw(sq(10, 10, 1))] };
  const gj = esriGeometryToGeoJSON(g);
  assert.equal(gj.type, 'MultiPolygon');
  assert.equal(gj.coordinates.length, 2);
});

test('degenerate and empty geometries are dropped', () => {
  assert.equal(esriGeometryToGeoJSON({ rings: [] }), null);
  assert.equal(esriGeometryToGeoJSON({ rings: [[[0, 0], [1, 1], [0, 0]]] }), null);
  assert.equal(esriGeometryToGeoJSON(null), null);
  assert.deepEqual(esriGeometryToGeoJSON({ x: 1, y: 2 }), { type: 'Point', coordinates: [1, 2] });
});

test('feature set conversion carries attributes and object ids', () => {
  const fs = {
    objectIdFieldName: 'OBJECTID',
    exceededTransferLimit: true,
    features: [{ attributes: { OBJECTID: 7, Taxpayer_Name: 'MULTICARE HEALTH SYSTEM' }, geometry: { rings: [cw(sq(0, 0, 1))] } }],
  };
  const fc = esriFeatureSetToGeoJSON(fs);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].id, 7);
  assert.equal(fc.features[0].properties.Taxpayer_Name, 'MULTICARE HEALTH SYSTEM');
  assert.equal(fc.exceededTransferLimit, true);
});

test('layer url normalization', () => {
  assert.equal(normalizeLayerUrl('https://x/arcgis/rest/services/A/MapServer/2/?f=json'), 'https://x/arcgis/rest/services/A/MapServer/2');
});
