// Owner names from the CBRE "MultiCare Allenmore Hospital | Tacoma, WA - Properties within
// 250 yards" reference exhibit (63 parcels). The classifier must flag exactly the MultiCare
// rows (31, 32) as owned and Pulse Heart Institute (16) as a joint venture, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOwner } from '../../js/multicare.js';

const REFERENCE_OWNERS = [
  'Healthcare Realty', 'Healthcare Realty', 'Ventas REIT', 'NATIONWIDE HEALTH PROPERTIES INC', 'Ventas REIT', 'Healthcare Realty',
  'Donald Hearon DDS', 'Ventas REIT', 'D Reed Kelley', 'VFW', 'Reeder Management Inc', 'Vincent Kokich & Douglas Knight,DDS',
  'John Fuchs', 'Bank of America', 'Tacoma Elks Lodge # 174', 'Pulse Heart Institute', 'Thomas & Kristi Lizotte',
  'Ground lease (Columbia Bank)', 'Healthcare Realty', 'Healthcare Realty', 'Wal-Mart', 'Oliphant Real Estate Services',
  'Oliphant Real Estate Services', 'Mercedes G McGee', 'Oliphant Real Estate Services', 'Oliphant Real Estate Services',
  'Oliphant Real Estate Services', 'Oliphant Real Estate Services', 'Oliphant Real Estate Services',
  'CARE NET/Allenmore Children & Youth', 'MULTICARE HEALTH SYSTEMS', 'MULTICARE HEALTH SYSTEMS', 'Life Center Church & School',
  'STEVEN PAIGE', 'Thomas G Taylor Jr', 'SCHERBARTH KENNETH C J', 'JAISIMHA IYENGAR', 'AAA Auto Club', 'JAISIMHA IYENGAR', 'Key Bank',
  'GLORIA DEI LUTHERAN CHURCH', 'Jianjun Liu, Jingru Guan et al', 'DUGAN JON', 'LEONARD ELIZABETH & FRANTZ TOBY',
  'MOSS JOHN & BETH L & HEATH GREGORY/ROBBI', 'PETERSON LOUISE R', 'FICHTNER EMILY & KURT', 'WILLIAMS ERIC N & ALLISON M',
  'HANSEN STEPHEN R & CHRISTINE M', 'MONTGOMERY JUDITH M TTEE', 'CHADDERDON JENNIFER M', 'Home Partners of America',
  'WHITELEY J V & WHITELEY-MEDIERAS SUSAN', 'DIX MIRIAM M', 'VAUGHN ERIC D', 'PHILLIP RAMONA', 'PARKER LORILYNN & AARON F',
  'COURNOYER RENE', 'LEWIS TROY', 'FEDERICO MARIA', 'Everlast Family & Cosmetic Dentistry',
];

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
});
