// The public website's pages: front page, "How this is made", and the small
// status pages of the subscribe flow. Same paper-and-ink identity as the
// issue sheet (lib/assemble.ts), written as modern responsive HTML/CSS since
// these never go through an email client.

import type { Obituary } from "./types.ts";
import { captionClause } from "./assemble.ts";

export interface IssueSummary {
  n: number;
  domain: string;
  subject: string;
  createdAt: string;
  obituary?: Obituary;
}

export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
const plain = (s: string) => s.replace(/<[^>]+>/g, "");
const epithet = (subject: string) => subject.replace(/^In Loving Memory of [^:]+:\s*/i, "");
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });

// Next Sunday's publication window (14:00 UTC), for "goes to press" copy.
export function nextPressDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14));
  const add = (7 - d.getUTCDay()) % 7 || (now.getUTCHours() >= 20 ? 7 : 0);
  d.setUTCDate(d.getUTCDate() + add);
  return longDate(d.toISOString());
}

const CSS = `
:root{--ink:#1a1a1a;--red:#a82828;--paper:#ecebe7;--card:#fbfbf9;--mute:#555;--faint:#8a8677;--rule:#b8b8b2;--bg:#a9a9a7;--link:#1a56db}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;padding:40px 16px;font-family:Georgia,'Times New Roman',serif;color:var(--ink);line-height:1.6}
.sheet{max-width:860px;margin:0 auto;background:var(--paper);border:3px solid var(--ink)}
a{color:inherit}
.mast{text-align:center;padding:26px 40px 18px;border-bottom:2px solid var(--ink)}
.kicker{font-size:12px;letter-spacing:4px;text-transform:uppercase;color:var(--mute);padding-bottom:6px}
.title{font-family:'Times New Roman',Times,Georgia,serif;font-size:64px;font-weight:bold;letter-spacing:3px;line-height:1;margin:0;padding:12px 0 9px;border-top:1px solid var(--ink);border-bottom:1px solid var(--ink)}
.title a{text-decoration:none}
.title .rip{color:var(--red)}
.tagline{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--red);padding-top:8px}
.section{padding:24px 40px}
.box{background:var(--card);border:1px solid var(--ink);padding:22px 28px}
.standfirst{font-size:19px;font-style:italic;line-height:1.62;margin:0}
.label{font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--red);margin:0 0 12px}
.fleuron{display:flex;align-items:center;gap:14px;color:var(--red);padding:0 40px}
.fleuron::before,.fleuron::after{content:"";flex:1;border-bottom:1px solid var(--rule)}
form.sub{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
form.sub input[type=email]{flex:1 1 240px;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--ink);background:#fff;color:var(--ink);border-radius:0}
form.sub button,.button{font:inherit;font-size:13px;letter-spacing:2px;text-transform:uppercase;padding:10px 18px;background:var(--ink);color:var(--paper);border:1px solid var(--ink);cursor:pointer;text-decoration:none;display:inline-block;border-radius:0}
form.sub button:hover,.button:hover{background:var(--red);border-color:var(--red)}
.hp{position:absolute;left:-9999px}
.note{font-size:13px;color:var(--faint);font-style:italic;margin:10px 0 0}
.flash{border-left:3px solid var(--red);padding:8px 14px;margin:0 0 16px;background:#f5f3ee;font-style:italic}
.latest{display:grid;grid-template-columns:1fr;gap:18px}
.plate{background:#fff;border:1px solid #8a8a84;padding:9px}
.plate img{display:block;width:100%;height:auto;border:1px solid #d6d6d0}
.caption{font-size:12.5px;font-style:italic;color:var(--mute);text-align:center;margin:10px 0 0}
.caption b{color:var(--red);font-style:normal}
.headline{font-family:'Times New Roman',Georgia,serif;font-size:30px;line-height:1.15;margin:0}
.headline a{text-decoration:none}
.headline .dom{color:var(--link)}
.deck{font-size:17px;font-style:italic;line-height:1.6;margin:10px 0 0}
.register{width:100%;border-collapse:collapse}
.register td{padding:10px 8px;border-top:1px solid #d8d8d5;vertical-align:baseline}
.register .no{font-family:'Courier New',monospace;font-size:12px;font-weight:bold;color:var(--red);white-space:nowrap;width:48px}
.register .dom{font-family:'Courier New',monospace;font-size:14px;white-space:nowrap}
.register .ep{font-style:italic;color:var(--mute)}
.register .dt{font-size:12px;color:var(--faint);white-space:nowrap;text-align:right}
.register a{text-decoration:none}
.register tr:hover .dom{color:var(--red)}
.foot{border-top:4px double var(--ink);margin:0 40px;padding:16px 0 30px;text-align:center;font-size:12px;color:var(--mute);font-style:italic}
.foot .org{font-family:'Times New Roman',Georgia,serif;font-style:normal;font-weight:bold;font-size:18px;letter-spacing:2px;color:var(--ink);display:block;margin-bottom:6px}
.prose p{margin:0 0 14px;font-size:16.5px;line-height:1.72}
.prose h2{font-family:'Times New Roman',Georgia,serif;font-size:24px;margin:28px 0 10px}
.prose code{font-family:'Courier New',monospace;font-size:14px;background:#e3e1db;padding:1px 4px}
.stages{list-style:none;margin:6px 0 18px;padding:0;counter-reset:s}
.stages li{counter-increment:s;display:grid;grid-template-columns:40px 1fr;gap:4px 12px;padding:10px 0;border-top:1px solid #d8d8d5}
.stages li::before{content:counter(s,decimal-leading-zero);font-family:'Courier New',monospace;font-weight:bold;color:var(--red);font-size:13px;padding-top:3px}
.stages b{font-family:'Courier New',monospace;font-size:14px}
.stages span{grid-column:2;font-size:15px;color:#333}
.gates{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:15px}
.gates th{text-align:left;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--red);padding:6px 8px 6px 0;border-bottom:1px solid var(--ink)}
.gates td{padding:8px 8px 8px 0;border-top:1px solid #d8d8d5;vertical-align:top}
.gates td:first-child{font-family:'Courier New',monospace;font-size:13px;white-space:nowrap}
:focus-visible{outline:2px solid var(--red);outline-offset:2px}
@media (min-width:720px){.latest{grid-template-columns:1.15fr 1fr;align-items:start}}
@media (max-width:700px){
  body{padding:0}
  .sheet{border-width:0}
  .mast,.section{padding-left:16px;padding-right:16px}
  .fleuron{padding:0 16px}.foot{margin:0 16px}
  .title{font-size:44px}
  .box{padding:18px}
  .register .ep{display:none}
}
`;

