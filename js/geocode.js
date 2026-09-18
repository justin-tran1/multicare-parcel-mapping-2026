// Address / place geocoding with a fallback chain of keyless public services.
// 1. "lat, lon" literals   2. Nominatim (OpenStreetMap)   3. U.S. Census Geocoder   4. Photon
// All are called directly from the browser; Nominatim's usage policy (max 1 request/s,
// identify the application) is respected by debouncing in the UI and by the Referer header.

import { WA_BBOX } from './config.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const PHOTON = 'https://photon.komoot.io/api/';

async function getJson(url, { signal, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function parseLatLon(text) {
  const m = String(text || '').trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[2]);
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function inWashington(lat, lon) {
  return lon >= WA_BBOX[0] && lon <= WA_BBOX[2] && lat >= WA_BBOX[1] && lat <= WA_BBOX[3];
}

async function nominatim(q, opts) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '6',
    countrycodes: 'us',
    addressdetails: '1',
    // bias (not bound) results to Washington State
    viewbox: `${WA_BBOX[0]},${WA_BBOX[3]},${WA_BBOX[2]},${WA_BBOX[1]}`,
    bounded: '0',
  });
  const rows = await getJson(`${NOMINATIM}?${params}`, opts);
  return (rows || []).map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    label: r.display_name,
    source: 'Nominatim (OpenStreetMap)',
    type: r.type,
  }));
}

async function census(q, opts) {
  const params = new URLSearchParams({ address: q, benchmark: 'Public_AR_Current', format: 'json' });
  const data = await getJson(`${CENSUS}?${params}`, opts);
  return (data?.result?.addressMatches || []).map((m) => ({
    lat: Number(m.coordinates.y),
    lon: Number(m.coordinates.x),
    label: m.matchedAddress,
    source: 'U.S. Census Geocoder',
    type: 'address',
  }));
}

async function photon(q, opts) {
  const params = new URLSearchParams({ q, limit: '6', lat: '47.25', lon: '-122.44' });
  const data = await getJson(`${PHOTON}?${params}`, opts);
  return (data?.features || []).map((f) => {
    const p = f.properties || {};
    const label = [p.name, [p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.county, p.state, p.postcode].filter(Boolean).join(', ');
    return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label, source: 'Photon (OpenStreetMap)', type: p.type };
  });
}

/**
 * Geocodes free text. Resolves to an array of candidates {lat, lon, label, source}
 * sorted with Washington results first. Throws only when every service fails.
 */
export async function geocode(text, { signal } = {}) {
  const q = String(text || '').trim();
  if (!q) return [];
  const ll = parseLatLon(q);
  if (ll) return [{ ...ll, label: `${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}`, source: 'coordinates', type: 'point' }];

  const errors = [];
  for (const svc of [nominatim, census, photon]) {
    try {
      const rows = (await svc(q, { signal })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
      if (rows.length) {
        rows.sort((a, b) => Number(inWashington(b.lat, b.lon)) - Number(inWashington(a.lat, a.lon)));
        return rows;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      errors.push(`${svc.name}: ${err.message}`);
    }
  }
  if (errors.length === 3) throw new Error(`All geocoders failed. ${errors.join(' | ')}`);
  return [];
}

/** Reverse geocode a point to a short address label (best effort). */
export async function reverseGeocode(lat, lon, { signal } = {}) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: '18' });
    const r = await getJson(`https://nominatim.openstreetmap.org/reverse?${params}`, { signal, timeoutMs: 10000 });
    return r?.display_name || '';
  } catch {
    return '';
  }
}
