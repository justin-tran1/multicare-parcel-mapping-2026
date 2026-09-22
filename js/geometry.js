// Geometry utilities. All lon/lat inputs are WGS84 degrees in GeoJSON order [lon, lat].
//
// Distances are computed in a local ellipsoidal tangent frame centred on the ring
// centre: x = N(phi0) * cos(phi0) * dLambda, y = M(phi0) * dPhi, where N and M are the
// WGS84 prime-vertical and meridional radii of curvature at the centre latitude.
// Within a few kilometres of the centre this is accurate to well under a centimetre,
// far better than the spherical approximation (which is off by up to ~0.3%).

export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export const UNIT_TO_METERS = {
  yd: 0.9144,
  ft: 0.3048,
  m: 1,
  km: 1000,
  mi: 1609.344,
};

export const UNIT_LABELS = { yd: 'yards', ft: 'feet', m: 'meters', km: 'kilometers', mi: 'miles' };
export const UNIT_LABELS_SINGULAR = { yd: 'yard', ft: 'foot', m: 'meter', km: 'kilometer', mi: 'mile' };

export const SQM_PER_ACRE = 4046.8564224;
export const SQFT_PER_ACRE = 43560;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function toMeters(value, unit) {
  const f = UNIT_TO_METERS[unit];
  if (!f) throw new Error(`Unknown unit: ${unit}`);
  return value * f;
}

export function fromMeters(meters, unit) {
  const f = UNIT_TO_METERS[unit];
  if (!f) throw new Error(`Unknown unit: ${unit}`);
  return meters / f;
}

/**
 * Creates a local tangent-plane projector centred on [lon, lat].
 * toXY([lon, lat]) -> [x, y] metres east/north of the centre.
 * toLngLat([x, y]) -> [lon, lat].
 */
export function makeProjector(center) {
  const [lon0, lat0] = center;
  const phi0 = lat0 * D2R;
  const sinPhi = Math.sin(phi0);
  const w = Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const N = WGS84_A / w; // prime vertical radius of curvature
  const M = (WGS84_A * (1 - WGS84_E2)) / (w * w * w); // meridional radius of curvature
  const kx = N * Math.cos(phi0) * D2R; // metres per degree of longitude
  const ky = M * D2R; // metres per degree of latitude
  return {
    center: [lon0, lat0],
    metersPerDegLon: kx,
    metersPerDegLat: ky,
    toXY([lon, lat]) {
      return [(lon - lon0) * kx, (lat - lat0) * ky];
    },
    toLngLat([x, y]) {
      return [lon0 + x / kx, lat0 + y / ky];
    },
  };
}

/** Distance in metres between two lon/lat points, measured in the frame of `projector`. */
export function distanceM(projector, a, b) {
  const [ax, ay] = projector.toXY(a);
  const [bx, by] = projector.toXY(b);
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Builds a GeoJSON Polygon approximating a circle of `radiusM` metres around `center`.
 * Vertices lie exactly on the circle in the local frame; the polygon is inscribed, so the
 * chord midpoints fall inside the true circle by r(1-cos(pi/n)) (0.3 mm at 250 yd, n=128).
 */
export function circlePolygon(center, radiusM, segments = 128) {
  const proj = makeProjector(center);
  const ring = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    ring.push(proj.toLngLat([radiusM * Math.cos(t), radiusM * Math.sin(t)]));
  }
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of a circle. */
export function circleBBox(center, radiusM) {
  const proj = makeProjector(center);
  const [minLon, minLat] = proj.toLngLat([-radiusM, -radiusM]);
  const [maxLon, maxLat] = proj.toLngLat([radiusM, radiusM]);
  return [minLon, minLat, maxLon, maxLat];
}

/** Expands a bbox by `meters` on every side (approximate, using the bbox centre). */
export function expandBBox(bbox, meters) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const proj = makeProjector([(minLon + maxLon) / 2, (minLat + maxLat) / 2]);
  const dLon = meters / proj.metersPerDegLon;
  const dLat = meters / proj.metersPerDegLat;
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

export function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Bounding box of a GeoJSON geometry (Polygon or MultiPolygon). */
export function geometryBBox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of iterRings(geometry)) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Iterates every linear ring of a Polygon / MultiPolygon. */
export function* iterRings(geometry) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) yield ring;
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) for (const ring of poly) yield ring;
  } else if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) yield* iterRings(g);
  }
}

/** Returns the polygons of a geometry as arrays of rings (outer first). */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygonsOf);
  return [];
}

/** Projects a Polygon/MultiPolygon to local XY rings. Returns array of polygons (array of rings). */
export function projectPolygons(projector, geometry) {
  return polygonsOf(geometry).map((rings) => rings.map((ring) => ring.map((c) => projector.toXY(c))));
}

/** Signed area of a ring in the units of its coordinates (shoelace). Positive = counter-clockwise. */
export function ringSignedArea(ring) {
  let s = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return -s / 2;
}

