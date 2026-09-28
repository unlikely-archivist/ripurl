# RIP · URL — Automation Architecture

The design of the zero-touch weekly pipeline. It runs on Val Town (Deno/TypeScript) as val
`unlikelyarchivist/ripurl`; the code is mirrored in `val/` (sync with `cd val && vt pull`).
Public site: https://ripurl.val.run. Every stage is one small file you can read top to bottom.

---

## 0. The honest trade

Full automation trades away the human taste gate. What replaces it:

1. **Hard gates before writing** — a candidate must prove the company lived on the web and that
   its URL is dead *today* (§2). The pilot run (Jul–Sep 2026, 11 issues, retired) had no such gate
   and wrote obituaries for oracle.com, cranberries.com and saban.com — all still alive.
2. **Evidence-only writing** — the model may use only what the pipeline fetched, and must refuse
   rather than pad.
3. **An independent fact-check** — a second call audits every draft against the same evidence;
   flagged claims go back for a surgical revision (§4).
4. **The owner copy** — every issue lands in Eryn's inbox the moment it publishes. Repair, not
   pre-approval.

## 1. Stage map

```
cron.ts  (every 15 min; jobs start Sundays 14:00–20:00 UTC)
  └─ pipeline.ts  tick() = advance the active job ONE stage (job lease: one tick at a time)
       discover       lib/discover.ts   Wikidata SPARQL → name / history / web gates → pool
       vet  (×n)      lib/discover.ts   corpse gate (lib/liveness.ts) + archive gate, 10 per tick
       evidence       lib/evidence.ts   Wikipedia article · RDAP · Wayback · founding date
       screenshot     lib/screenshot.ts Archive-error check → mShots render → dead-space trim → blob
       generate       lib/generate.ts   Claude writes content.json from the evidence (+ screenshot)
       verify         lib/generate.ts   Claude fact-checks; findings → back to generate (max 4 drafts)
       assemble_send  lib/assemble.ts   web page + emails; archive row; owner copy
       deliver  (×n)  lib/deliver.ts    subscriber fan-out via Gmail API, idempotent per address
http.ts   / · /about · /issue/N · /issue/N/evidence · /img/KEY · /feed.xml · subscribe flow · /status
```

Stages that fail retry on the next tick (max 3). Per-candidate stages then drop the candidate and
promote the next finalist; anything else fails the job and emails the owner. No partial issue is
ever published.

## 2. Candidate selection

Source: **Wikidata SPARQL** — entities with a dissolution date (P576, ≥1998), an official website
(P856) and an English Wikipedia article. A recorded dissolution proves the *company* died, not the
URL, so candidates must pass five gates, cheapest first:

| Gate | Rule | Where |
|---|---|---|
| name | domain = the company's name, a distinctive word of it, or its initials | `domainMatchesName` |
| history | Wikipedia lead section ≥ 600 chars | `buildPool` |
| web | description/lead reads web-native (site, online, platform, software, video game…) | `buildPool` |
| corpse | URL checked live: dark, unreachable, gone, blank, parked, redirected, repurposed = dead; alive or unclear = out | `lib/liveness.ts` |
| archive | ≥ 12 distinct months of Wayback captures | `vetOne` |

`scripts/check_liveness.ts` is the regression test for the corpse gate — it includes the pilot's
three live-site mistakes, which must never read as dead.

**Score** (weights in `lib/discover.ts`): archive depth 3 · article length 2 · recency 2 ·
dot-com-ness 2 · short domain 1. Top finalist publishes; the rest are fallbacks.

## 3. Evidence

| Evidence | Source |
|---|---|
| Company narrative | Wikipedia action API, full article minus reference sections, capped at 12k chars |
| What the URL does today | the corpse-gate verdict (`domain_today`) |
| Registration ("who still pays for the corpse") | RDAP via rdap.org |
| Site lifespan | Wayback CDX first/last capture + month count |
| Founding date | Wikidata P571 |

