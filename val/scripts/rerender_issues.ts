// Re-render every published issue's web page with the current template, from
// its stored obituary + evidence, keeping each issue's original date. Free
// (no model calls) and idempotent. Emails already sent are not touched.
import { blob } from "https://esm.town/v/std/blob@30-main/main.ts";
import { assembleIssue } from "../lib/assemble.ts";
import { getIssue, listIssues } from "../lib/state.ts";
import type { Obituary } from "../lib/types.ts";
import { baseUrl } from "../pipeline.ts";

for (const { n } of await listIssues()) {
  const issue = (await getIssue(n))!;
  const obituary = (await blob.getJSON(`issue:${n}:obituary`)) as Obituary | null;
  if (!obituary) {
    console.log(`No. ${n}: no stored obituary — skipped`);
    continue;
  }
  const { webHtml } = assembleIssue({
    obituary,
    evidence: JSON.parse(issue.evidenceJson),
    issueNumber: n,
    baseUrl: baseUrl(),
    publishedAt: issue.createdAt,
  });
  await blob.set(`issue:${n}:html`, webHtml);
  console.log(`No. ${n} ${issue.domain}: re-rendered (${webHtml.length} bytes)`);
}