/** Area of projected polygons (outer minus holes) in square metres. */
export function polygonsArea(polysXY) {
  let total = 0;
  for (const rings of polysXY) {
    if (!rings.length) continue;
    total += Math.abs(ringSignedArea(rings[0]));
    for (let i = 1; i < rings.length; i++) total -= Math.abs(ringSignedArea(rings[i]));
  }
  return Math.max(0, total);
}

/** Geodetic-frame area of a GeoJSON polygonal geometry in square metres. */
export function geometryAreaSqM(geometry) {
  const bbox = geometryBBox(geometry);
  if (!isFinite(bbox[0])) return 0;
  const proj = makeProjector([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]);
  return polygonsArea(projectPolygons(proj, geometry));
}

export function sqMToAcres(sqm) {
  return sqm / SQM_PER_ACRE;
}

/** Even-odd point-in-ring test. */
export function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point inside polygon (outer ring, excluding holes). */
export function pointInPolygonRings(pt, rings) {
  if (!rings.length || !pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}

/** Point inside any polygon of a projected multi-polygon. */
export function pointInPolygons(pt, polysXY) {
  return polysXY.some((rings) => pointInPolygonRings(pt, rings));
}

/** Point-in-geometry test in lon/lat space (fine for containment tests). */
export function pointInGeometry(lonLat, geometry) {
  return polygonsOf(geometry).some((rings) => pointInPolygonRings(lonLat, rings));
}

/** Squared distance from point p to segment ab. */
export function distSqPointToSegment(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Minimum distance (m) from the origin of the local frame to the polygon boundary or 0 if inside. */
export function distanceFromOriginToPolygons(polysXY) {
  const origin = [0, 0];
  if (pointInPolygons(origin, polysXY)) return 0;
  let best = Infinity;
  for (const rings of polysXY) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d2 = distSqPointToSegment(origin, ring[j], ring[i]);
        if (d2 < best) best = d2;
      }
    }
  }
  return Math.sqrt(best);
}

/**
 * Exact test: does a disk of radius r (centred at the local origin) intersect the polygon?
 * True when the polygon contains the centre, or any boundary point is within r.
 * Covers parcels fully inside the ring, straddling it, and parcels that fully contain it.
 */
export function polygonsIntersectDisk(polysXY, r) {
  return distanceFromOriginToPolygons(polysXY) <= r;
}

/** Whether the polygon lies entirely within the disk (every vertex within r). */
export function polygonsWithinDisk(polysXY, r) {
  const r2 = r * r;
  for (const rings of polysXY) {
    for (const ring of rings) {
      for (const [x, y] of ring) if (x * x + y * y > r2) return false;
    }
  }
  return true;
}

/** Area-weighted centroid of a ring. */
export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    // degenerate: average of vertices
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / n, sy / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * A point guaranteed to lie inside the polygon, for label placement.
 * Uses the centroid of the largest polygon; if that falls outside (L-shapes, holes),
 * takes the midpoint of the longest interior span along a horizontal scanline through
 * the centroid, then falls back to scanlines at other heights.
 */
export function labelPoint(polysXY) {
  if (!polysXY.length) return [0, 0];
  let best = polysXY[0], bestArea = -1;
  for (const rings of polysXY) {
    const a = Math.abs(ringSignedArea(rings[0] || []));
    if (a > bestArea) { bestArea = a; best = rings; }
  }
  const c = ringCentroid(best[0]);
  if (pointInPolygonRings(c, best)) return c;
  const ys = best[0].map((p) => p[1]);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const candidates = [c[1], (minY + maxY) / 2, minY + (maxY - minY) * 0.35, minY + (maxY - minY) * 0.65, minY + (maxY - minY) * 0.2, minY + (maxY - minY) * 0.8];
  for (const y of candidates) {
    const xs = [];
    for (const ring of best) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((p, q) => p - q);
    let bestLen = -1, bestMid = null;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const len = xs[i + 1] - xs[i];
      const mid = [(xs[i] + xs[i + 1]) / 2, y];
      if (len > bestLen && pointInPolygonRings(mid, best)) { bestLen = len; bestMid = mid; }
    }
    if (bestMid) return bestMid;
  }
  return c;
}

/**
 * Distance in metres formatted for display in the requested unit, spelled out: "184 yards", "0.25 miles", "1 yard".
 * Miles and kilometres get two decimals, three below a tenth so that a parcel a few yards
 * away does not read "0 miles"; a distance that still rounds to zero reads "less than …".
 */
export function formatDistance(meters, unit) {
  const v = fromMeters(meters, unit);
  const digits = unit === 'mi' || unit === 'km' ? (v < 0.1 ? 3 : 2) : 0;
  const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
  let text = fmt(v);
  if (v > 0 && Number(text.replace(/,/g, '')) === 0) text = `less than ${fmt(10 ** -digits)}`;
  const one = text === '1' || text === 'less than 1';
  return `${text} ${one ? UNIT_LABELS_SINGULAR[unit] : UNIT_LABELS[unit]}`;
}
