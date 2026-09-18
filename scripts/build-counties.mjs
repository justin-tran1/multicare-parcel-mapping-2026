// Builds data/wa_counties.json: coarse (1:10m) Washington county polygons used
// only to decide which county data provider(s) to query for a location.
// Source: us-atlas (U.S. Census Bureau cartographic boundaries), public domain.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const topo = JSON.parse(readFileSync(join(root, 'node_modules', 'us-atlas', 'counties-10m.json'), 'utf8'));
const wa = {
  ...topo,
  objects: {
    counties: {
      ...topo.objects.counties,
      geometries: topo.objects.counties.geometries.filter((g) => String(g.id).startsWith('53')),
    },
  },
};
const fc = feature(wa, wa.objects.counties);
const round = (n) => Math.round(n * 1e4) / 1e4;
const roundCoords = (c) => (typeof c[0] === 'number' ? c.map(round) : c.map(roundCoords));
const out = {
  type: 'FeatureCollection',
  note: 'Coarse 1:10m county outlines (US Census via us-atlas) used only for routing queries to county data providers. Not for cadastral use.',
  features: fc.features
    .map((f) => ({
      type: 'Feature',
      properties: { fips: String(f.id), name: f.properties.name },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    }))
    .sort((a, b) => a.properties.name.localeCompare(b.properties.name)),
};
mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(join(root, 'data', 'wa_counties.json'), JSON.stringify(out));
console.log(`wrote data/wa_counties.json with ${out.features.length} counties`);