**TextExtracts gotcha:** any `exintro` value (even `0`) means "intro only", and `exchars` is silently
capped near 1,200 — both were in the pilot's request, so every pilot issue was written from a single
paragraph. Neither is sent now.

**Screenshot** (`lib/screenshot.ts`): WordPress mShots renders the toolbar-free Wayback URL
(`…/web/{ts}if_/…`) with a browser User-Agent, polled across ticks (the URL must stay identical for
the cached render to be picked up). Before rendering, the archived page is fetched and rejected if
it is an Internet Archive error page (the pilot published "Temporarily Offline" as a hero image).
The JPEG is trimmed of empty margins (old fixed-width sites sit in one corner of the 1000×750
capture), stored in blob storage and served from `/img/` — issues never depend on a third-party image
URL. thum.io (spinner placeholder) and microlink (blank page) do not work; don't switch to them.

## 4. Writing and fact-checking (Claude API — the only paid part)

- Model `claude-opus-4-8` (override with `RIPURL_MODEL`), structured JSON output, thinking off to
  stay inside the per-run wall clock. Well under $1 an issue including revisions.
- **Writer:** evidence block + the screenshot image; voice rules in `VOICE`; must set
  `insufficient_evidence` rather than pad. Post-checks: domain mentioned, sources only Wikipedia /
  Wayback, no pipeline vocabulary in prose.
- **Fact-checker:** same evidence + image, lists claims with a verdict (`contradicted` /
  `unsupported` / `ok`); `ok` rows are discarded in code.
- **Revisions are surgical:** the writer receives its previous draft plus the findings and changes
  only the flagged claims. Full rewrites fixed old claims but invented new ones and never converged;
  surgical revisions pass in 1–2 rounds.
- `scripts/preview_issue.ts` runs the whole thing as a dry run (no DB writes, no email) and serves
  the result at `/preview?k=<key>`.

## 5. Publishing and delivery

- `lib/assemble.ts` — the approved newspaper design as a plain TS function (no template language),
  860px email-safe tables plus a <700px stacking stylesheet; render guard rejects `{{`, `{%`,
  `undefined`, `{URL}`. Three outputs: web page, owner email (with the X/Tumblr cross-post kit),
  subscriber email (personalized unsubscribe link).
- **Owner copy:** Val Town `std/email` — free tier can only email the val owner.
- **Subscribers:** double opt-in on the front page; issues fan out through the **Gmail API** as the
  sending account (free, ~500 recipients/day). Switched on by `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`; until then the front page offers RSS.
  The Google OAuth app must be in **In production** status — a Testing app's refresh token expires
  after 7 days. Sends are recorded per (issue, email), so a cut-off run resumes without duplicates.
  RFC 8058 one-click unsubscribe headers are set.
- Substack has no write API; cross-posting there stays manual.

## 6. State (val-scoped sqlite + blob)

- `used_domains` — never picked again (includes the pilot's domains).
- `issues(n, domain, subject, model, evidence_json, created_at)` — every issue's evidence trail,
  public at `/issue/N/evidence`. `pilot_issues` holds the retired pilot rows; their pages are in
  blob `pilot:issue:N:html`.
- `jobs` — one active job at most (partial unique index); `lease_until` keeps overlapping ticks
  (cron + manual `/tick`) from working the same job.
- `subscribers`, `deliveries`.
- Blob: `img:<domain>`, `issue:<n>:html|email|obituary`.

## 7. Environment variables (Val Town UI; never in code)

- `ANTHROPIC_API_KEY` — writing and fact-checking
- `RIPURL_BASE_URL` — `https://ripurl.val.run`, used in emails
- `RUN_TOKEN` — guards `POST /run` and `POST /tick`
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` — subscriber email
- optional: `RIPURL_MODEL`, `RIPURL_REPO_URL` (adds a source link to `/about`)
