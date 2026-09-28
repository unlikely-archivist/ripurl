// Regression check for lib/liveness.ts against real domains (live network).
// The first block are the pilot's mistakes — they must never read as dead.
// Real sites change; if one flips, confirm by hand before editing the case.
import { checkDomainToday, isDead } from "../lib/liveness.ts";

const cases: [domain: string, company: string, expectDead: boolean][] = [
  ["cranberries.com", "The Cranberries", false],
  ["oracle.com", "JD Edwards", false],
  ["saban.com", "Saban Entertainment", false],
  ["opencontent.org", "Open Content Project", false],
  ["microprose.com", "MicroProse", false],
  ["pets.com", "Pets.com", true],
  ["imeem.com", "imeem", true],
  ["zune.net", "Zune Social", true],
  ["musicblvd.com", "Music Boulevard", true],
  ["flooz.com", "Flooz.com", true],
  ["acclaim.com", "Acclaim Entertainment", true],
  ["boo.com", "Boo.com", true],
];

let failures = 0;
const lines = await Promise.all(cases.map(async ([d, c, expectDead]) => {
  const t = await checkDomainToday(d, c);
  const ok = isDead(t) === expectDead;
  if (!ok) failures++;
  return `${ok ? "ok  " : "FAIL"} ${d.padEnd(16)} ${t.verdict.padEnd(12)} ${t.status ?? ""} ${t.finalDomain ?? ""} ${t.detail ?? ""}`;
}));
console.log(lines.join("\n"));
if (failures) throw new Error(`${failures} liveness regression(s)`);