function shell(opts: { title: string; description: string; baseUrl: string; body: string; image?: string }): string {
  const { title, description, baseUrl, body, image } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<meta name="theme-color" content="#ecebe7">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23ecebe7'/%3E%3Ctext x='16' y='23' font-family='Georgia' font-size='20' font-weight='bold' text-anchor='middle' fill='%23a82828'%3E%E2%80%A0%3C/text%3E%3C/svg%3E">
<link rel="alternate" type="application/rss+xml" title="RIP · URL" href="${baseUrl}/feed.xml">
<style>${CSS}</style>
</head>
<body>
<main class="sheet">
${body}
</main>
</body>
</html>`;
}

function masthead(baseUrl: string, kicker: string): string {
  return `<header class="mast">
  <div class="kicker">${kicker}</div>
  <h1 class="title"><a href="${baseUrl}/"><span class="rip">RIP</span> · URL</a></h1>
  <div class="tagline">A Weekly Obituary for Dead &amp; Dying Domains</div>
</header>`;
}

function footer(baseUrl: string): string {
  return `<footer class="foot">
  <span class="org">UNLIKELY ARCHIVE</span>
  <a href="${baseUrl}/">All issues</a> &nbsp;·&nbsp; <a href="${baseUrl}/about">How this is made</a> &nbsp;·&nbsp; <a href="${baseUrl}/feed.xml">RSS</a>
</footer>`;
}

const FLASH: Record<string, string> = {
  check: "Almost there — check your inbox for a confirmation link.",
  already: "You're already on the list. See you Sunday.",
  invalid: "That doesn't look like an email address.",
  error: "Something went wrong sending your confirmation. Try again in a minute.",
};

function subscribeBox(baseUrl: string, enabled: boolean, flash?: string): string {
  const msg = flash && FLASH[flash] ? `<p class="flash" role="status">${FLASH[flash]}</p>` : "";
  const form = enabled
    ? `<form class="sub" method="post" action="${baseUrl}/subscribe">
      <label class="hp" aria-hidden="true">Leave blank <input name="website" tabindex="-1" autocomplete="off"></label>
      <label for="email" class="hp">Email address</label>
      <input id="email" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
      <button type="submit">Subscribe</button>
    </form>
    <p class="note">One email, Sunday mornings. Confirm once; leave whenever.</p>`
    : `<p class="note" style="font-style:normal;margin-top:14px;"><a class="button" href="${baseUrl}/feed.xml">Follow via RSS</a></p>`;
  return `<section class="section" id="subscribe">
  <div class="box">
    ${msg}
    <p class="standfirst">Every Sunday, one website that mattered — and doesn't anymore — gets a proper obituary: how it rose, what really killed it, and what its address does now.</p>
    ${form}
  </div>
</section>`;
}

export function frontPage(opts: {
  baseUrl: string;
  issues: IssueSummary[]; // newest first; [0] carries its obituary
  subscriptions: boolean;
  flash?: string;
}): string {
  const { baseUrl, issues, subscriptions, flash } = opts;
  const latest = issues[0];
  const kicker = `EST. 2026 &nbsp;·&nbsp; SUNDAYS &nbsp;·&nbsp; ${issues.length ? `${issues.length} ${issues.length === 1 ? "OBITUARY" : "OBITUARIES"} FILED` : "FIRST ISSUE IN PREPARATION"}`;

  const latestHtml = latest
    ? `<section class="section">
  <p class="label">Latest · Issue No. ${latest.n} · ${longDate(latest.createdAt)}</p>
  <div class="latest">
    <figure style="margin:0">
      <div class="plate"><a href="${baseUrl}/issue/${latest.n}"><img src="${baseUrl}/img/${latest.domain}" alt="${esc(latest.domain)} as the Wayback Machine archived it" loading="lazy" width="732" height="549"></a></div>
      ${latest.obituary ? `<figcaption class="caption"><b>fig. 1</b> — ${esc(latest.domain)}, ${esc(captionClause(plain(latest.obituary.screenshot_note)))}.</figcaption>` : ""}
    </figure>
    <div>
      <h2 class="headline"><a href="${baseUrl}/issue/${latest.n}">In Loving Memory of <span class="dom">${esc(latest.domain)}</span></a></h2>
      <p class="deck">${esc(epithet(latest.subject))}</p>
      ${latest.obituary ? `<p style="margin:14px 0 18px;font-size:16px;line-height:1.65;">${esc(plain(latest.obituary.legacy))}</p>` : ""}
      <a class="button" href="${baseUrl}/issue/${latest.n}">Read the obituary</a>
    </div>
  </div>
</section>`
    : `<section class="section">
  <p class="label">Now in preparation</p>
  <p class="standfirst" style="font-style:normal;font-size:17px;">Issue No. 1 goes to press <b>Sunday, ${nextPressDate()}</b>. The first grave is being chosen now.</p>
</section>`;

  const register = issues.length > 1
    ? `<section class="section">
  <p class="label">The Register</p>
  <table class="register">
    ${issues.map((i) => `<tr>
      <td class="no">No.&nbsp;${i.n}</td>
      <td><a href="${baseUrl}/issue/${i.n}"><span class="dom">${esc(i.domain)}</span></a></td>
      <td class="ep"><a href="${baseUrl}/issue/${i.n}">${esc(epithet(i.subject))}</a></td>
      <td class="dt">${new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
    </tr>`).join("")}
  </table>
</section>`
    : "";

  return shell({
    title: "RIP · URL — A Weekly Obituary for Dead & Dying Domains",
    description: "Every Sunday, one website that mattered gets a proper obituary: how it rose, what killed it, and what its address does now.",
    baseUrl,
    image: latest ? `${baseUrl}/img/${latest.domain}` : undefined,
    body: `${masthead(baseUrl, kicker)}
${subscribeBox(baseUrl, subscriptions, flash)}
<div class="fleuron" aria-hidden="true">❦</div>
${latestHtml}
${register}
${footer(baseUrl)}`,
  });
}

export function aboutPage(baseUrl: string, repoUrl?: string): string {
  const body = `${masthead(baseUrl, "HOW THIS IS MADE")}
<section class="section prose">
  <div class="box" style="margin-bottom:22px;">
    <p class="standfirst" style="margin:0">RIP · URL is written by a machine and held to an archivist's rules: it may only say what it can prove, and it may only bury what is actually dead.</p>
  </div>

  <p>Every Sunday a scheduled job wakes up, finds a website that once mattered and no longer exists, gathers the record of its life, and writes it an obituary. No one picks the domain or edits the copy. What makes it trustworthy is not a human in the loop — it's a set of gates the machine can't talk its way past.</p>

  <h2>The run, stage by stage</h2>
  <ol class="stages">
    <li><b>discover</b><span>Ask Wikidata for every organisation with a recorded dissolution date, an official website, and an English Wikipedia article — several hundred candidates a week.</span></li>
    <li><b>vet</b><span>Put each through the gates below, ten at a time, until four finalists survive.</span></li>
    <li><b>evidence</b><span>Collect the file the obituary is allowed to use: the Wikipedia article, the domain's registration record, its Wayback Machine history, and what the URL does today.</span></li>
    <li><b>screenshot</b><span>Render the site as the Internet Archive saw it in its prime, and keep a copy — the issue never depends on someone else's image link staying alive.</span></li>
    <li><b>generate</b><span>Claude writes the obituary from the evidence file and nothing else, or declares the evidence too thin.</span></li>
    <li><b>verify</b><span>A second, independent Claude call fact-checks the draft against the same evidence. Any unsupported claim sends it back for a rewrite; if four drafts can't pass, the candidate is dropped.</span></li>
    <li><b>publish</b><span>The issue is rendered, archived here permanently, and emailed to subscribers.</span></li>
  </ol>

  <h2>The gates</h2>
  <p>A company's death is not a URL's death. A band's estate keeps its homepage running; an acquirer's homepage gets listed as the dead company's website. So before anything is written, a candidate has to pass all five:</p>
  <table class="gates">
    <tr><th>Gate</th><th>The rule</th></tr>
    <tr><td>name</td><td>The domain has to be the company's own name or initials — no obituaries for a parent company's homepage.</td></tr>
    <tr><td>history</td><td>At least a substantial Wikipedia lead section, so there's a real story to tell.</td></tr>
    <tr><td>web</td><td>The company has to have lived on the web: a site, a service, a platform, software.</td></tr>
    <tr><td>corpse</td><td>The URL is checked live. Dark, hanging, erroring, blank, parked, redirected elsewhere, or taken over by strangers: dead. Still serving the company, or impossible to tell: <i>not</i> dead, and out.</td></tr>
    <tr><td>archive</td><td>At least a year's worth of monthly Wayback Machine captures — enough bones to examine.</td></tr>
  </table>

  <h2>What it won't do</h2>
  <p>It won't write a fact that isn't in its evidence file, cite a source it didn't fetch, or describe how any of this works inside the obituary itself. When the evidence runs out, the story stops — or the candidate is passed over. Every issue's full evidence file is public: add <code>/evidence</code> to any issue's address.</p>

  <h2>The machinery</h2>
  <p>A TypeScript state machine on <a href="https://www.val.town/">Val Town</a>, ticking every fifteen minutes and advancing one stage per tick so no run is ever long. Wikidata, Wikipedia, the Internet Archive, and RDAP supply the record; WordPress's mShots renders the archived pages; Claude writes and checks the copy. The Claude calls are the only part that costs anything — well under a dollar an issue.${repoUrl ? ` The source is on <a href="${repoUrl}">GitHub</a>.` : ""}</p>
</section>
${footer(baseUrl)}`;
  return shell({
    title: "How this is made — RIP · URL",
    description: "An automated obituary newsletter for dead websites, held to an archivist's rules: prove every fact, bury only what's actually dead.",
    baseUrl,
    body,
  });
}

export function noticePage(baseUrl: string, heading: string, message: string, extra = ""): string {
  return shell({
    title: `${heading} — RIP · URL`,
    description: message,
    baseUrl,
    body: `${masthead(baseUrl, "NOTICE")}
<section class="section">
  <div class="box">
    <p class="label">${esc(heading)}</p>
    <p class="standfirst" style="font-style:normal;font-size:17px;">${message}</p>
    ${extra}
  </div>
</section>
${footer(baseUrl)}`,
  });
}

export function rssFeed(baseUrl: string, issues: IssueSummary[]): string {
  const items = issues.map((i) => {
    const link = `${baseUrl}/issue/${i.n}`;
    const desc = i.obituary ? plain(i.obituary.legacy) : epithet(i.subject);
    return `  <item>
    <title>${esc(`No. ${i.n} — ${i.subject}`)}</title>
    <link>${link}</link>
    <guid isPermaLink="true">${link}</guid>
    <pubDate>${new Date(i.createdAt).toUTCString()}</pubDate>
    <description>${esc(desc)}</description>
  </item>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>RIP · URL</title>
  <link>${baseUrl}/</link>
  <description>A weekly obituary for dead &amp; dying domains.</description>
  <language>en-us</language>
${items}
</channel>
</rss>`;
}
