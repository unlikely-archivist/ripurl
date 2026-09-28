// Correct a published issue the way the pipeline would have: fact-check it,
// make a surgical revision for any findings, re-check, and re-render the web
// page only if the revision passes. Set ISSUE below. Costs 2–6 model calls.
import { blob } from "https://esm.town/v/std/blob@30-main/main.ts";
import { sqlite } from "https://esm.town/v/std/sqlite@34-main/main.ts";
import { assembleIssue } from "../lib/assemble.ts";
import { factCheck, writeObituary } from "../lib/generate.ts";
import { getIssue } from "../lib/state.ts";
import type { Evidence, Obituary } from "../lib/types.ts";
import { baseUrl } from "../pipeline.ts";

const ISSUE = 1;
const MAX_REVISIONS = 3;

const issue = await getIssue(ISSUE);
if (!issue) throw new Error(`no issue ${ISSUE}`);
const evidence = JSON.parse(issue.evidenceJson) as Evidence;
let ob = (await blob.getJSON(`issue:${ISSUE}:obituary`)) as Obituary;

let findings = await factCheck(evidence, ob);
for (let i = 0; findings.length && i < MAX_REVISIONS; i++) {
  console.log(`round ${i + 1}: ${findings.length} finding(s)\n  - ${findings.join("\n  - ")}`);
  ob = (await writeObituary(evidence, findings, ob)).obituary;
  findings = await factCheck(evidence, ob);
}
if (findings.length) throw new Error(`still ${findings.length} finding(s) — nothing changed:\n${findings.join("\n")}`);

await blob.setJSON(`issue:${ISSUE}:obituary`, ob);
await sqlite.execute({ sql: "UPDATE issues SET subject = ? WHERE n = ?", args: [ob.subject_line, ISSUE] });
const { webHtml } = assembleIssue({ obituary: ob, evidence, issueNumber: ISSUE, baseUrl: baseUrl(), publishedAt: issue.createdAt });
await blob.set(`issue:${ISSUE}:html`, webHtml);
console.log(`No. ${ISSUE} ${issue.domain}: clean; re-rendered.`);
