// Re-run the current fact-checker over every published issue and print its
// findings. Read-only; costs one model call per issue.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import { factCheck } from "../lib/generate.ts";
import { getIssue, listIssues } from "../lib/state.ts";
import type { Obituary } from "../lib/types.ts";

for (const { n } of await listIssues()) {
  const issue = (await getIssue(n))!;
  const obituary = (await blob.getJSON(`issue:${n}:obituary`)) as Obituary | null;
  if (!obituary) continue;
  const findings = await factCheck(JSON.parse(issue.evidenceJson), obituary);
  console.log(`No. ${n} ${issue.domain}: ${findings.length} finding(s)${findings.map((f) => `\n  - ${f}`).join("")}`);
}
