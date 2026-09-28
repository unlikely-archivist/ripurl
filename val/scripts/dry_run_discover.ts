// Manual check: run discovery + two vet batches without touching job state.
import type { Candidate } from "../lib/types.ts";
import { buildPool, vetBatch } from "../lib/discover.ts";

const t0 = Date.now();
const pool = await buildPool();
console.log(`pool after gates 1–3: ${pool.length} (${Date.now() - t0}ms)`);
console.log(pool.slice(0, 25).map((c) => `  ${c.domain.padEnd(26)} ${c.description}`).join("\n"));

const finalists: Candidate[] = [];
for (let i = 0; i < 2; i++) {
  const t = Date.now();
  await vetBatch(pool, finalists);
  console.log(`vet batch ${i + 1}: ${finalists.length} finalists (${Date.now() - t}ms)`);
}
for (const c of finalists) {
  console.log(`${c.score?.toFixed(2)}  ${c.domain.padEnd(24)} d.${c.dissolvedYear} ${c.monthsArchived}mo today=${c.today?.verdict}${c.today?.finalDomain ? "→" + c.today.finalDomain : ""} | ${c.description}`);
}
