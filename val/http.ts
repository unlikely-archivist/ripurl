// Public face of the publication + manual controls.
//   GET  /                   front page: pitch, subscribe, latest issue, the register
//   GET  /about              how this is made
//   GET  /issue/:n           permanent web version of an issue
//   GET  /issue/:n/evidence  the evidence file the issue was written from (JSON)
//   GET  /img/:domain        the stored screenshot JPEG (referenced by emails)
//   GET  /feed.xml           RSS
//   POST /subscribe          double opt-in: store pending, email a confirm link
//   GET  /confirm?t=         activate a subscription
//   GET|POST /unsubscribe?t= GET asks, POST does it (also RFC 8058 one-click)
//   GET  /preview?k=         draft from scripts/preview_issue.ts (per-preview key)
//   GET  /status             current job state (public, read-only, no secrets)
//   POST /run?token=...      force-start this week's job now (RUN_TOKEN guards it)
//   POST /tick?token=...     advance the active job one stage now (same guard)

import { blob } from "https://esm.town/v/std/blob/main.ts";
import {
  activeJob,
  getIssue,
  getSubscriber,
  initTables,
  listIssues,
  markConfirmSent,
  setStatusByToken,
  upsertPending,
} from "./lib/state.ts";
import { sendConfirmation, subscriptionsEnabled } from "./lib/deliver.ts";
import { aboutPage, esc, frontPage, type IssueSummary, noticePage, rssFeed } from "./lib/pages.ts";
import type { Obituary } from "./lib/types.ts";
import { tick } from "./pipeline.ts";

const HTML = { "content-type": "text/html; charset=utf-8" };
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const RESEND_AFTER_MS = 10 * 60_000;

function authorized(url: URL): boolean {
  const token = Deno.env.get("RUN_TOKEN");
  return Boolean(token) && url.searchParams.get("token") === token;
}

async function obituaryOf(n: number): Promise<Obituary | undefined> {
  try {
    return (await blob.getJSON(`issue:${n}:obituary`)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function summaries(withObituaries: "latest" | "all"): Promise<IssueSummary[]> {
  const issues: IssueSummary[] = await listIssues();
  const wanted = withObituaries === "latest" ? issues.slice(0, 1) : issues;
  await Promise.all(wanted.map(async (i) => (i.obituary = await obituaryOf(i.n))));
  return issues;
}

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } });

