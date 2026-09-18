// Results table: sortable columns, totals, CSV export, hover/click sync with the map.
import { escapeHtml, formatCurrency, formatAcres, toCSV } from './format.js';
import { formatDistance } from './geometry.js';

const num = (a, b) => (a ?? -Infinity) - (b ?? -Infinity);
const str = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });

export class ResultsTable {
  constructor(container, { onHover, onSelect } = {}) {
    this.el = container;
    this.onHover = onHover;
    this.onSelect = onSelect;
    this.records = [];
    this.sortKey = 'id';
    this.sortDir = 1;
    this.optional = { parcelId: false, situs: false, distance: false };
    this.unit = 'yd';
    this.el.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (th) {
        const k = th.dataset.key;
        if (this.sortKey === k) this.sortDir *= -1;
        else {
          this.sortKey = k;
          this.sortDir = k === 'owner' || k === 'use' || k === 'situs' ? 1 : k === 'id' ? 1 : -1;
        }
        this.render();
        return;
      }
      const tr = e.target.closest('tr[data-key]');
      if (tr && this.onSelect) this.onSelect(tr.dataset.key);
    });
    this.el.addEventListener('mouseover', (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (tr && this.onHover) this.onHover(tr.dataset.key, true);
    });
    this.el.addEventListener('mouseout', (e) => {
      const tr = e.target.closest('tr[data-key]');
      if (tr && this.onHover) this.onHover(tr.dataset.key, false);
    });
  }

  columns() {
    const cols = [
      { key: 'id', label: 'ID', cls: 'id', value: (r) => r.id, html: (r) => String(r.id), sort: (a, b) => num(a.id, b.id) },
      { key: 'owner', label: 'True Owner', value: (r) => r.owner || '', html: (r) => (r.owner ? escapeHtml(r.owner) : '<span class="muted">not published</span>') + (r.ownerNote ? '<span class="sup" title="' + escapeHtml(r.ownerNote) + '">&#8225;</span>' : ''), sort: (a, b) => str(a.owner, b.owner) },
    ];
    if (this.optional.parcelId) cols.push({ key: 'parcelId', label: 'Parcel #', value: (r) => r.parcelId, html: (r) => escapeHtml(r.parcelId), sort: (a, b) => str(a.parcelId, b.parcelId) });
    if (this.optional.situs) cols.push({ key: 'situs', label: 'Site Address', value: (r) => r.situs, html: (r) => escapeHtml(r.situs || ''), sort: (a, b) => str(a.situs, b.situs) });
    cols.push(
      { key: 'value', label: 'Taxable Value', cls: 'num', value: (r) => (r.value ?? ''), html: (r) => formatCurrency(r.value) + (r.value !== null && r.valueKind !== 'taxable' ? '<span class="sup" title="' + escapeHtml(valueNote(r)) + '">*</span>' : ''), sort: (a, b) => num(a.value, b.value) },
      { key: 'acres', label: 'Land AC', cls: 'num', value: (r) => (r.acres !== null && r.acres !== undefined ? Number(r.acres.toFixed(3)) : ''), html: (r) => formatAcres(r.acres) + (r.acresSource === 'gis' ? '<span class="sup" title="Computed from parcel geometry">&dagger;</span>' : ''), sort: (a, b) => num(a.acres, b.acres) },
      { key: 'use', label: 'Use', value: (r) => r.useText || '', html: (r) => escapeHtml(r.useText || '') || '<span class="muted">n/a</span>', sort: (a, b) => str(a.useText, b.useText) },
    );
    if (this.optional.distance) cols.push({ key: 'distance', label: 'Distance', cls: 'num', value: (r) => (r.distanceM !== null ? Number(r.distanceM.toFixed(1)) : ''), html: (r) => (r.distanceM === 0 ? 'contains pin' : formatDistance(r.distanceM, this.unit)), sort: (a, b) => num(a.distanceM, b.distanceM) });
    return cols;
  }

  setRecords(records, { unit } = {}) {
    this.records = records;
    if (unit) this.unit = unit;
    this.render();
  }

  sorted() {
    const cols = this.columns();
    const col = cols.find((c) => c.key === this.sortKey) || cols[0];
    return [...this.records].sort((a, b) => this.sortDir * col.sort(a, b) || num(a.id, b.id));
  }

  render() {
    if (!this.records.length) {
      this.el.innerHTML = '<div class="empty">No parcels listed yet. Drop a pin or search an address to run a radius study.</div>';
      return;
    }
    const cols = this.columns();
    const rows = this.sorted();
    const head = cols.map((c) => `<th data-key="${c.key}" class="${c.cls || ''}">${escapeHtml(c.label)}${this.sortKey === c.key ? `<span class="arrow">${this.sortDir > 0 ? '&#9650;' : '&#9660;'}</span>` : ''}</th>`).join('');
    const body = rows.map((r) => {
      const cls = [rowClass(r), r.occupied ? 'mc-occupied' : ''].filter(Boolean).join(' ');
      return `<tr data-key="${escapeHtml(r.key)}" class="${cls}">${cols.map((c) => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`;
    }).join('');
    const totalAcres = rows.reduce((s, r) => s + (r.acres || 0), 0);
    const totalValue = rows.reduce((s, r) => s + (r.value || 0), 0);
    const foot = cols.map((c) => {
      if (c.key === 'id') return `<td class="id">${rows.length}</td>`;
      if (c.key === 'owner') return '<td>Total</td>';
      if (c.key === 'value') return `<td class="num">${formatCurrency(totalValue)}</td>`;
      if (c.key === 'acres') return `<td class="num">${formatAcres(totalAcres)}</td>`;
      return '<td></td>';
    }).join('');
    this.el.innerHTML = `<table class="parcels"><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table>`;
  }

  highlight(key, on) {
    const tr = this.el.querySelector(`tr[data-key="${cssEscape(key)}"]`);
    if (!tr) return;
    tr.classList.toggle('hl', on);
    if (on) tr.scrollIntoView({ block: 'nearest' });
  }

  /** Keys in the current display order (for renumbering). */
  orderedKeys() {
    return this.sorted().map((r) => r.key);
  }

  toCSV() {
    const cols = [
      { label: 'ID', value: (r) => r.id },
      { label: 'Owner', value: (r) => r.owner },
      { label: 'Owner note', value: (r) => r.ownerNote },
      { label: 'Parcel #', value: (r) => r.parcelId },
      { label: 'Site address', value: (r) => r.situs },
      { label: 'City', value: (r) => r.city },
      { label: 'County', value: (r) => r.county },
      { label: 'Value', value: (r) => (r.value ?? '') },
      { label: 'Value type', value: (r) => valueNote(r) },
      { label: 'Taxable value', value: (r) => (r.taxableValue ?? '') },
      { label: 'Land value', value: (r) => (r.landValue ?? '') },
      { label: 'Improvement value', value: (r) => (r.improvementValue ?? '') },
      { label: 'Total market value', value: (r) => (r.totalValue ?? '') },
      { label: 'Land acres', value: (r) => (r.acres !== null && r.acres !== undefined ? Number(r.acres.toFixed(4)) : '') },
      { label: 'Acres source', value: (r) => r.acresSource },
      { label: 'Use', value: (r) => r.useText },
      { label: 'Use code', value: (r) => r.useCode },
      { label: 'Distance (m)', value: (r) => (r.distanceM !== null ? Number(r.distanceM.toFixed(2)) : '') },
      { label: 'MultiCare', value: (r) => (r.multicare ? r.multicare.label : '') },
      { label: 'MultiCare entity', value: (r) => (r.multicare ? r.multicare.entity : '') },
      { label: 'MultiCare occupied', value: (r) => (r.occupied ? 'yes' : '') },
      { label: 'Assessor link', value: (r) => r.link },
      { label: 'Data source', value: (r) => r.sourceName },
    ];
    return toCSV(this.sorted(), cols);
  }
}

export function rowClass(r) {
  if (!r.multicare) return '';
  return ['owned', 'foundation', 'historical_name'].includes(r.multicare.relationship) ? 'mc-owned' : 'mc-affiliate';
}

export function valueNote(r) {
  switch (r.valueKind) {
    case 'taxable': return 'Taxable value (assessor)';
    case 'total': return 'Total market value (taxable value not published by this source)';
    case 'land+impr': return 'Land + improvement value (taxable value not published by this source)';
    default: return 'Not published';
  }
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}
