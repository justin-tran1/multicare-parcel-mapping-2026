// Display / export formatting helpers.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCurrency(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatAcres(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 100) return n.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function formatInt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

export function titleCaseOwner(s) {
  // Assessor names are typically upper case; keep as published (matches the reference exhibit).
  return String(s ?? '').trim();
}

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Assessor strings are free text typed by filers: neutralise spreadsheet formula triggers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.csv ? c.csv(r) : c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'parcels';
}
