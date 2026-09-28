// Dry run of a whole issue, one stage per run (call repeatedly), with state in
// blob "preview:job". Never touches the jobs/issues/used_domains tables and
// never emails — so it can't collide with the live cron. The rendered web
// page lands in blob "preview:html". Delete "preview:job" to start over.
// Costs real API money at the generate/verify stages.
import { blob } from "https://esm.town/v/std/blob/main.ts";
import type { Candidate, Evidence, Obituary } from "../lib/types.ts";
import { buildPool, vetBatch } from "../lib/discover.ts";
import { gatherEvidence } from "../lib/evidence.ts";
import { screenshotStored, tryCaptureScreenshot } from "../lib/screenshot.ts";
import { factCheck, writeObituary } from "../lib/generate.ts";
import { assembleIssue } from "../lib/assemble.ts";

interface Preview {
  stage: string;
  pool: Candidate[];
  finalists: Candidate[];
  evidence?: Evidence;
  obituary?: Obituary;
  feedback?: string[];
  drafts: number;
  log: string[];
}

const KEY = "preview:job";
const p: Preview = (await blob.getJSON(KEY)) ?? { stage: "discover", pool: [], finalists: [], drafts: 0, log: [] };
const say = (s: string) => {
  p.log.push(s);
  console.log(s);
};

switch (p.stage) {
  case "discover":
    p.pool = await buildPool();
    say(`pool: ${p.pool.length}`);
    p.stage = "vet";
    break;
  case "vet": {
    const enough = await vetBatch(p.pool, p.finalists);
    say(`finalists: ${p.finalists.map((c) => `${c.domain}(${c.score?.toFixed(2)},${c.today?.verdict})`).join(", ")}`);
    if (enough) p.stage = "evidence";
    break;
  }
  case "evidence":
    p.evidence = await gatherEvidence(p.finalists[0]);
    say(`evidence for ${p.finalists[0].domain}: article ${p.evidence.wikipedia.extract.length} chars, shot ${p.evidence.wayback.screenshotTimestamp}`);
    p.stage = "screenshot";
    break;
  case "screenshot": {
    const d = p.evidence!.candidate.domain;
    const ok = (await screenshotStored(d, p.evidence!.wayback.screenshotTimestamp)) || (await tryCaptureScreenshot(p.evidence!.wayback.screenshotTimestamp, d));
    say(`screenshot ${d}: ${ok ? "stored" : "not ready — run again"}`);
    if (ok) p.stage = "generate";
    break;
  }
  case "generate": {
    const t = Date.now();
    p.obituary = (await writeObituary(p.evidence!, p.feedback, p.obituary)).obituary;
    p.drafts++;
    say(`draft ${p.drafts} in ${Date.now() - t}ms: ${p.obituary.subject_line}`);
    p.stage = "verify";
    break;
  }
  case "verify": {
    const t = Date.now();
    const findings = await factCheck(p.evidence!, p.obituary!);
    say(`fact-check in ${Date.now() - t}ms: ${findings.length} finding(s)\n  ${findings.join("\n  ")}`);
    p.feedback = findings;
    p.stage = findings.length && p.drafts < 6 ? "generate" : "assemble";
    break;
  }
  case "assemble":
  case "done": { // "done" re-renders, so template changes can be previewed for free
    if (p.stage === "assemble" && p.feedback?.length && p.drafts < 6) {
      p.stage = "generate"; // an earlier run gave up too soon; redraft
      say("unresolved findings — back to generate");
      break;
    }
    const base = Deno.env.get("RIPURL_BASE_URL")!.replace(/\/$/, "");
    const { webHtml, subscriberHtml } = assembleIssue({ obituary: p.obituary!, evidence: p.evidence!, issueNumber: 1, baseUrl: base });
    await blob.set("preview:html", webHtml);
    await blob.set("preview:email", subscriberHtml);
    const key = crypto.randomUUID().replaceAll("-", "");
    await blob.set("preview:key", key);
    say(`assembled: web ${webHtml.length} bytes, email ${subscriberHtml.length} bytes`);
    say(`view at: <this val's URL>/preview?k=${key}  (add &v=email for the email version)`);
    p.stage = "done";
    break;
  }
  default:
    console.log(p.log.join("\n"));
}
await blob.setJSON(KEY, p);
