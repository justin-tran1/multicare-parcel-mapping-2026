// Application controller: map, pin/ring interaction, live parcel loading, numbering,
// MultiCare shading, results table, sharing and printing.
import { CBRE, RING_DEFAULTS, PARCEL_STYLE, MIN_PARCEL_ZOOM, MAX_RING_RADIUS_M, BASEMAPS, DEFAULT_BASEMAP, WA_BBOX, SITE_BASE } from './config.js';
import {
  toMeters, fromMeters, makeProjector, circlePolygon, circleBBox, projectPolygons, distanceFromOriginToPolygons,
  labelPoint, pointInGeometry, UNIT_LABELS, formatDistance, expandBBox,
} from './geometry.js';
import { ParcelService } from './parcels.js';
import { loadData } from './data.js';
import { geocode, reverseGeocode } from './geocode.js';
import { classifyParcel, DEFAULT_PATTERNS, parseUserPatterns } from './multicare.js';
import { loadJSON, saveJSON } from './storage.js';
import { escapeHtml, formatCurrency, formatAcres, downloadText, slugify } from './format.js';
import { ResultsTable, rowClass, valueNote, formatSaleDate } from './table.js';
import { printExhibit } from './print.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  map: null,
  baseLayers: {},
  baseOverlay: null,
  layersControl: null,
  pin: null, // { lat, lon, label }
  pinMarker: null,
  ringLayer: null,
  ring: { ...RING_DEFAULTS, ...loadJSON('ring', {}) },
  settings: {
    basemap: DEFAULT_BASEMAP,
    showParcels: true,
    showLabels: true,
    shadeMultiCare: true,
    showOccupied: true,
    ringOnly: false,
    extraPatterns: '',
    title: '',
    subtitle: '',
    sidebarCollapsed: false,
    cols: { parcelId: false, situs: false, distance: false },
    ...loadJSON('settings', {}),
  },
  occupiedMarks: loadJSON('occupied', {}),
  dropMode: false,
  service: null,
  view: { records: new Map(), layer: null, layers: new Map(), lastBBox: null, abort: null, timer: null },
  study: { records: [], layer: null, layers: new Map(), labels: null, abort: null, projector: null, radiusM: 0, counties: [], statuses: [] },
  locations: [],
  table: null,
  patterns: DEFAULT_PATTERNS,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, { error = false, ms = 4000 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function setMapStatus(msg) {
  const el = $('#map-status');
  if (!msg) {
    el.hidden = true;
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

function saveSettings() {
  saveJSON('settings', state.settings);
}
function saveRing() {
  saveJSON('ring', state.ring);
}

function radiusMeters() {
  const r = toMeters(Number(state.ring.radius) || 0, state.ring.unit);
  return Math.max(1, Math.min(MAX_RING_RADIUS_M, r));
}

function dashArray(dash, weight) {
  const w = Math.max(1, weight);
  switch (dash) {
    case 'dashed': return `${w * 3} ${w * 2}`;
    case 'dotted': return `1 ${w * 2}`;
    case 'dashdot': return `${w * 3} ${w * 2} 1 ${w * 2}`;
    default: return null;
  }
}

function ringStyle() {
  const r = state.ring;
  return {
    color: r.color,
    weight: Number(r.weight),
    dashArray: dashArray(r.dash, Number(r.weight)),
    lineCap: r.dash === 'dotted' ? 'round' : 'butt',
    lineJoin: 'round',
    fill: Boolean(r.fill),
    fillColor: r.fillColor,
    fillOpacity: Number(r.fillOpacity),
    interactive: false,
  };
}

function isOwnedRelationship(rel) {
  return ['owned', 'foundation', 'historical_name'].includes(rel);
}

function parcelStyle(rec, inStudy) {
  let s = { ...(inStudy ? PARCEL_STYLE.inRing : PARCEL_STYLE.outline) };
  if (state.settings.shadeMultiCare && rec.multicare) {
    s = { ...s, ...(isOwnedRelationship(rec.multicare.relationship) ? PARCEL_STYLE.multicareOwned : PARCEL_STYLE.multicareAffiliate) };
  }
  if (state.settings.showOccupied && rec.occupied) s = { ...s, color: PARCEL_STYLE.multicareOccupied.color, weight: Math.max(s.weight, 2.5) };
  if (state.settings.ringOnly && !inStudy && state.study.records.length) s = { ...s, opacity: 0.2, fillOpacity: s.fillOpacity * 0.3 };
  return s;
}

function markOf(rec) {
  return state.occupiedMarks[rec.markKey] ?? state.occupiedMarks[rec.key];
}

function classifyRecord(rec) {
  // Ownership: taxpayer of record, then the legal owner on the latest deed, then (flagged as
  // inferred) a MultiCare business name on a tax-exempt parcel whose owner names are withheld.
  const { multicare, business: biz } = classifyParcel(rec, { patterns: state.patterns, county: rec.county });
  rec.multicare = multicare;
  // Occupancy: a MultiCare business name on the parcel does not by itself imply ownership.
  const mark = markOf(rec);
  const loc = state.locations.find((l) => l.lat && l.lon && pointInGeometry([l.lon, l.lat], rec.geometry));
  rec.occupied = Boolean(mark) || Boolean(loc) || Boolean(biz);
  if (mark) rec.occupiedBy = typeof mark === 'string' ? mark : 'Marked by user';
  else if (loc) rec.occupiedBy = loc.name;
  else if (biz) rec.occupiedBy = `${rec.businessName} (business name on the assessor roll)`;
  else rec.occupiedBy = '';
}

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------
function initMap() {
  const map = L.map('map', { preferCanvas: true, zoomControl: true, worldCopyJump: false, minZoom: 5 });
  map.setView([47.2529, -122.4443], 12); // Tacoma, WA
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.scale({ imperial: true, metric: true, position: 'bottomleft' }).addTo(map);

  const baseLayers = {};
  for (const b of BASEMAPS) {
    const layer = L.tileLayer(b.url, { ...b.options, crossOrigin: true });
    if (b.overlay) {
      const group = L.layerGroup([layer, L.tileLayer(b.overlay, { ...b.options, attribution: '', crossOrigin: true })]);
      group._isTileGroup = true;
      baseLayers[b.name] = group;
    } else baseLayers[b.name] = layer;
    baseLayers[b.name]._basemapId = b.id;
  }
  state.baseLayers = baseLayers;
  const sel = $('#basemap');
  sel.innerHTML = BASEMAPS.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  const initial = BASEMAPS.find((b) => b.id === state.settings.basemap) || BASEMAPS[0];
  sel.value = initial.id;
  baseLayers[initial.name].addTo(map);
  state.layersControl = L.control.layers(baseLayers, null, { position: 'topright', collapsed: true }).addTo(map);
  map.on('baselayerchange', (e) => {
    const id = e.layer._basemapId;
    if (id) {
      state.settings.basemap = id;
      sel.value = id;
      saveSettings();
    }
  });
  sel.addEventListener('change', () => setBasemap(sel.value));

  // Legend control
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend leaflet-control');
    div.id = 'legend';
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);

  // Layers
  const canvas = L.canvas({ padding: 0.5 });
  state.view.layer = L.geoJSON(null, {
    renderer: canvas,
    style: (f) => parcelStyle(state.view.records.get(f.properties.key), false),
    onEachFeature: (f, layer) => bindParcelLayer(layer, f.properties.key, false),
  }).addTo(map);
  state.study.layer = L.geoJSON(null, {
    style: (f) => parcelStyle(recordByKey(f.properties.key), true),
    onEachFeature: (f, layer) => bindParcelLayer(layer, f.properties.key, true),
  }).addTo(map);
  state.study.labels = L.layerGroup().addTo(map);
  state.locationLayer = L.layerGroup().addTo(map);

  map.on('moveend zoomend', scheduleViewFetch);
  map.on('click', (e) => {
    if (state.dropMode) {
      setDropMode(false);
      setPin({ lat: e.latlng.lat, lon: e.latlng.lng, label: '' }, { reverse: true });
    }
  });
  state.map = map;
}

function setBasemap(id) {
  const b = BASEMAPS.find((x) => x.id === id);
  if (!b) return;
  for (const layer of Object.values(state.baseLayers)) if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
  state.baseLayers[b.name].addTo(state.map);
  state.settings.basemap = id;
  saveSettings();
}

function recordByKey(key) {
  return state.study.records.find((r) => r.key === key) || state.view.records.get(key);
}

function bindParcelLayer(layer, key, inStudy) {
  layer.on('click', (e) => {
    L.DomEvent.stop(e);
    openPopup(key, e.latlng);
  });
  layer.on('mouseover', () => highlightParcel(key, true));
  layer.on('mouseout', () => highlightParcel(key, false));
  const store = inStudy ? state.study.layers : state.view.layers;
  store.set(key, layer);
}

function highlightParcel(key, on) {
  const rec = recordByKey(key);
  if (!rec) return;
  for (const [store, inStudy] of [[state.study.layers, true], [state.view.layers, false]]) {
    const l = store.get(key);
    if (l) l.setStyle(on ? { ...parcelStyle(rec, inStudy), ...PARCEL_STYLE.hover } : parcelStyle(rec, inStudy));
  }
  const marker = state.study.labels.getLayers().find((m) => m.options.parcelKey === key);
  if (marker) marker.getElement()?.querySelector('.pnum')?.classList.toggle('hl', on);
  if (state.table) state.table.highlight(key, on);
}

function restyleAll() {
  for (const [key, l] of state.view.layers) {
    const rec = state.view.records.get(key);
    if (rec) l.setStyle(parcelStyle(rec, false));
  }
  for (const [key, l] of state.study.layers) {
    const rec = recordByKey(key);
    if (rec) l.setStyle(parcelStyle(rec, true));
  }
  renderLabels();
  renderLegend();
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------
function popupHtml(rec) {
  const badges = [];
  if (rec.multicare) badges.push(`<span class="badge ${isOwnedRelationship(rec.multicare.relationship) ? '' : 'aff'}" title="${escapeHtml(rec.multicare.entity)}${rec.multicare.matchedOn ? ` · matched on ${escapeHtml(rec.multicare.matchedOn)}` : ''}">${escapeHtml(rec.multicare.label)}</span>`);
  if (rec.occupied) badges.push(`<span class="badge occ" title="${escapeHtml(rec.occupiedBy || '')}">MultiCare occupied</span>`);
  const muted = (t) => `<span class="muted">${escapeHtml(t)}</span>`;
  const rows = [];
  const noTaxpayer = rec.ownerPublished ? 'blank in the assessor record' : 'not published by this source';
  if (rec.ownerSource === 'legal') {
    rows.push(['Owner (deed grantee)', escapeHtml(rec.owner) + (rec.notes?.legal_owner ? ` ${muted(`(${rec.notes.legal_owner})`)}` : '')]);
    rows.push(['Taxpayer', muted(noTaxpayer)]);
  } else {
    rows.push(['Taxpayer / owner', rec.owner ? escapeHtml(rec.owner) + (rec.ownerNote ? ` ${muted(`(${rec.ownerNote})`)}` : '') : muted(noTaxpayer)]);
    rows.push(['Legal owner (deed)', rec.legalOwner ? escapeHtml(rec.legalOwner) + (rec.notes?.legal_owner ? ` ${muted(`(${rec.notes.legal_owner})`)}` : '') : muted('not available')]);
  }
  if (rec.businessName) rows.push(['Business on parcel', `${escapeHtml(rec.businessName)} ${muted('(occupant per assessor, not ownership)')}`]);
  rows.push(
    ['Parcel #', escapeHtml(rec.parcelId || '')],
    ['Address', escapeHtml([rec.situs, rec.city].filter(Boolean).join(', '))],
    [rec.valueKind === 'taxable' ? 'Taxable value' : 'Value', rec.value !== null ? `${formatCurrency(rec.value)}${rec.valueKind !== 'taxable' ? ` <span class="muted">(${escapeHtml(valueNote(rec))})</span>` : ''}` : '<span class="muted">n/a</span>'],
  );
  if (rec.landValue !== null && rec.landValue !== undefined) rows.push(['Land value', formatCurrency(rec.landValue)]);
  if (rec.improvementValue !== null && rec.improvementValue !== undefined) rows.push(['Improvements', formatCurrency(rec.improvementValue)]);
  if (rec.totalValue !== null && rec.totalValue !== undefined && rec.valueKind !== 'total') rows.push(['Total market value', formatCurrency(rec.totalValue)]);
  if (rec.exemption) rows.push(['Exemption', escapeHtml(rec.exemption)]);
  rows.push(['Land', `${formatAcres(rec.acres)} ac${rec.acresSource === 'gis' ? ' <span class="muted">(from geometry)</span>' : rec.acresSource === 'sqft' ? ' <span class="muted">(from lot sq ft)</span>' : ''}`]);
  rows.push(['Use', escapeHtml(rec.useText || rec.useCode || 'n/a') + (rec.useCode && rec.useText && !rec.useText.includes(rec.useCode) ? ` <span class="muted">(${escapeHtml(rec.useCode)})</span>` : '')]);
  rows.push(['Zoning', rec.zoning
    ? `<strong>${escapeHtml(rec.zoning)}</strong>${rec.zoningDescription ? ` ${escapeHtml(rec.zoningDescription)}` : ''} ${muted(`(${[rec.zoningJurisdiction, rec.zoningSource === 'assessor' ? 'assessor attribute' : rec.zoningSource].filter(Boolean).join(', ')})`)}`
    : muted('not available for this parcel')]);
  if (rec.saleDate) {
    const parts = [escapeHtml(formatSaleDate(rec.saleDate))];
    if (rec.salePrice !== null && rec.salePrice !== undefined) parts.push(formatCurrency(rec.salePrice));
    if (rec.saleDeedType) parts.push(escapeHtml(rec.saleDeedType));
    let sale = parts.join(' · ');
    if (rec.saleGrantor) sale += `<br>${muted(`from ${rec.saleGrantor}`)}`;
    if (rec.saleValid === false) sale += `<br>${muted(`not an arm's-length market sale per the assessor${rec.saleExcludeReason ? `: ${rec.saleExcludeReason}` : ''}`)}`;
    if (rec.validSaleDate && rec.validSaleDate !== rec.saleDate) sale += `<br>${muted(`last market sale ${formatSaleDate(rec.validSaleDate)}${rec.validSalePrice !== null && rec.validSalePrice !== undefined ? ` · ${formatCurrency(rec.validSalePrice)}` : ''}`)}`;
    rows.push(['Last sale', sale]);
  } else rows.push(['Last sale', muted('not available from this source')]);
  if (rec.county) rows.push(['County', escapeHtml(rec.county)]);
  if (rec.distanceM !== null && rec.distanceM !== undefined) rows.push(['Distance', rec.distanceM === 0 ? 'contains the pin' : formatDistance(rec.distanceM, state.ring.unit)]);
  const marked = Boolean(markOf(rec));
  return `<div class="popup">
    <h3>${rec.id ? `#${rec.id} ` : ''}${escapeHtml(rec.owner || rec.situs || rec.parcelId || 'Parcel')}${badges.join('')}</h3>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="actions">
      ${rec.link ? `<a class="btn btn-outline small" href="${escapeHtml(rec.link)}" target="_blank" rel="noopener">Assessor record</a>` : ''}
      <button class="btn btn-outline small" type="button" data-action="toggle-occupied" data-key="${escapeHtml(rec.key)}">${marked ? 'Unmark occupied' : 'Mark MultiCare occupied'}</button>
      <button class="btn btn-outline small" type="button" data-action="zoom" data-key="${escapeHtml(rec.key)}">Zoom</button>
    </div>
    <div class="src">Source: ${escapeHtml(rec.sourceName)}${rec.sourceFields?.owner ? ` · owner field: ${escapeHtml(rec.sourceFields.owner)}` : ''}${rec.sourceFields?.legal_owner ? ` · legal owner: ${escapeHtml(rec.sourceFields.legal_owner)}` : ''}${rec.sourceFields?.taxable_value ? ` · value field: ${escapeHtml(rec.sourceFields.taxable_value)}` : ''}${rec.sourceFields?.sale_date ? ` · sale: ${escapeHtml(rec.sourceFields.sale_date)}` : ''}</div>
  </div>`;
}

function openPopup(key, latlng) {
  const rec = recordByKey(key);
  if (!rec) return;
  const popup = L.popup({ maxWidth: 360, autoPanPadding: [40, 40] }).setLatLng(latlng).setContent(popupHtml(rec)).openOn(state.map);
  const el = popup.getElement();
  el.querySelector('[data-action="toggle-occupied"]')?.addEventListener('click', () => {
    if (markOf(rec)) {
      delete state.occupiedMarks[rec.markKey];
      delete state.occupiedMarks[rec.key];
    } else state.occupiedMarks[rec.markKey] = 'Marked by user';
    saveJSON('occupied', state.occupiedMarks);
    reclassifyAll();
    popup.setContent(popupHtml(rec));
    openPopup(key, latlng);
  });
  el.querySelector('[data-action="zoom"]')?.addEventListener('click', () => {
    state.map.fitBounds(L.geoJSON(rec.geometry).getBounds(), { maxZoom: 19, padding: [40, 40] });
  });
}

// ---------------------------------------------------------------------------
// Parcels in view
// ---------------------------------------------------------------------------
function scheduleViewFetch() {
  clearTimeout(state.view.timer);
  state.view.timer = setTimeout(fetchViewParcels, 350);
}

function bboxContains(outer, inner) {
  return outer && inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

async function fetchViewParcels() {
  const map = state.map;
  if (!state.service) return;
  if (!state.settings.showParcels || map.getZoom() < MIN_PARCEL_ZOOM) {
    if (map.getZoom() < MIN_PARCEL_ZOOM && state.settings.showParcels) setMapStatus(`Zoom in to level ${MIN_PARCEL_ZOOM}+ to load parcels (now ${map.getZoom()})`);
    else setMapStatus('');
    return;
  }
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  if (bboxContains(state.view.lastBBox, bbox)) {
    setMapStatus('');
    return;
  }
  if (state.view.abort) state.view.abort.abort();
  const ctrl = new AbortController();
  state.view.abort = ctrl;
  const pad = Math.min(600, Math.max(60, (b.getNorthEast().distanceTo(b.getSouthWest()) * 0.15)));
  const exBBox = expandBBox(bbox, pad);
  setMapStatus('Loading parcels in view…');
  try {
    const { records, statuses } = await state.service.fetchParcels(exBBox, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    if (state.view.records.size > 15000) clearViewParcels();
    let added = 0;
    for (const rec of records) {
      if (state.view.records.has(rec.key)) continue;
      classifyRecord(rec);
      state.view.records.set(rec.key, rec);
      state.view.layer.addData({ type: 'Feature', properties: { key: rec.key }, geometry: rec.geometry });
      added += 1;
    }
    state.view.lastBBox = exBBox;
    const failed = statuses.filter((s) => !s.ok && s.role !== 'enrich');
    setMapStatus(failed.length && !statuses.some((s) => s.ok && s.role === 'primary') ? 'Parcel service unavailable for this area' : '');
    if (!state.study.records.length) renderSources(statuses);
    renderLegend();
    if (added) renderLabels();
  } catch (err) {
    if (ctrl.signal.aborted) return;
    setMapStatus('');
    toast(`Could not load parcels: ${err.message}`, { error: true });
  }
}

function clearViewParcels() {
  state.view.layer.clearLayers();
  state.view.layers.clear();
  state.view.records.clear();
  state.view.lastBBox = null;
}

// ---------------------------------------------------------------------------
// Pin & ring
// ---------------------------------------------------------------------------
function pinIcon() {
  const svg = `<svg class="pin-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25 15 39 15 39s14-14 14-24.1C29 7.2 22.7 1 15 1z" fill="${CBRE.green}" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5.5" fill="${CBRE.accentGreen}"/></svg>`;
  return L.divIcon({ className: 'pin-wrap', html: svg, iconSize: [30, 40], iconAnchor: [15, 39], popupAnchor: [0, -36] });
}

async function setPin(pin, { reverse = false, fit = true } = {}) {
  state.pin = pin;
  if (!state.pinMarker) {
    state.pinMarker = L.marker([pin.lat, pin.lon], { icon: pinIcon(), draggable: true, zIndexOffset: 1000, title: 'Study centre (drag to move)' }).addTo(state.map);
    state.pinMarker.on('dragend', () => {
      const ll = state.pinMarker.getLatLng();
      setPin({ lat: ll.lat, lon: ll.lng, label: '' }, { reverse: true, fit: false });
    });
  } else state.pinMarker.setLatLng([pin.lat, pin.lon]);
  const inWA = pin.lon >= WA_BBOX[0] && pin.lon <= WA_BBOX[2] && pin.lat >= WA_BBOX[1] && pin.lat <= WA_BBOX[3];
  if (!inWA) toast('This location is outside Washington State; parcel coverage is Washington only.', { error: true, ms: 6000 });
  $('#btn-clear').disabled = false;
  $('#btn-fit').disabled = false;
  $('#btn-share').disabled = false;
  updatePinInfo();
  writeHash();
  await runStudy({ fit });
  if (reverse && !pin.label) {
    reverseGeocode(pin.lat, pin.lon).then((label) => {
      if (state.pin === pin && label) {
        pin.label = label;
        updatePinInfo();
        updateDefaultTitles();
      }
    });
  }
}

function updatePinInfo() {
  const p = state.pin;
  if (!p) {
    $('#pin-info').textContent = 'No pin yet. Search an address or choose “Drop pin on map”, then click the map. The pin can be dragged.';
    return;
  }
  $('#pin-info').innerHTML = `<strong>Pin:</strong> ${escapeHtml(p.label || '')} <span class="muted">(${p.lat.toFixed(6)}, ${p.lon.toFixed(6)})</span>`;
}

function drawRing() {
  if (!state.pin) return;
  const r = radiusMeters();
  const poly = circlePolygon([state.pin.lon, state.pin.lat], r, RING_DEFAULTS.segments);
  const latlngs = poly.coordinates[0].map(([lon, lat]) => [lat, lon]);
  if (!state.svgRenderer) state.svgRenderer = L.svg({ padding: 0.5 });
  // The ring is drawn as SVG (crisp dashes when printed) even though parcels use canvas.
  if (!state.ringLayer) state.ringLayer = L.polygon(latlngs, { ...ringStyle(), renderer: state.svgRenderer }).addTo(state.map);
  else {
    state.ringLayer.setLatLngs(latlngs);
    state.ringLayer.setStyle(ringStyle());
  }
  state.ringLayer.bringToBack();
  state.view.layer.bringToFront();
  state.study.layer.bringToFront();
}

function clearStudy() {
  state.study.layer.clearLayers();
  state.study.layers.clear();
  state.study.labels.clearLayers();
  state.study.records = [];
  state.study.statuses = [];
  if (state.table) state.table.setRecords([]);
  $('#btn-export').disabled = true;
  $('#btn-print').disabled = true;
  $('#btn-renumber').disabled = true;
  $('#results-meta').textContent = 'Drop a pin to list parcels.';
  $('#results-title').textContent = 'Parcels within ring';
}

function clearAll() {
  if (state.study.abort) state.study.abort.abort();
  clearStudy();
  if (state.pinMarker) {
    state.map.removeLayer(state.pinMarker);
    state.pinMarker = null;
  }
  if (state.ringLayer) {
    state.map.removeLayer(state.ringLayer);
    state.ringLayer = null;
  }
  state.pin = null;
  $('#btn-clear').disabled = true;
  $('#btn-fit').disabled = true;
  $('#btn-share').disabled = true;
  updatePinInfo();
  restyleAll();
  history.replaceState(null, '', location.pathname + location.search);
  renderSources([]);
}

let studyTimer = null;
function scheduleStudy() {
  clearTimeout(studyTimer);
  drawRing();
  studyTimer = setTimeout(() => runStudy({ fit: false }), 300);
}

async function runStudy({ fit = false } = {}) {
  if (!state.pin) return;
  drawRing();
  if (!state.service) return; // re-run once the county index has loaded (see main)
  if (state.study.abort) state.study.abort.abort();
  const ctrl = new AbortController();
  state.study.abort = ctrl;
  const center = [state.pin.lon, state.pin.lat];
  const r = radiusMeters();
  const bbox = expandBBox(circleBBox(center, r), 2);
  const rLabel = `${Number(state.ring.radius).toLocaleString()} ${UNIT_LABELS[state.ring.unit]}`;
  $('#results-meta').textContent = `Querying parcel records within ${rLabel}…`;
  setMapStatus('Querying parcel records…');
  const statuses = [];
  try {
    const result = await state.service.fetchParcels(bbox, {
      signal: ctrl.signal,
      onStatus: (s) => {
        statuses.push(s);
        if (s.ok && s.role === 'primary') setMapStatus(`${s.providerName}: ${s.count} parcels in envelope…`);
      },
    });
    if (ctrl.signal.aborted) return;
    const projector = makeProjector(center);
    const hits = [];
    for (const rec of result.records) {
      const polys = projectPolygons(projector, rec.geometry);
      const d = distanceFromOriginToPolygons(polys);
      if (d <= r) {
        rec.distanceM = d;
        rec.labelLngLat = projector.toLngLat(labelPoint(polys));
        classifyRecord(rec);
        hits.push(rec);
      }
    }
    hits.sort((a, b) => a.distanceM - b.distanceM || String(a.owner).localeCompare(String(b.owner)) || String(a.parcelId).localeCompare(String(b.parcelId)));
    hits.forEach((rec, i) => { rec.id = i + 1; });

    // Render
    state.study.layer.clearLayers();
    state.study.layers.clear();
    state.study.records = hits;
    state.study.projector = projector;
    state.study.radiusM = r;
    state.study.counties = result.counties;
    state.study.statuses = result.statuses;
    for (const rec of hits) state.study.layer.addData({ type: 'Feature', properties: { key: rec.key }, geometry: rec.geometry });
    renderLabels();
    renderLegend();
    renderSources(result.statuses);
    state.table.setRecords(hits, { unit: state.ring.unit });
    const failed = result.statuses.filter((s) => !s.ok && s.role !== 'enrich');
    const okPrimary = result.statuses.filter((s) => s.ok && s.role === 'primary');
    const mc = hits.filter((h) => h.multicare).length;
    const truncated = okPrimary.some((s) => s.truncated);
    $('#results-title').textContent = `Parcels within ${rLabel}`;
    $('#results-meta').textContent = `${hits.length} parcel${hits.length === 1 ? '' : 's'} intersect the ring · ${mc} MultiCare-affiliated · ${result.counties.join(', ') || 'no county detected'}${truncated ? ' · result set truncated by the server' : ''}${failed.length && !okPrimary.length ? ' · data source unavailable' : ''}`;
    $('#btn-export').disabled = hits.length === 0;
    $('#btn-print').disabled = hits.length === 0;
    $('#btn-renumber').disabled = hits.length === 0;
    setMapStatus(okPrimary.length ? '' : 'No parcel service responded for this location');
    if (!okPrimary.length) toast('No parcel data source responded for this location. See Data sources in the sidebar.', { error: true, ms: 7000 });
    updateDefaultTitles();
    updateMcSummary();
    restyleAll();
    if (fit) fitRing();
  } catch (err) {
    if (ctrl.signal.aborted) return;
    setMapStatus('');
    $('#results-meta').textContent = `Query failed: ${err.message}`;
    toast(`Parcel query failed: ${err.message}`, { error: true, ms: 7000 });
  }
}

function fitRing() {
  if (state.ringLayer) state.map.fitBounds(state.ringLayer.getBounds(), { padding: [30, 30] });
}

function labelClass(rec) {
  const cls = ['pnum'];
  if (state.settings.shadeMultiCare && rec.multicare) cls.push(isOwnedRelationship(rec.multicare.relationship) ? 'mc-owned' : 'mc-affiliate');
  if (state.settings.showOccupied && rec.occupied) cls.push('mc-occupied');
  if (rec.id >= 100) cls.push('wide');
  return cls.join(' ');
}

function renderLabels() {
  const group = state.study.labels;
  group.clearLayers();
  if (!state.settings.showLabels) return;
  for (const rec of state.study.records) {
    if (!rec.labelLngLat) continue;
    const icon = L.divIcon({ className: 'pnum-wrap', html: `<div class="${labelClass(rec)}">${rec.id}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    const m = L.marker([rec.labelLngLat[1], rec.labelLngLat[0]], { icon, parcelKey: rec.key, keyboard: false, zIndexOffset: 500, title: `#${rec.id} ${rec.owner || ''}` });
    m.on('click', (e) => openPopup(rec.key, e.latlng));
    m.on('mouseover', () => highlightParcel(rec.key, true));
    m.on('mouseout', () => highlightParcel(rec.key, false));
    group.addLayer(m);
  }
}

function renderLocations() {
  const group = state.locationLayer;
  group.clearLayers();
  if (!state.settings.showOccupied) return;
  for (const loc of state.locations) {
    if (!loc.lat || !loc.lon) continue;
    const m = L.marker([loc.lat, loc.lon], { icon: L.divIcon({ className: 'occ-wrap', html: '<div class="occ-dot"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }), keyboard: false, title: loc.name });
    m.bindTooltip(`${escapeHtml(loc.name)}<br><span class="muted">${escapeHtml(loc.address || '')}${loc.city ? ', ' + escapeHtml(loc.city) : ''}</span>`, { direction: 'top' });
    group.addLayer(m);
  }
}

function renderLegend() {
  const el = document.getElementById('legend');
  if (!el) return;
  const hits = state.study.records;
  const owned = hits.filter((r) => r.multicare && isOwnedRelationship(r.multicare.relationship)).length;
  const aff = hits.filter((r) => r.multicare && !isOwnedRelationship(r.multicare.relationship)).length;
  const occ = hits.filter((r) => r.occupied).length;
  const rows = [];
  if (state.pin) rows.push(`<div class="legend-row"><span class="legend-swatch ring" style="border-top-color:${escapeHtml(state.ring.color)}"></span>${Number(state.ring.radius).toLocaleString()} ${UNIT_LABELS[state.ring.unit]} ring</div>`);
  rows.push(`<div class="legend-row"><span class="legend-swatch"></span>Parcel${hits.length ? ` in study (${hits.length})` : ''}</div>`);
  if (state.settings.shadeMultiCare) {
    rows.push(`<div class="legend-row"><span class="legend-swatch mc-owned"></span>MultiCare owned${hits.length ? ` (${owned})` : ''}</div>`);
    if (aff || !hits.length) rows.push(`<div class="legend-row"><span class="legend-swatch mc-affiliate"></span>MultiCare affiliate / JV${hits.length ? ` (${aff})` : ''}</div>`);
  }
  if (state.settings.showOccupied) rows.push(`<div class="legend-row"><span class="legend-dot"></span>MultiCare occupied${hits.length ? ` (${occ})` : ''}</div>`);
  el.innerHTML = `<h3>Legend</h3>${rows.join('')}`;
}

function renderSources(statuses) {
  const el = $('#sources');
  if (!statuses || !statuses.length) {
    el.innerHTML = '<p class="hint">Parcel geometry and assessor attributes are queried live from county, city, and Washington State GIS services when you zoom in or run a radius study.</p>';
    return;
  }
  const seen = new Set();
  const items = [];
  for (const s of statuses) {
    const k = `${s.url}|${s.ok}|${s.role || ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const fm = s.fieldMap || {};
    const mapRows = s.ok ? [
      ['owner', 'Owner'], ['legal_owner', 'Legal owner'], ['business_name', 'Business name'], ['taxable_value', 'Taxable value'], ['total_value', 'Total value'], ['land_acres', 'Acres'], ['land_sqft', 'Lot sq ft'],
      ['use_description', 'Use'], ['use_code', 'Use code'], ['zoning', 'Zoning'], ['zoning_description', 'Zoning desc.'], ['sale_date', 'Sale date'], ['sale_price', 'Sale price'], ['sale_grantor', 'Grantor'], ['parcel_id', 'Parcel #'],
    ].filter(([a]) => fm[a]).map(([a, label]) => `${label} ← <code>${escapeHtml(typeof fm[a] === 'string' ? fm[a] : String(fm[a]))}</code>`) : [];
    const roleLabel = { enrich: 'attribute join', static: 'assessor extract', zoning: 'zoning districts' }[s.role];
    let status;
    if (!s.ok) status = `<span class="status-err">unavailable</span> · ${escapeHtml(s.error || '')}`;
    else if (s.role === 'zoning') status = `<span class="status-ok">online</span> · ${s.count} zoning polygon${s.count === 1 ? '' : 's'} in area${s.placeholders ? ` (${s.placeholders} city placeholder${s.placeholders === 1 ? '' : 's'} skipped)` : ''}${s.jurisdiction ? ` · ${escapeHtml(s.jurisdiction)}` : ''}${s.truncated ? ' (truncated)' : ''}`;
    else if (s.role === 'static') status = `<span class="status-ok">loaded</span> · ${s.joined ?? 0} parcel${s.joined === 1 ? '' : 's'} matched${s.generated ? ` · extract built ${escapeHtml(String(s.generated).slice(0, 10))}` : ''}${s.asOf ? ` from files dated ${escapeHtml(String(s.asOf).slice(0, 10))}` : ''}`;
    else status = `<span class="status-ok">online</span> · ${s.count} record${s.count === 1 ? '' : 's'} in query envelope${s.joined !== undefined ? ` · ${s.joined} parcels matched` : ''}${s.truncated ? ' (truncated)' : ''}${s.zoned ? ` · zoning assigned to ${s.zoned}` : ''}`;
    items.push(`<div class="source ${s.ok ? '' : 'err'}">
      <div class="name">${escapeHtml(s.providerName || s.provider)}${roleLabel ? ` <span class="muted">(${roleLabel})</span>` : ''}</div>
      <div>${/^https?:\/\//i.test(String(s.url || '')) ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.source)}</a>` : escapeHtml(s.source)}</div>
      <div>${status}</div>
      ${mapRows.length ? `<div class="fmap">${mapRows.join(' · ')}</div>` : ''}
      ${s.ok && s.note && s.role !== 'primary' ? `<div class="fmap">${escapeHtml(s.note)}</div>` : ''}
      ${s.ok && !fm.owner && s.role === 'primary' ? '<div class="fmap">This layer does not publish taxpayer names; the legal owner from the latest deed is shown where available.</div>' : ''}
      ${s.ok && s.role === 'primary' && s.count > 0 && s.zoned === 0 && !fm.zoning ? '<div class="fmap">No zoning-district polygon covered these parcels.</div>' : ''}
      ${s.confidence && s.confidence !== 'confirmed' ? `<div class="fmap">Endpoint ${escapeHtml(s.confidence === 'likely' ? 'documented but not independently verified' : 'unverified; schema resolved at runtime')}.</div>` : ''}
    </div>`);
  }
  el.innerHTML = items.join('');
}

function reclassifyAll() {
  for (const rec of state.view.records.values()) classifyRecord(rec);
  for (const rec of state.study.records) classifyRecord(rec);
  state.table.setRecords(state.study.records, { unit: state.ring.unit });
  restyleAll();
  updateMcSummary();
}

function updateMcSummary() {
  const n = state.patterns.length;
  const hits = state.study.records.filter((r) => r.multicare).length;
  const viewHits = [...state.view.records.values()].filter((r) => r.multicare).length;
  $('#mc-summary').textContent = `${n} match patterns active · ${hits} matched in ring · ${viewHits} matched among loaded parcels`;
}

function updateDefaultTitles() {
  const rLabel = `${Number(state.ring.radius).toLocaleString()} ${UNIT_LABELS[state.ring.unit]}`;
  if (!state.settings.subtitle) $('#subtitle').placeholder = `Properties within ${rLabel}`;
  if (!state.settings.title) {
    const label = state.pin?.label ? state.pin.label.split(',').slice(0, 2).join(',').trim() : '';
    $('#title').placeholder = label ? `${label} | WA` : 'Parcel radius study';
  }
}

function currentTitles() {
  const rLabel = `${Number(state.ring.radius).toLocaleString()} ${UNIT_LABELS[state.ring.unit]}`;
  return {
    title: state.settings.title || $('#title').placeholder || 'Parcel radius study',
    subtitle: state.settings.subtitle || `Properties within ${rLabel}`,
  };
}

// ---------------------------------------------------------------------------
// URL hash (shareable state)
// ---------------------------------------------------------------------------
function writeHash() {
  if (!state.pin) return;
  const p = new URLSearchParams({ lat: state.pin.lat.toFixed(6), lon: state.pin.lon.toFixed(6), r: String(state.ring.radius), u: state.ring.unit });
  if (state.pin.label) p.set('q', state.pin.label.slice(0, 120));
  history.replaceState(null, '', `#${p.toString()}`);
}

function readHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return null;
  const p = new URLSearchParams(h);
  if (!p.has('lat') || !p.has('lon')) return null;
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const r = Number(p.get('r'));
  const u = p.get('u');
  if (Number.isFinite(r) && r > 0 && UNIT_LABELS[u]) {
    state.ring.unit = u;
    state.ring.radius = Math.min(r, Number(fromMeters(MAX_RING_RADIUS_M, u).toFixed(2)));
  }
  return { lat, lon, label: p.get('q') || '' };
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------
const SLIDER_RANGES = { yd: [25, 8800, 5], ft: [50, 26400, 10], m: [25, 8000, 5], mi: [0.05, 5, 0.05], km: [0.05, 8, 0.05] };

function syncRingControls({ skipRadiusInput = false } = {}) {
  const r = state.ring;
  if (!skipRadiusInput) $('#radius').value = r.radius;
  $('#unit').value = r.unit;
  const [min, max, step] = SLIDER_RANGES[r.unit] || SLIDER_RANGES.yd;
  const slider = $('#radius-slider');
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = Math.min(max, Math.max(min, r.radius));
  $('#ring-color').value = r.color;
  $('#ring-dash').value = r.dash;
  $('#ring-weight').value = r.weight;
  $('#ring-weight-val').textContent = r.weight;
  $('#ring-fill').checked = Boolean(r.fill);
  $('#ring-fill-color').value = r.fillColor;
  $('#ring-fill-opacity').value = r.fillOpacity;
  $('#ring-fill-opacity-val').textContent = Number(r.fillOpacity).toFixed(2);
}

function setDropMode(on) {
  state.dropMode = on;
  const btn = $('#btn-drop');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? 'Click the map to place the pin…' : 'Drop pin on map';
  state.map.getContainer().style.cursor = on ? 'crosshair' : '';
}

function wireControls() {
  // Sidebar toggle
  const layout = $('#layout');
  const applySidebar = () => {
    layout.classList.toggle('sidebar-collapsed', state.settings.sidebarCollapsed);
    $('#btn-sidebar').setAttribute('aria-expanded', state.settings.sidebarCollapsed ? 'false' : 'true');
    setTimeout(() => state.map.invalidateSize(), 50);
  };
  $('#btn-sidebar').addEventListener('click', () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    saveSettings();
    applySidebar();
  });
  if (window.innerWidth <= 900) state.settings.sidebarCollapsed = true;
  applySidebar();

  // Geocode
  $('#form-geocode').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#address').value.trim();
    if (!q) return;
    const list = $('#geocode-results');
    list.hidden = true;
    $('#btn-locate').disabled = true;
    $('#btn-locate').textContent = '…';
    try {
      const cands = await geocode(q);
      if (!cands.length) {
        toast('No match found. Try adding the city, or enter “lat, lon”.', { error: true });
        return;
      }
      if (cands.length === 1 || cands[0].source === 'coordinates') {
        await setPin({ lat: cands[0].lat, lon: cands[0].lon, label: cands[0].label });
        return;
      }
      list.innerHTML = cands.slice(0, 6).map((c, i) => `<li data-i="${i}">${escapeHtml(c.label)}<small>${escapeHtml(c.source)}</small></li>`).join('');
      list.hidden = false;
      list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
        const c = cands[Number(li.dataset.i)];
        list.hidden = true;
        setPin({ lat: c.lat, lon: c.lon, label: c.label });
      }));
    } catch (err) {
      toast(`Geocoding failed: ${err.message}`, { error: true, ms: 7000 });
    } finally {
      $('#btn-locate').disabled = false;
      $('#btn-locate').textContent = 'Locate';
    }
  });
  $('#btn-drop').addEventListener('click', () => setDropMode(!state.dropMode));
  $('#btn-clear').addEventListener('click', clearAll);
  $('#btn-fit').addEventListener('click', fitRing);
  $('#btn-share').addEventListener('click', async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied to clipboard.');
    } catch {
      toast(location.href, { ms: 8000 });
    }
  });

  // Ring
  syncRingControls();
  const onRadius = (v, unit, { fromInput = false } = {}) => {
    if (unit) state.ring.unit = unit;
    const n = Number(v);
    if (!(Number.isFinite(n) && n > 0)) {
      if (fromInput) return; // let the user keep typing ("0.", empty)
    } else state.ring.radius = n;
    const maxUnits = fromMeters(MAX_RING_RADIUS_M, state.ring.unit);
    if (state.ring.radius > maxUnits) {
      state.ring.radius = Number(maxUnits.toFixed(2));
      toast(`Radius capped at ${state.ring.radius} ${UNIT_LABELS[state.ring.unit]} to keep result sets manageable.`);
      $('#radius').value = state.ring.radius;
    }
    saveRing();
    // while typing, do not rewrite the number field the user is editing
    syncRingControls({ skipRadiusInput: fromInput });
    updateDefaultTitles();
    if (state.pin) scheduleStudy();
    renderLegend();
  };
  $('#radius').addEventListener('input', (e) => onRadius(e.target.value, null, { fromInput: true }));
  $('#radius').addEventListener('change', () => syncRingControls());
  $('#radius-slider').addEventListener('input', (e) => onRadius(e.target.value));
  $('#unit').addEventListener('change', (e) => {
    // convert the current radius into the new unit so the ring size does not jump
    const meters = radiusMeters();
    const nv = fromMeters(meters, e.target.value);
    onRadius(Number(nv.toFixed(nv < 10 ? 3 : 1)), e.target.value);
  });
  $$('.presets .chip').forEach((chip) => chip.addEventListener('click', () => onRadius(chip.dataset.radius, chip.dataset.unit)));
  const onStyle = () => {
    state.ring.color = $('#ring-color').value;
    state.ring.dash = $('#ring-dash').value;
    state.ring.weight = Number($('#ring-weight').value);
    state.ring.fill = $('#ring-fill').checked;
    state.ring.fillColor = $('#ring-fill-color').value;
    state.ring.fillOpacity = Number($('#ring-fill-opacity').value);
    $('#ring-weight-val').textContent = state.ring.weight;
    $('#ring-fill-opacity-val').textContent = state.ring.fillOpacity.toFixed(2);
    saveRing();
    if (state.ringLayer) state.ringLayer.setStyle(ringStyle());
    renderLegend();
  };
  for (const id of ['#ring-color', '#ring-dash', '#ring-weight', '#ring-fill', '#ring-fill-color', '#ring-fill-opacity']) $(id).addEventListener('input', onStyle);

  // Layers
  const bindToggle = (id, key, after) => {
    const el = $(id);
    el.checked = Boolean(state.settings[key]);
    el.addEventListener('change', () => {
      state.settings[key] = el.checked;
      saveSettings();
      after();
    });
  };
  bindToggle('#opt-parcels', 'showParcels', () => {
    if (!state.settings.showParcels) {
      clearViewParcels();
      setMapStatus('');
    } else fetchViewParcels();
  });
  bindToggle('#opt-labels', 'showLabels', renderLabels);
  bindToggle('#opt-shade', 'shadeMultiCare', restyleAll);
  bindToggle('#opt-occupied', 'showOccupied', () => { renderLocations(); restyleAll(); });
  bindToggle('#opt-ringonly', 'ringOnly', restyleAll);

  // MultiCare patterns
  const ta = $('#extra-patterns');
  ta.value = state.settings.extraPatterns || '';
  const applyPatterns = () => {
    state.patterns = [...DEFAULT_PATTERNS, ...parseUserPatterns(state.settings.extraPatterns)];
    reclassifyAll();
  };
  let patTimer = null;
  ta.addEventListener('input', () => {
    state.settings.extraPatterns = ta.value;
    saveSettings();
    clearTimeout(patTimer);
    patTimer = setTimeout(applyPatterns, 400);
  });
  state.patterns = [...DEFAULT_PATTERNS, ...parseUserPatterns(state.settings.extraPatterns)];

  // Exhibit titles
  $('#title').value = state.settings.title || '';
  $('#subtitle').value = state.settings.subtitle || '';
  $('#title').addEventListener('input', (e) => { state.settings.title = e.target.value; saveSettings(); });
  $('#subtitle').addEventListener('input', (e) => { state.settings.subtitle = e.target.value; saveSettings(); });

  // Results controls
  const bindCol = (id, key) => {
    const el = $(id);
    // columns added later default to the table's own default until the user toggles them
    el.checked = key in state.settings.cols ? Boolean(state.settings.cols[key]) : Boolean(state.table.optional[key]);
    state.table.optional[key] = el.checked;
    el.addEventListener('change', () => {
      state.settings.cols[key] = el.checked;
      state.table.optional[key] = el.checked;
      saveSettings();
      state.table.render();
    });
  };
  bindCol('#col-legal', 'legalOwner');
  bindCol('#col-parcel', 'parcelId');
  bindCol('#col-address', 'situs');
  bindCol('#col-zoning', 'zoning');
  bindCol('#col-sale', 'sale');
  bindCol('#col-distance', 'distance');
  $('#btn-renumber').addEventListener('click', () => {
    const order = state.table.orderedKeys();
    order.forEach((k, i) => {
      const rec = state.study.records.find((r) => r.key === k);
      if (rec) rec.id = i + 1;
    });
    state.table.sortKey = 'id';
    state.table.sortDir = 1;
    state.table.render();
    renderLabels();
  });
  $('#btn-results-toggle').addEventListener('click', () => {
    const res = $('#results');
    const collapsed = res.classList.toggle('collapsed');
    $('#btn-results-toggle').innerHTML = collapsed ? '&#9650;' : '&#9660;';
    $('#btn-results-toggle').setAttribute('aria-label', collapsed ? 'Expand table' : 'Collapse table');
    setTimeout(() => state.map.invalidateSize(), 50);
  });
  $('#btn-export').addEventListener('click', () => {
    const { title } = currentTitles();
    downloadText(`${slugify(title)}-${state.ring.radius}${state.ring.unit}-parcels.csv`, state.table.toCSV(), 'text/csv');
  });
  $('#btn-print').addEventListener('click', () => {
    const { title, subtitle } = currentTitles();
    const counties = state.study.counties.join(', ');
    const byRole = (roles) => [...new Set(state.study.statuses.filter((s) => s.ok && s.count !== 0 && roles.includes(s.role || 'primary')).map((s) => s.source))].join('; ');
    const sources = byRole(['primary', 'enrich', 'static']);
    const zoning = [...new Set(state.study.records.map((r) => r.zoningSource).filter((z) => z && z !== 'assessor'))].join('; ');
    // The printed table drops the footnote markers, so state their qualifications once.
    const recs = state.study.records;
    const notes = [];
    if (recs.some((r) => r.ownerSource === 'legal')) notes.push('Where the taxpayer name is withheld, the owner shown is the grantee on the most recent recorded deed.');
    if (recs.some((r) => r.value !== null && r.valueKind !== 'taxable')) notes.push('Values are total market or land plus improvement values where the assessor publishes no taxable value.');
    if (recs.some((r) => r.acresSource === 'gis')) notes.push('Some acreages are computed from the parcel polygon.');
    if (recs.some((r) => r.multicare?.deedDiffers)) notes.push('MultiCare shading follows the taxpayer of record; the latest deed for some shaded parcels names another party.');
    if (recs.some((r) => r.multicare?.inferred)) notes.push('Where the source withholds owner names, MultiCare ownership is inferred from a MultiCare business name on a tax-exempt parcel.');
    printExhibit({ map: state.map, title, subtitle, bounds: state.ringLayer?.getBounds(), footerLeft: `Parcel data: ${sources || 'n/a'}${counties ? ` (${counties} County)` : ''}.${zoning ? ` Zoning: ${zoning}.` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}` });
  });
  window.addEventListener('resize', () => state.map.invalidateSize());
}

// ---------------------------------------------------------------------------
// MultiCare campus locations (for "occupied" markers)
// ---------------------------------------------------------------------------
async function loadLocations() {
  try {
    const data = await loadData('multicare_locations');
    const cached = loadJSON('geocoded_locations', {});
    state.locations = (data.locations || []).map((l) => ({ ...l, ...(cached[l.address] || {}) }));
    renderLocations();
    // Geocode any campus without coordinates, sequentially (Nominatim policy: 1 request/second)
    for (const loc of state.locations) {
      if (loc.lat && loc.lon) continue;
      try {
        const cands = await geocode(`${loc.address}, ${loc.city}, WA`);
        const c = cands[0];
        if (c) {
          loc.lat = c.lat;
          loc.lon = c.lon;
          cached[loc.address] = { lat: c.lat, lon: c.lon };
          saveJSON('geocoded_locations', cached);
          renderLocations();
        }
      } catch {
        /* keep going */
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
    reclassifyAll();
  } catch (err) {
    console.warn('MultiCare locations unavailable', err);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  initMap();
  state.table = new ResultsTable($('#table-wrap'), {
    onHover: (key, on) => highlightParcel(key, on),
    onSelect: (key) => {
      const rec = recordByKey(key);
      if (!rec) return;
      const b = L.geoJSON(rec.geometry).getBounds();
      state.map.fitBounds(b, { maxZoom: 18, padding: [60, 60] });
      openPopup(key, rec.labelLngLat ? L.latLng(rec.labelLngLat[1], rec.labelLngLat[0]) : b.getCenter());
    },
  });
  wireControls();
  renderLegend();
  state.table.render();
  try {
    const counties = await loadData('wa_counties');
    // Opened from disk (standalone build): pre-built assessor extracts come from the site.
    if (location.protocol === 'file:') window.__STATIC_DATA_BASE = SITE_BASE;
    state.service = new ParcelService({ counties });
  } catch (err) {
    toast(`Failed to load county index: ${err.message}`, { error: true, ms: 8000 });
    return;
  }
  const fromHash = readHash();
  syncRingControls();
  updateDefaultTitles();
  updateMcSummary();
  if (fromHash) {
    state.map.setView([fromHash.lat, fromHash.lon], 16);
    await setPin(fromHash, { reverse: !fromHash.label });
  } else if (state.pin) {
    // a pin dropped while the county index was still loading
    await runStudy({ fit: true });
  } else {
    scheduleViewFetch();
  }
  loadLocations();
}

main().catch((err) => {
  console.error(err);
  toast(`Startup error: ${err.message}`, { error: true, ms: 10000 });
});

// Exposed for tests / debugging
window.__parcelApp = { state, runStudy, setPin, clearAll };
