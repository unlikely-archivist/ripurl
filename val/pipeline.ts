// The orchestrator. One call to tick() advances the active job by exactly one
// stage, so every run stays far inside Val Town's per-run wall clock. The cron
// calls tick() every 15 minutes; a full issue takes ~8–10 ticks (2–3 hours).
//
//   discover → vet (×n) → evidence → screenshot → generate ⇄ verify → assemble_send → deliver (×n) → done
//
// Failure policy: a stage may fail 3 times. For per-candidate stages the
// candidate is then discarded and the next finalist takes over (back to
// evidence). If the fact-checker rejects 4 drafts of the same candidate, that
// candidate is dropped too. If everything is exhausted, the job fails LOUDLY —
// you get a plain-text email saying which stage broke, never silence, never a
// partial issue.

import { blob } from "https://esm.town/v/std/blob/main.ts";
import type { Job } from "./lib/types.ts";
import {
  activeJob,
  claimJob,
  createJob,
  daysSinceLastIssue,
  initTables,
  markUsed,
  nextIssueNumber,
  recordIssue,
  releaseJob,
  saveJob,
} from "./lib/state.ts";
import { buildPool, vetBatch } from "./lib/discover.ts";
import { gatherEvidence } from "./lib/evidence.ts";
import { screenshotStored, tryCaptureScreenshot } from "./lib/screenshot.ts";
import { factCheck, InsufficientEvidenceError, writeObituary } from "./lib/generate.ts";
import { assembleIssue } from "./lib/assemble.ts";
import { deliverToSubscribers, sendOwnerCopy } from "./lib/deliver.ts";

const MAX_STAGE_ATTEMPTS = 3;
const MAX_REVISIONS = 3; // redrafts after the first before a candidate is dropped (findings typically go 7 → 5 → 1 → 0)
const PER_CANDIDATE: Job["stage"][] = ["evidence", "screenshot", "generate", "verify"];

export function baseUrl(): string {
  const u = Deno.env.get("RIPURL_BASE_URL");
  if (!u) throw new Error("RIPURL_BASE_URL env var is not set (the val's own public URL)");
  return u.replace(/\/$/, "");
}

// Should a fresh weekly job start this tick? Publication window: Sundays
// 14:00–20:00 UTC (morning in New Orleans), and only if nothing published
// in the last 5 days. force=true bypasses the window for manual runs.
function inPublicationWindow(now = new Date()): boolean {
  return now.getUTCDay() === 0 && now.getUTCHours() >= 14 && now.getUTCHours() < 20;
}

export async function tick(force = false): Promise<string> {
  await initTables();
  let job = await activeJob();

  if (!job) {
    const days = await daysSinceLastIssue();
    if (force || (inPublicationWindow() && days > 5)) {
      try {
        job = await createJob();
      } catch {
        return "a concurrent tick already started this week's job";
      }
      return `started job #${job.id}`;
    }
    return "idle (outside publication window or issue too recent)";
  }

  if (!(await claimJob(job.id))) return `job #${job.id}: busy (another tick is working it)`;
  try {
    return await advance(job);
  } catch (err) {
    return await handleFailure(job, err as Error);
  } finally {
    await releaseJob(job.id);
  }
}

function nextStage(job: Job, stage: Job["stage"]) {
  job.stage = stage;
  job.attempts = 0;
}

