// MultiCare affiliation detection from assessor owner / taxpayer names.
// Patterns are matched as substrings of a normalized (uppercase, alphanumeric + single
// spaces) owner name. Some patterns are restricted to counties to avoid false positives
// (e.g. "DEACONESS" only in Spokane, "VALLEY HOSPITAL" only in Spokane).

export const RELATIONSHIP_LABELS = {
  owned: 'MultiCare owned',
  affiliate: 'MultiCare affiliate',
  joint_venture: 'MultiCare joint venture',
  foundation: 'MultiCare foundation',
  historical_name: 'MultiCare (historical entity name)',
};

// Default pattern set. Editable in the UI; user additions are stored locally.
export const DEFAULT_PATTERNS = [
  { pattern: 'MULTICARE', entity: 'MultiCare Health System', relationship: 'owned' },
  { pattern: 'MULTI CARE', entity: 'MultiCare Health System', relationship: 'owned' },
  { pattern: 'MULTICARE HEALTH SYSTEM', entity: 'MultiCare Health System', relationship: 'owned' },
  { pattern: 'TACOMA GENERAL HOSP', entity: 'MultiCare Tacoma General Hospital', relationship: 'owned' },
  { pattern: 'TACOMA GENERAL ALLENMORE', entity: 'MultiCare Tacoma General Allenmore Hospital', relationship: 'owned' },
  { pattern: 'MARY BRIDGE', entity: 'MultiCare Mary Bridge Children’s Hospital', relationship: 'owned' },
  { pattern: 'ALLENMORE HOSP', entity: 'MultiCare Allenmore Hospital', relationship: 'owned' },
  // "MHS" is MultiCare's own abbreviation in facility registrations (e.g. "MHS Good Samaritan Hospital")
  { pattern: 'MHS GOOD SAMARITAN', entity: 'MultiCare Good Samaritan Hospital (Puyallup)', relationship: 'owned', counties: ['Pierce', 'King'] },
  { pattern: 'MHS TACOMA GENERAL', entity: 'MultiCare Tacoma General Hospital', relationship: 'owned', counties: ['Pierce', 'King'] },
  { pattern: 'MHS ALLENMORE', entity: 'MultiCare Allenmore Hospital', relationship: 'owned', counties: ['Pierce', 'King'] },
  { pattern: 'MHS MARY BRIDGE', entity: 'MultiCare Mary Bridge Children’s Hospital', relationship: 'owned', counties: ['Pierce', 'King'] },
  { pattern: 'GOOD SAMARITAN HOSP', entity: 'MultiCare Good Samaritan Hospital (Puyallup)', relationship: 'owned', counties: ['Pierce'] },
  { pattern: 'GOOD SAMARITAN COMMUNITY HEALTH', entity: 'MultiCare Good Samaritan (Puyallup; pre-2010 corporate name Good Samaritan Community Healthcare)', relationship: 'owned', counties: ['Pierce'] },
  { pattern: 'AUBURN REGIONAL MEDICAL', entity: 'MultiCare Auburn Medical Center', relationship: 'owned' },
  { pattern: 'AUBURN MEDICAL CENTER', entity: 'MultiCare Auburn Medical Center', relationship: 'owned', counties: ['King'] },
  { pattern: 'COVINGTON MEDICAL CENTER', entity: 'MultiCare Covington Medical Center', relationship: 'owned' },
  { pattern: 'DEACONESS', entity: 'MultiCare Deaconess Hospital (Spokane)', relationship: 'owned', counties: ['Spokane'] },
  { pattern: 'VALLEY HOSPITAL', entity: 'MultiCare Valley Hospital (Spokane Valley)', relationship: 'owned', counties: ['Spokane'] },
  { pattern: 'ROCKWOOD CLINIC', entity: 'MultiCare Rockwood Clinic', relationship: 'owned' },
  { pattern: 'ROCKWOOD HEALTH', entity: 'MultiCare Rockwood', relationship: 'owned', counties: ['Spokane'] },
  // "Inland Northwest Health Services" (INHS) is a separate, Providence-linked nonprofit, so the
  // regional brand "MultiCare Inland Northwest" is not matched on its own.
  { pattern: 'MULTICARE INLAND NORTHWEST', entity: 'MultiCare Inland Northwest', relationship: 'owned', counties: ['Spokane'] },
  { pattern: 'CAPITAL MEDICAL CENTER', entity: 'MultiCare Capital Medical Center (Olympia)', relationship: 'owned' },
  { pattern: 'YAKIMA VALLEY MEMORIAL', entity: 'MultiCare Yakima Memorial Hospital (Yakima Valley Memorial Hospital Association)', relationship: 'owned' },
  { pattern: 'VIRGINIA MASON MEMORIAL', entity: 'MultiCare Yakima Memorial (formerly Virginia Mason Memorial)', relationship: 'historical_name', counties: ['Yakima'] },
  { pattern: 'MEMORIAL HOSPITAL ASSOC', entity: 'Yakima Valley Memorial Hospital Association (MultiCare)', relationship: 'owned', counties: ['Yakima'] },
  { pattern: 'INDIGO URGENT CARE', entity: 'MultiCare Indigo Urgent Care', relationship: 'owned' },
  { pattern: 'INDIGO HEALTH', entity: 'MultiCare Indigo Health', relationship: 'owned' },
  { pattern: 'PULSE HEART', entity: 'Pulse Heart Institute (MultiCare joint venture)', relationship: 'joint_venture' },
  { pattern: 'NAVOS', entity: 'Navos (MultiCare Behavioral Health)', relationship: 'affiliate', counties: ['King'] },
  { pattern: 'GREATER LAKES MENTAL', entity: 'Greater Lakes Mental Healthcare (MultiCare Behavioral Health)', relationship: 'affiliate' },
  { pattern: 'WELLFOUND BEHAVIORAL', entity: 'Wellfound Behavioral Health Hospital (MultiCare / Virginia Mason Franciscan joint venture)', relationship: 'joint_venture' },
  { pattern: 'MULTICARE FOUNDATION', entity: 'MultiCare Health Foundation', relationship: 'foundation' },
  { pattern: 'MULTICARE HEALTH FOUNDATION', entity: 'MultiCare Health Foundation', relationship: 'foundation' },
  { pattern: 'MARY BRIDGE CHILDRENS FOUNDATION', entity: 'Mary Bridge Children’s Foundation', relationship: 'foundation' },
];

