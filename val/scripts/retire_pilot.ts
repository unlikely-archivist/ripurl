// One-time (idempotent): retire the pilot run (issues 1–11, Jul–Sep 2026) so
// the public archive restarts at Issue No. 1. Nothing is deleted for good:
// issue rows move to the pilot_issues table and each page is copied to blob
// "pilot:issue:<n>:html" before the live row is cleared. used_domains is left
// alone, so pilot domains are not re-picked.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { initTables, listIssues } from "../lib/state.ts";

await initTables();
await sqlite.execute(`CREATE TABLE IF NOT EXISTS pilot_issues AS SELECT * FROM issues WHERE 0`);
await sqlite.execute(`INSERT OR IGNORE INTO pilot_issues SELECT * FROM issues`);

for (const i of await listIssues()) {
  try {
    const html = await (await blob.get(`issue:${i.n}:html`)).text();
    await blob.set(`pilot:issue:${i.n}:html`, html);
    await blob.delete(`issue:${i.n}:html`);
  } catch (err) {
    throw new Error(`issue ${i.n}: page copy failed, nothing cleared — ${(err as Error).message}`);
  }
  await sqlite.execute({ sql: "DELETE FROM issues WHERE n = ?", args: [i.n] });
  console.log(`retired No. ${i.n} ${i.domain}`);
}
const kept = await sqlite.execute("SELECT COUNT(*) AS c FROM pilot_issues");
const live = await sqlite.execute("SELECT COUNT(*) AS c FROM issues");
console.log(`pilot_issues: ${kept.rows[0].c} · live issues: ${live.rows[0].c}`);
