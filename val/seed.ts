// One-time setup: create tables and seed the used-domain exclusion list from
// the local repo's .tmp/used_domains.json (reconciled list, PROJECT_SPEC §9).
// Safe to re-run — everything is idempotent.
import { initTables, seedUsedDomains, usedDomains } from "./lib/state.ts";

const ALREADY_USED = [
  "allianceatlantiscinemas.com",
  "blender.com",
  "etoys.com",
  "friendster.com",
  "imeem.com",
  "kozmo.com",
  "webvan.com",
];

await initTables();
await seedUsedDomains(ALREADY_USED);
const all = await usedDomains();
console.log(`tables ready; ${all.size} used domains:`, [...all].sort().join(", "));