// Names that look related but are not MultiCare. Matching one of these vetoes a weaker match.
export const FALSE_POSITIVES = [
  'CARE NET', // Care Net pregnancy centers (e.g. "CARE NET/Allenmore Children & Youth")
  'VALLEY MEDICAL CENTER', // Renton, UW Medicine
  'PUBLIC HOSPITAL DISTRICT', // e.g. Public Hospital District No. 1 of King County (Valley Medical Center)
  'GOOD SAMARITAN SOCIETY', // Evangelical Lutheran Good Samaritan Society senior living
  'INLAND NORTHWEST HEALTH SERVICES', // INHS: separate nonprofit (St. Luke's Rehabilitation), Providence-linked
];

export function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsToken(hay, needle) {
  // whole-word-ish containment on normalized strings
  return (` ${hay} `).includes(` ${needle} `) || hay.includes(needle);
}

/**
 * Classifies an owner name.
 * @returns {null | {relationship: string, entity: string, pattern: string, label: string}}
 */
export function classifyOwner(ownerName, { patterns = DEFAULT_PATTERNS, county = null, falsePositives = FALSE_POSITIVES } = {}) {
  const name = normalizeName(ownerName);
  if (!name) return null;
  for (const fp of falsePositives) {
    const fpn = normalizeName(fp);
    // whole-word containment so "HEALTHCARE NETWORK" is not vetoed by "CARE NET"
    if (fpn && (` ${name} `).includes(` ${fpn} `) && !name.includes('MULTICARE') && !name.includes('MULTI CARE')) return null;
  }
  let best = null;
  for (const p of patterns) {
    const pn = normalizeName(p.pattern);
    if (!pn) continue;
    if (p.counties && p.counties.length && county && !p.counties.map(normalizeName).includes(normalizeName(county))) continue;
    if (p.counties && p.counties.length && !county) {
      // county unknown: still allow but only for distinctive multi-word patterns
      if (pn.split(' ').length < 2) continue;
    }
    if (containsToken(name, pn)) {
      // Most specific (longest) pattern wins; relationship rank breaks ties.
      const rank = RANK[p.relationship] ?? 9;
      if (!best || pn.length > best.patternLen || (pn.length === best.patternLen && rank < best.rank)) {
        best = { rank, patternLen: pn.length, relationship: p.relationship, entity: p.entity, pattern: p.pattern, label: RELATIONSHIP_LABELS[p.relationship] || p.relationship };
      }
    }
  }
  if (!best) return null;
  const { rank, patternLen, ...out } = best;
  return out;
}

const RANK = { owned: 0, foundation: 1, historical_name: 2, joint_venture: 3, affiliate: 4 };

/** Parses user-entered extra patterns: one per line, optional "| relationship" suffix. */
export function parseUserPatterns(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pat, rel] = line.split('|').map((s) => s.trim());
    if (!pat) continue;
    const relationship = RELATIONSHIP_LABELS[rel] ? rel : 'owned';
    out.push({ pattern: pat, entity: `Custom: ${pat}`, relationship, custom: true });
  }
  return out;
}
