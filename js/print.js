// Print exhibit: reflows the page into a tabloid-landscape layout (header bar, map,
// numbered table, legend, disclaimer), waits for basemap tiles, then opens the print dialog.
import { DISCLAIMER } from './config.js';

function waitForTiles(map, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let pending = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.eachLayer((l) => {
      if (l instanceof L.TileLayer && l.isLoading && l.isLoading()) {
        pending += 1;
        l.once('load', () => {
          pending -= 1;
          if (pending <= 0) setTimeout(finish, 150);
        });
      }
    });
    if (pending === 0) setTimeout(finish, 200);
    setTimeout(finish, timeoutMs);
  });
}

const ROWS_PER_COLUMN = 52;

/**
 * Shrinks the header type until the title and subtitle fit the header band. Both wrap, so
 * this only comes into play for unusually long entries; nothing the user typed is dropped
 * unless it cannot be made to fit at the smallest size.
 */
function fitHeaderText() {
  const header = document.querySelector('.exhibit-header');
  const title = document.getElementById('exhibit-title');
  const subtitle = document.getElementById('exhibit-subtitle');
  if (!header) return;
  const overflows = () => header.scrollHeight > header.clientHeight + 1;
  // the subtitle is the secondary line, so it gives way first
  for (const [el, from, to] of [[subtitle, 16, 9], [title, 28, 12]]) {
    if (!el) continue;
    for (let size = from; size >= to && overflows(); size -= 1) el.style.fontSize = `${size}px`;
  }
}

function clearHeaderText() {
  for (const id of ['exhibit-title', 'exhibit-subtitle']) {
    const el = document.getElementById(id);
    if (el) el.style.fontSize = '';
  }
}

/**
 * Clones the results table into one or more compact side-by-side column blocks so that
 * long parcel lists fit the exhibit page (the reference exhibit lists ~60 parcels in one
 * narrow column). Only the core exhibit columns are kept: ID, owner, value, acres, use,
 * zoning.
 */
function buildPrintTable(table) {
  if (!table) return null;
  const rows = [...table.querySelectorAll('tbody tr')];
  if (!rows.length) return null;
  const headers = [...table.querySelectorAll('thead th')];
  const keep = headers.map((th) => ['id', 'owner', 'value', 'acres', 'use', 'zoning'].includes(th.dataset.key));
  const cols = Math.max(1, Math.ceil(rows.length / ROWS_PER_COLUMN));
  const perCol = Math.ceil(rows.length / cols);
  const wrap = document.createElement('div');
  wrap.className = 'print-table';
  wrap.style.setProperty('--cols', String(cols));
  for (let c = 0; c < cols; c++) {
    const t = document.createElement('table');
    t.className = 'parcels print';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    headers.forEach((th, i) => {
      if (!keep[i]) return;
      const h = document.createElement('th');
      h.className = th.className;
      h.textContent = th.textContent.replace(/[▲▼]/g, '').trim();
      hr.appendChild(h);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of rows.slice(c * perCol, (c + 1) * perCol)) {
      const r = document.createElement('tr');
      r.className = row.className;
      [...row.children].forEach((td, i) => {
        if (!keep[i]) return;
        const cell = td.cloneNode(true);
        r.appendChild(cell);
      });
      tbody.appendChild(r);
    }
    t.appendChild(tbody);
    wrap.appendChild(t);
  }
  const foot = table.querySelector('tfoot');
  if (foot) {
    const totals = document.createElement('div');
    totals.className = 'print-totals';
    const cells = [...foot.querySelectorAll('td')];
    const byKey = Object.fromEntries(headers.map((th, i) => [th.dataset.key, cells[i]?.textContent.trim() || '']));
    totals.textContent = `${byKey.id} parcels · ${byKey.acres} acres · ${byKey.value} total value`;
    wrap.appendChild(totals);
  }
  return wrap;
}

/**
 * @param {{map: L.Map, title: string, subtitle: string, bounds?: L.LatLngBounds, footerLeft?: string}} opts
 */
export async function printExhibit({ map, title, subtitle, bounds, footerLeft = '' }) {
  const body = document.body;
  if (body.classList.contains('print-mode')) return;
  const prevCenter = map.getCenter();
  const prevZoom = map.getZoom();
  document.getElementById('exhibit-title').textContent = title || 'Parcel radius study';
  document.getElementById('exhibit-subtitle').textContent = subtitle || '';
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  // The footer's logo marks are static markup in index.html; only the disclaimer text changes.
  document.getElementById('exhibit-disclaimer').textContent = `${DISCLAIMER} ${footerLeft} Generated ${stamp}.`;

  const results = document.getElementById('results');
  const wasCollapsed = results.classList.contains('collapsed');
  results.classList.remove('collapsed');
  const printTable = buildPrintTable(document.querySelector('#table-wrap table.parcels'));
  if (printTable) results.appendChild(printTable);
  body.classList.add('print-mode');

  const restore = () => {
    body.classList.remove('print-mode');
    clearHeaderText();
    printTable?.remove();
    if (wasCollapsed) results.classList.add('collapsed');
    map.invalidateSize({ animate: false });
    map.setView(prevCenter, prevZoom, { animate: false });
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  clearHeaderText();
  fitHeaderText();
  map.invalidateSize({ animate: false });
  if (bounds) map.fitBounds(bounds, { padding: [30, 30], animate: false });
  await waitForTiles(map);
  window.print();
  // Browsers without afterprint support (or when the dialog is cancelled synchronously)
  setTimeout(() => {
    if (body.classList.contains('print-mode')) restore();
  }, 1500);
}