async function advance(job: Job): Promise<string> {
  switch (job.stage) {
    case "discover": {
      job.pool = await buildPool();
      job.candidates = [];
      nextStage(job, "vet");
      await saveJob(job);
      return `job #${job.id}: ${job.pool.length} candidates passed name/history/web gates`;
    }
    case "vet": {
      const enough = await vetBatch(job.pool, job.candidates);
      if (enough) {
        if (job.candidates.length === 0) throw new Error("pool exhausted: no domain passed the corpse + archive gates");
        nextStage(job, "evidence");
      }
      await saveJob(job);
      return `job #${job.id}: ${job.candidates.length} finalists, ${job.pool.length} left to vet` +
        (enough ? `; winner ${job.candidates[0].domain} (score ${job.candidates[0].score?.toFixed(2)})` : "");
    }
    case "evidence": {
      job.evidence = await gatherEvidence(job.candidates[0]);
      nextStage(job, "screenshot");
      await saveJob(job);
      return `job #${job.id}: evidence gathered for ${job.candidates[0].domain}`;
    }
    case "screenshot": {
      const ev = job.evidence!;
      const ok = (await screenshotStored(ev.candidate.domain, ev.wayback.screenshotTimestamp)) ||
        (await tryCaptureScreenshot(ev.wayback.screenshotTimestamp, ev.candidate.domain));
      if (!ok) throw new Error("mShots render not ready yet");
      nextStage(job, "generate");
      await saveJob(job);
      return `job #${job.id}: screenshot stored for ${ev.candidate.domain}`;
    }
    case "generate": {
      const { obituary } = await writeObituary(job.evidence!, job.feedback, job.obituary);
      job.obituary = obituary;
      nextStage(job, "verify");
      await saveJob(job);
      return `job #${job.id}: draft ${job.revisions + 1} written for ${obituary.domain}`;
    }
    case "verify": {
      const findings = await factCheck(job.evidence!, job.obituary!);
      if (findings.length === 0) {
        job.feedback = undefined;
        nextStage(job, "assemble_send");
        await saveJob(job);
        return `job #${job.id}: draft ${job.revisions + 1} passed fact-check`;
      }
      if (job.revisions >= MAX_REVISIONS) {
        throw new InsufficientEvidenceError(
          `fact-check still failing after ${job.revisions + 1} drafts: ${findings.slice(0, 2).join("; ")}`,
        );
      }
      job.feedback = findings;
      job.revisions += 1;
      nextStage(job, "generate");
      await saveJob(job);
      return `job #${job.id}: fact-check found ${findings.length} unsupported claim(s); redrafting`;
    }
    case "assemble_send": {
      const url = baseUrl();
      const n = await nextIssueNumber();
      const ob = job.obituary!;
      const { ownerHtml, subscriberHtml, webHtml } = assembleIssue({
        obituary: ob,
        evidence: job.evidence!,
        issueNumber: n,
        baseUrl: url,
      });
      await blob.set(`issue:${n}:html`, webHtml);
      await blob.set(`issue:${n}:email`, subscriberHtml);
      await blob.setJSON(`issue:${n}:obituary`, ob); // feeds the front page + RSS
      const model = Deno.env.get("RIPURL_MODEL") ?? "claude-opus-4-8";
      await recordIssue(n, ob.domain, ob.subject_line, model, JSON.stringify(job.evidence));
      await markUsed(ob.domain);
      await sendOwnerCopy(ob.subject_line, ownerHtml);
      job.issueNumber = n;
      nextStage(job, "deliver");
      await saveJob(job);
      return `job #${job.id}: ISSUE NO. ${n} (${ob.domain}) published; owner copy sent`;
    }
    case "deliver": {
      const n = job.issueNumber!;
      const html = await (await blob.get(`issue:${n}:email`)).text();
      const r = await deliverToSubscribers(n, job.obituary!.subject_line, html, baseUrl());
      if (r.failed.length) console.error(`[ripurl deliver] ${r.failed.length} failed:\n${r.failed.join("\n")}`);
      if (r.remaining === 0) nextStage(job, "done");
      await saveJob(job);
      return `job #${job.id}: delivered issue ${n} to ${r.sent} subscriber(s), ${r.remaining} remaining, ${r.failed.length} failed`;
    }
    default:
      return `job #${job.id}: nothing to do in stage ${job.stage}`;
  }
}

async function alertFailed(job: Job) {
  job.stage = "failed";
  await saveJob(job);
  await sendOwnerCopy(
    "RIP·URL: this week's run FAILED",
    `<pre style="font-family:monospace;">The pipeline gave up.\n\nLast error: ${job.error}\n\n` +
      `Nothing was published. Check the val logs, fix the stage, then POST /run?token=... to retry.</pre>`,
  );
}

async function handleFailure(job: Job, err: Error): Promise<string> {
  // A missing API key is a configuration gap, not a pipeline failure: hold
  // the job in place (no attempt burned, no fallback, no alarm email). The
  // moment the key is added in the env-vars UI, the next tick resumes here.
  if (err.message.includes("ANTHROPIC_API_KEY")) {
    return `job #${job.id}: BLOCKED at ${job.stage} — ${err.message}`;
  }
  const insufficient = err instanceof InsufficientEvidenceError;
  job.attempts += 1;
  job.error = `${job.stage}: ${err.message}`;
  const exhausted = job.attempts >= MAX_STAGE_ATTEMPTS;

  if (PER_CANDIDATE.includes(job.stage) && (insufficient || exhausted)) {
    // Give up on this candidate; promote the next finalist.
    const dropped = job.candidates.shift()?.domain;
    if (job.candidates.length > 0) {
      nextStage(job, "evidence");
      job.evidence = undefined;
      job.obituary = undefined;
      job.feedback = undefined;
      job.revisions = 0;
      await saveJob(job);
      return `job #${job.id}: dropped ${dropped} (${job.error}); falling back to ${job.candidates[0].domain}`;
    }
    await alertFailed(job);
    return `job #${job.id}: FAILED — every finalist dropped (${job.error}); alert emailed`;
  }
  if (exhausted) {
    await alertFailed(job);
    return `job #${job.id}: FAILED (${job.error}) — alert emailed`;
  }
  await saveJob(job);
  return `job #${job.id}: stage ${job.stage} attempt ${job.attempts} failed (${job.error}); will retry next tick`;
}
