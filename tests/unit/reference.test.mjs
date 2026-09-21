// Owner names from the CBRE "MultiCare Allenmore Hospital | Tacoma, WA - Properties within
// 250 yards" reference exhibit (63 parcels). The classifier must flag exactly the MultiCare
// rows (31, 32) as owned and Pulse Heart Institute (16) as a joint venture, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyOwner } from '../../js/multicare.js';

const reference = JSON.parse(await readFile(new URL('../../data/reference_allenmore.json', import.meta.url), 'utf8'));
const REFERENCE_OWNERS = reference.owners;

test('reference exhibit owners: only MultiCare rows and Pulse Heart are flagged', () => {
  assert.equal(REFERENCE_OWNERS.length, 61); // the exhibit table lists IDs 1-60 and 63
  const flagged = REFERENCE_OWNERS.map((o, i) => ({ id: i + 1, owner: o, mc: classifyOwner(o, { county: 'Pierce' }) })).filter((r) => r.mc);
  assert.deepEqual(
    flagged.map((r) => [r.id, r.owner, r.mc.relationship]),
    [
      [16, 'Pulse Heart Institute', 'joint_venture'],
      [31, 'MULTICARE HEALTH SYSTEMS', 'owned'],
      [32, 'MULTICARE HEALTH SYSTEMS', 'owned'],
    ],
  );
  assert.deepEqual(reference.multicare, { owned: [31, 32], joint_venture: [16] });
});

test('deed grantee and business names classify like taxpayer names', () => {
  assert.equal(classifyOwner('MULTICARE HEALTH SYSTEM', { county: 'Pierce' })?.relationship, 'owned');
  assert.equal(classifyOwner('MHS GOOD SAMARITAN HOSPITAL', { county: 'Pierce' })?.entity, 'MultiCare Good Samaritan Hospital (Puyallup)');
  assert.equal(classifyOwner('TACOMA GENERAL ALLENMORE HOSPITAL', { county: 'Pierce' })?.relationship, 'owned');
  assert.equal(classifyOwner('GOOD SAMARITAN COMMUNITY HEALTHCARE', { county: 'Pierce' })?.relationship, 'owned');
  // separate nonprofits and districts are not MultiCare
  assert.equal(classifyOwner('INLAND NORTHWEST HEALTH SERVICES', { county: 'Spokane' }), null);
  assert.equal(classifyOwner('PUBLIC HOSPITAL DISTRICT NO 1 OF KING COUNTY', { county: 'King' }), null);
  assert.equal(classifyOwner('MULTICARE INLAND NORTHWEST', { county: 'Spokane' })?.relationship, 'owned');
});
