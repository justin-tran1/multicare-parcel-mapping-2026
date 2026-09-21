import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCSV } from '../../js/format.js';

test('CSV cells neutralise spreadsheet formula triggers in assessor strings', () => {
  assert.equal(csvCell('=HYPERLINK("http://evil","click")'), '"\'=HYPERLINK(""http://evil"",""click"")"');
  assert.equal(csvCell('@SUM(1+1)'), '"\'@SUM(1+1)"');
  assert.equal(csvCell("=cmd|' /C calc'!A0"), '"\'=cmd|\' /C calc\'!A0"');
  assert.equal(csvCell('+1 (253) 555-0100'), '"\'+1 (253) 555-0100"');
  // negative numbers and ordinary names are untouched
  assert.equal(csvCell(-1250), '-1250');
  assert.equal(csvCell('-3.5'), '-3.5');
  assert.equal(csvCell('MULTICARE HEALTH SYSTEM'), 'MULTICARE HEALTH SYSTEM');
  assert.equal(csvCell("O'BRIEN PATRICK"), '"O\'BRIEN PATRICK"');
  assert.equal(csvCell('SMITH, JOHN'), '"SMITH, JOHN"');
  assert.equal(csvCell(null), '');
});

test('toCSV writes a header and one row per record', () => {
  const csv = toCSV([{ a: 1, b: 'x' }], [{ label: 'A', value: (r) => r.a }, { label: 'B', value: (r) => r.b }]);
  assert.equal(csv, 'A,B\r\n1,x');
});
