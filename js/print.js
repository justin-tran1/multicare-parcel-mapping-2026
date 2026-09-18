// Print exhibit: reflows the page into a tabloid-landscape layout (header bar, map,
// numbered table, legend, disclaimer), waits for basemap tiles, then opens the print dialog.
import { DISCLAIMER } from './config.js';
import { escapeHtml } from './format.js';

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
  document.getElementById('exhibit-footer').innerHTML =
    `<div class="disclaimer">${escapeHtml(DISCLAIMER)} ${escapeHtml(footerLeft)} Generated ${escapeHtml(stamp)}.</div><div class="cbre">CBRE</div>`;

  const results = document.getElementById('results');
  const wasCollapsed = results.classList.contains('collapsed');
  results.classList.remove('collapsed');
  body.classList.add('print-mode');

  const restore = () => {
    body.classList.remove('print-mode');
    if (wasCollapsed) results.classList.add('collapsed');
    map.invalidateSize({ animate: false });
    map.setView(prevCenter, prevZoom, { animate: false });
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  map.invalidateSize({ animate: false });
  if (bounds) map.fitBounds(bounds, { padding: [30, 30], animate: false });
  await waitForTiles(map);
  window.print();
  // Browsers without afterprint support (or when the dialog is cancelled synchronously)
  setTimeout(() => {
    if (body.classList.contains('print-mode')) restore();
  }, 1500);
}
