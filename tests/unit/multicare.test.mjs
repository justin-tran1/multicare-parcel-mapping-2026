import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOwner, normalizeName, parseUserPatterns, DEFAULT_PATTERNS } from '../../js/multicare.js';

test('normalizes punctuation and case', () => {
  assert.equal(normalizeName(' MultiCare  Health-System, Inc. '), 'MULTICARE HEALTH SYSTEM INC');
  assert.equal(normalizeName('Mary Bridge Children’s'), 'MARY BRIDGE CHILDREN S');
});

test('matches MultiCare owner variants', () => {
  assert.equal(classifyOwner('MULTICARE HEALTH SYSTEMS').relationship, 'owned');
  assert.equal(classifyOwner('Multi-Care Health System').relationship, 'owned');
  assert.equal(classifyOwner('MULTI CARE MEDICAL CENTER').relationship, 'owned');
  assert.equal(classifyOwner('TACOMA GENERAL HOSPITAL').relationship, 'owned');
  assert.equal(classifyOwner('MARY BRIDGE CHILDRENS HOSPITAL & HEALTH CENTER').relationship, 'owned');
});

test('joint ventures and affiliates are distinguished from owned', () => {
  assert.equal(classifyOwner('PULSE HEART INSTITUTE LLC').relationship, 'joint_venture');
  assert.equal(classifyOwner('GREATER LAKES MENTAL HEALTHCARE').relationship, 'affiliate');
  assert.equal(classifyOwner('MULTICARE HEALTH FOUNDATION').relationship, 'foundation');
});

test('county-restricted patterns only fire in their county', () => {
  assert.equal(classifyOwner('DEACONESS MEDICAL CENTER', { county: 'Spokane' })?.relationship, 'owned');
  assert.equal(classifyOwner('DEACONESS MEDICAL CENTER', { county: 'King' }), null);
  assert.equal(classifyOwner('DEACONESS MEDICAL CENTER'), null, 'single-word county-restricted pattern needs a county');
  assert.equal(classifyOwner('VALLEY HOSPITAL & MEDICAL CENTER', { county: 'Spokane' })?.relationship, 'owned');
  assert.equal(classifyOwner('VALLEY HOSPITAL', { county: 'Pierce' }), null);
});

test('known false positives do not match', () => {
  assert.equal(classifyOwner('CARE NET/Allenmore Children & Youth'), null);
  assert.equal(classifyOwner('VALLEY MEDICAL CENTER'), null);
  assert.equal(classifyOwner('Healthcare Realty'), null);
  assert.equal(classifyOwner('Ventas REIT'), null);
  assert.equal(classifyOwner(''), null);
  assert.equal(classifyOwner(null), null);
});

test('user patterns parse and extend defaults', () => {
  const extra = parseUserPatterns('# comment\nHEALTHCARE REALTY | affiliate\nVENTAS\n\n');
  assert.equal(extra.length, 2);
  assert.equal(extra[0].relationship, 'affiliate');
  assert.equal(extra[1].relationship, 'owned');
  const res = classifyOwner('Healthcare Realty', { patterns: [...DEFAULT_PATTERNS, ...extra] });
  assert.equal(res.relationship, 'affiliate');
});