export default async function (req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const base = url.origin;
  await initTables();

  if (path === "/" && req.method === "GET") {
    return new Response(
      frontPage({
        baseUrl: base,
        issues: await summaries("latest"),
        subscriptions: subscriptionsEnabled(),
        flash: url.searchParams.get("s") ?? undefined,
      }),
      { headers: HTML },
    );
  }

  if (path === "/about" && req.method === "GET") {
    return new Response(aboutPage(base, Deno.env.get("RIPURL_REPO_URL")), { headers: HTML });
  }

  if (path === "/feed.xml" && req.method === "GET") {
    return new Response(rssFeed(base, await summaries("all")), {
      headers: { "content-type": "application/rss+xml; charset=utf-8" },
    });
  }

  const issueMatch = path.match(/^\/issue\/(\d+)(\/evidence)?$/);
  if (issueMatch && req.method === "GET") {
    const n = parseInt(issueMatch[1], 10);
    const issue = await getIssue(n);
    if (!issue) return new Response(noticePage(base, "No such issue", "That grave hasn't been dug yet."), { status: 404, headers: HTML });
    if (issueMatch[2]) {
      return new Response(JSON.stringify(JSON.parse(issue.evidenceJson), null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    try {
      const r = await blob.get(`issue:${n}:html`);
      return new Response(await r.text(), { headers: HTML });
    } catch {
      return new Response("Issue HTML missing from storage", { status: 500 });
    }
  }

  const imgMatch = path.match(/^\/img\/([a-z0-9.-]+)$/);
  if (imgMatch && req.method === "GET") {
    try {
      const r = await blob.get(`img:${imgMatch[1]}`);
      return new Response(await r.arrayBuffer(), {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return new Response("No such image", { status: 404 });
    }
  }

  // --- subscriptions ---------------------------------------------------------

  if (path === "/subscribe" && req.method === "POST") {
    if (!subscriptionsEnabled()) return redirect(`${base}/#subscribe`);
    const form = await req.formData();
    if (form.get("website")) return redirect(`${base}/?s=check#subscribe`); // honeypot: pretend success
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return redirect(`${base}/?s=invalid#subscribe`);

    const existing = await getSubscriber(email);
    if (existing?.status === "active") return redirect(`${base}/?s=already#subscribe`);
    if (existing?.status === "pending" && existing.lastConfirmSentAt &&
        Date.now() - Date.parse(existing.lastConfirmSentAt) < RESEND_AFTER_MS) {
      return redirect(`${base}/?s=check#subscribe`);
    }
    const sub = await upsertPending(email);
    try {
      await sendConfirmation(email, `${base}/confirm?t=${sub.token}`);
      await markConfirmSent(email);
    } catch (err) {
      console.error(`[ripurl subscribe] ${(err as Error).message}`);
      return redirect(`${base}/?s=error#subscribe`);
    }
    return redirect(`${base}/?s=check#subscribe`);
  }

  if (path === "/confirm" && req.method === "GET") {
    const sub = await setStatusByToken(url.searchParams.get("t") ?? "", "active");
    return new Response(
      sub
        ? noticePage(base, "Subscribed", `You're on the list, ${esc(sub.email)}. The next obituary arrives Sunday morning.`)
        : noticePage(base, "Link expired", "That confirmation link isn't valid anymore. Subscribe again from the front page."),
      { status: sub ? 200 : 404, headers: HTML },
    );
  }

  if (path === "/unsubscribe") {
    const t = url.searchParams.get("t") ?? "";
    if (req.method === "POST") {
      const sub = await setStatusByToken(t, "unsubscribed");
      return new Response(
        noticePage(base, "Unsubscribed", sub ? "Done. No more obituaries. We'll keep the lights off for you." : "That link isn't valid."),
        { status: sub ? 200 : 404, headers: HTML },
      );
    }
    if (req.method === "GET") {
      // Asking first keeps link-scanning mail filters from unsubscribing people.
      return new Response(
        noticePage(
          base,
          "Unsubscribe",
          "Stop receiving RIP · URL?",
          `<form method="post" action="${base}/unsubscribe?t=${encodeURIComponent(t)}" style="margin-top:16px;"><button class="button" type="submit">Unsubscribe with dignity</button></form>`,
        ),
        { headers: HTML },
      );
    }
  }

  // --- operations ------------------------------------------------------------

  // Draft preview from scripts/preview_issue.ts; the key is minted per preview.
  if (path === "/preview" && req.method === "GET") {
    const key = await (await blob.get("preview:key").catch(() => null))?.text();
    if (!key || url.searchParams.get("k") !== key) return new Response("Forbidden", { status: 403 });
    const which = url.searchParams.get("v") === "email" ? "preview:email" : "preview:html";
    return new Response(await (await blob.get(which)).text(), { headers: { ...HTML, "x-robots-tag": "noindex" } });
  }

  if (path === "/status" && req.method === "GET") {
    const job = await activeJob();
    return Response.json(
      job
        ? {
          stage: job.stage,
          attempts: job.attempts,
          currentDomain: job.candidates[0]?.domain ?? null,
          finalists: job.candidates.length,
          leftToVet: job.pool.length,
          error: job.error ?? null,
          updatedAt: job.updatedAt,
        }
        : { stage: "idle" },
    );
  }

  if (path === "/run" && req.method === "POST") {
    if (!authorized(url)) return new Response("Forbidden", { status: 403 });
    return new Response(await tick(true));
  }

  if (path === "/tick" && req.method === "POST") {
    if (!authorized(url)) return new Response("Forbidden", { status: 403 });
    return new Response(await tick());
  }

  return new Response(noticePage(base, "Not found", "Nothing is buried here."), { status: 404, headers: HTML });
}
