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

/** Placeholder for a field the source does not carry for this parcel. */
export const NOT_AVAILABLE = 'N/A';

// Address words kept in capitals: directionals and bounds, state and route codes, military
// installations, roman numerals, and the "XXX" house-number prefix Pierce County uses for
// GIS-estimated situs addresses.
const ADDRESS_KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NB', 'SB', 'EB', 'WB', 'WA', 'US', 'SR', 'PO', 'JBLM', 'AFB', 'XXX', 'II', 'III', 'IV']);
// Place names whose official spelling has an internal capital.
const ADDRESS_SPELLINGS = { SEATAC: 'SeaTac', DUPONT: 'DuPont' };
const ORDINAL_SUFFIX = /^(ST|ND|RD|TH)$/i;

/**
 * Assessor rolls publish situs addresses in capitals ("1901 S UNION AVE"); the table shows
 * them cased like a mailing label ("1901 S Union Ave"). Numbers, punctuation and single
 * letters (unit "200A", "Apt B") are kept as published; ordinal suffixes are lowered
 * ("112TH" -> "112th"); directionals and the state code stay upper case; "O'BRIEN",
 * "KING'S", "MCKINLEY" and "SEATAC" become O'Brien, King's, McKinley and SeaTac.
 */
export function formatAddress(s) {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.split(' ').map(caseAddressWord).join(' ');
}

// Works on runs of letters, digits and other characters so that designators glued to
// numbers or punctuation are cased too: "STE#200A" -> Ste, #, 200, A; "O'BRIEN" -> O, ', BRIEN.
function caseAddressWord(word) {
  const runs = word.match(/\p{L}+|\d+|[^\p{L}\d]+/gu) || [];
  return runs
    .map((run, i) => {
      if (!/\p{L}/u.test(run)) return run;
      const upper = run.toUpperCase();
      const prev = runs[i - 1] ?? '';
      if (/^\d+$/.test(prev) && ORDINAL_SUFFIX.test(run)) return run.toLowerCase();
      if (ADDRESS_SPELLINGS[upper]) return ADDRESS_SPELLINGS[upper];
      if ([...run].length === 1) {
        // a lone S after an apostrophe inside a word is a possessive (KING'S), not an initial (O'BRIEN)
        const possessive = upper === 'S' && /^['’]$/.test(prev) && i >= 2 && /\p{L}/u.test(runs[i - 2]);
        return possessive ? 's' : upper;
      }
      if (ADDRESS_KEEP_UPPER.has(upper)) return upper;
      const chars = [...run.toLowerCase()];
      chars[0] = chars[0].toUpperCase();
      if (chars[0] === 'M' && chars[1] === 'c' && chars.length > 2) chars[2] = chars[2].toUpperCase(); // McKinley
      return chars.join('');
    })
    .join('');
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
