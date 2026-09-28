// Stage 1 — Discover candidates (two stages: "discover" then "vet").
//
// Source: Wikidata SPARQL. We ask for entities with a recorded dissolution
// date (P576), an official website (P856), and an English Wikipedia article.
//
// A recorded dissolution proves the COMPANY died, not the URL. The pilot run
// (issues 1–11, retired 2026-09-28) published obituaries for oracle.com (listed
// as JD Edwards' website), cranberries.com (a band's live site) and saban.com
// (still Saban Capital) — so candidates now pass five hard gates, cheapest first:
//   discover (one tick, cheap, whole pool):
//     1. name gate     — the domain must be the company's own name or initials
//     2. history gate  — Wikipedia lead section ≥ 600 chars
//     3. web gate      — the company must be web-native (site, service, software…)
//   vet (a batch per tick, slow network checks):
//     4. corpse gate   — the URL must be dead TODAY (lib/liveness.ts); unclear = out
//     5. archive gate  — ≥ 12 distinct months in the Wayback Machine
//
// Scoring (deterministic, inspectable — tune the weights here):
//   archive depth   3.0 × min(monthsArchived, 120) / 120
//   story length    2.0 × min(lead chars, 3000) / 3000
//   recency         2.0 × max(0, 1 − yearsSinceDeath / 15)
//   dot-com-ness    2.0 if the description says website/online/internet/portal…
//   short domain    1.0 × (domains ≤ 12 chars read better in a headline)

import type { Candidate } from "./types.ts";
import { usedDomains } from "./state.ts";
import { checkDomainToday, isDead, nameTokens } from "./liveness.ts";

const UA = "RIPURL-newsletter/2.0 (montgomery.k.eryn@gmail.com; val.town cron)";
const SPARQL = `SELECT DISTINCT ?company ?companyLabel ?website ?dissolved ?article WHERE {
  ?company wdt:P576 ?dissolved ;
           wdt:P856 ?website .
  ?article schema:about ?company ;
           schema:isPartOf <https://en.wikipedia.org/> .
  FILTER(YEAR(?dissolved) >= 1998)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1500`;

// Web gate: the company's reason to exist ran through its URL (or its software).
const WEB_NATIVE = /\b(website|web ?site|web portal|online|internet|dot-?com|e-?commerce|streaming|social network|social media|mobile app|platform|search engine|portal|web forum|blog|browser|web hosting|video game|software|startup)\b/i;
// Dot-com-ness: the stronger, score-only version.
const DOT_COM = /\b(website|web ?site|online|internet|dot-?com|e-?commerce|streaming|social network|search engine|portal)\b/i;
const OK_TLD = /\.(com|net|org|tv|fm|io|co)$/;
const MIN_LEAD = 600;
const VET_BATCH = 10; // candidates checked per tick
const WANT = 4; // winner + fallbacks

function domainFromUrl(url: string): string {
  try {
    let host = new URL(url).hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return "";
  }
}

// Name gate: "legendent.com" ~ Legend Entertainment, "iup.com" ~ International
// Universities Press, "oracle.com" ≁ JD Edwards.
export function domainMatchesName(domain: string, company: string): boolean {
  const root = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  if (root.length < 2) return false;
  const words = company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const compact = words.join("");
  if (compact.includes(root)) return true;
  if (nameTokens(company).some((t) => t.length >= 4 && root.includes(t))) return true;
  const small = new Set(["of", "for", "and", "the", "a", "an", "de", "inc", "llc", "ltd", "co", "corp"]);
  const initials = words.filter((w) => !small.has(w)).map((w) => w[0]).join("");
  const allInitials = words.map((w) => w[0]).join("");
  return root === initials || root === allInitials;
}

export async function fetchRawCandidates(): Promise<Candidate[]> {
  const params = new URLSearchParams({ query: SPARQL, format: "json" });
  const resp = await fetch(`https://query.wikidata.org/sparql?${params}`, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
  });
  if (!resp.ok) throw new Error(`Wikidata SPARQL ${resp.status}`);
  const json = await resp.json();
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const b of json.results.bindings) {
    const domain = domainFromUrl(b.website.value);
    const qid = b.company.value.split("/").pop();
    const label = b.companyLabel?.value ?? "";
    if (!domain || seen.has(domain)) continue;
    if (!label || label === qid) continue; // no English label
    if (!OK_TLD.test(domain)) continue;
    if (domain.split(".").length > 2) continue; // subdomain of someone else's site
    seen.add(domain);
    const dissolved = b.dissolved.value.slice(0, 10);
    const articleUrl = b.article.value;
    out.push({
      company: label,
      qid,
      domain,
      website: b.website.value,
      dissolvedDate: dissolved,
      dissolvedYear: parseInt(dissolved.slice(0, 4), 10),
      wikipediaTitle: decodeURIComponent(articleUrl.split("/wiki/").pop() ?? "").replaceAll("_", " "),
      wikipediaUrl: articleUrl,
    });
  }
  return out;
}

// Lead section + short description for up to 20 titles in one request.
async function wikipediaLeads(titles: string[]): Promise<Map<string, { extract: string; description: string }>> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts|description",
    exintro: "1",
    explaintext: "1",
    exlimit: "20",
    titles: titles.join("|"),
    redirects: "1",
    format: "json",
    formatversion: "2",
  });
  const out = new Map<string, { extract: string; description: string }>();
  const resp = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA } });
  if (!resp.ok) return out;
  const q = (await resp.json()).query ?? {};
  // Map each requested title through normalization/redirects to the page it landed on.
  const alias = new Map<string, string>();
  for (const n of q.normalized ?? []) alias.set(n.from, n.to);
  for (const r of q.redirects ?? []) alias.set(r.from, r.to);
  const pages = new Map<string, any>((q.pages ?? []).map((p: any) => [p.title, p]));
  for (const t of titles) {
    let key = t;
    for (let i = 0; i < 3 && alias.has(key); i++) key = alias.get(key)!;
    const p = pages.get(key);
    if (p && !p.missing) out.set(t, { extract: p.extract ?? "", description: p.description ?? "" });
  }
  return out;
}

async function waybackDepth(domain: string) {
  // collapse=timestamp:6 → one row per distinct YYYYMM with a capture.
  const resp = await fetch(
    `https://web.archive.org/cdx/search/cdx?url=${domain}&output=json&fl=timestamp&filter=statuscode:200&collapse=timestamp:6&limit=500`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const stamps = rows.slice(1).map((r: string[]) => r[0]);
  return {
    monthsArchived: stamps.length,
    firstCapture: stamps[0],
    lastCapture: stamps[stamps.length - 1],
  };
}

export function scoreCandidate(c: Candidate): number {
  const months = c.monthsArchived ?? 0;
  const chars = (c.extract ?? "").length;
  const yearsDead = new Date().getFullYear() - c.dissolvedYear;
  const dotCom = DOT_COM.test(`${c.description} ${c.extract?.slice(0, 600)}`) ? 2 : 0;
  const shortName = c.domain.length <= 12 ? 1 : 0;
  return (
    3 * Math.min(months, 120) / 120 +
    2 * Math.min(chars, 3000) / 3000 +
    2 * Math.max(0, 1 - yearsDead / 15) +
    dotCom +
    shortName
  );
}

// Stage "discover": gates 1–3 over the whole pool. Returns candidates still to
// vet, strongest story first (dot-com-ness, then lead length) so the slow
// checks are spent where the best obituaries are.
export async function buildPool(): Promise<Candidate[]> {
  const used = await usedDomains();
  const named = (await fetchRawCandidates())
    .filter((c) => !used.has(c.domain) && domainMatchesName(c.domain, c.company));
  if (named.length === 0) throw new Error("Wikidata returned no unused, name-matched candidates");

  const pool: Candidate[] = [];
  for (let i = 0; i < named.length; i += 20 * 4) {
    const chunks = [0, 1, 2, 3].map((k) => named.slice(i + k * 20, i + (k + 1) * 20)).filter((c) => c.length);
    const leads = await Promise.all(chunks.map((ch) => wikipediaLeads(ch.map((c) => c.wikipediaTitle))));
    chunks.forEach((ch, k) => {
      for (const c of ch) {
        const w = leads[k].get(c.wikipediaTitle);
        if (!w || w.extract.length < MIN_LEAD) continue;
        if (!WEB_NATIVE.test(`${w.description} ${w.extract.slice(0, 600)}`)) continue;
        c.extract = w.extract;
        c.description = w.description;
        pool.push(c);
      }
    });
  }
  if (pool.length === 0) throw new Error(`No candidate passed name/history/web gates (of ${named.length})`);
  const prelim = (c: Candidate) => (DOT_COM.test(`${c.description} ${c.extract!.slice(0, 600)}`) ? 10_000 : 0) + c.extract!.length;
  return pool.sort((a, b) => prelim(b) - prelim(a));
}

// Gates 4–5 for one candidate. Returns null if either fails.
async function vetOne(c: Candidate): Promise<Candidate | null> {
  try {
    const today = await checkDomainToday(c.domain, c.company);
    if (!isDead(today)) return null;
    c.today = today;
    const wb = await waybackDepth(c.domain);
    if (!wb || wb.monthsArchived < 12) return null;
    c.monthsArchived = wb.monthsArchived;
    c.firstCapture = wb.firstCapture;
    c.lastCapture = wb.lastCapture;
    c.score = scoreCandidate(c);
    return c;
  } catch {
    return null; // a flaky source disqualifies the candidate, not the run
  }
}

// Stage "vet": check the next batch from the pool. Mutates both lists;
// returns true once there are enough finalists (or the pool is exhausted).
export async function vetBatch(pool: Candidate[], finalists: Candidate[]): Promise<boolean> {
  const batch = pool.splice(0, VET_BATCH);
  const results = await Promise.all(batch.map(vetOne));
  for (const r of results) if (r) finalists.push(r);
  finalists.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return finalists.length >= WANT || pool.length === 0;
}
