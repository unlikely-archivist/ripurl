// Stage 2 — Gather the evidence file for the chosen candidate.
// Everything the obituary is allowed to say comes from what this stage fetched.
//
// Sources (all free, all verified live 2026-07-14):
//   • Wikipedia action API — full lead section, plain text
//   • RDAP (rdap.org)     — who still pays to hold the domain, since when
//   • Wayback CDX          — first/last capture + screenshot pick
//   • Wikidata entity JSON — founding date (P571) when recorded

import type { Candidate, Evidence } from "./types.ts";

const UA = "RIPURL-newsletter/2.0 (montgomery.k.eryn@gmail.com; val.town cron)";

// The whole article body, minus the reference apparatus, capped for cost.
// Note: TextExtracts treats ANY exintro value (even "0") as true, and silently
// caps exchars at ~1,200 — the pilot issues were written from a single
// paragraph because of both. Neither parameter is sent now.
const MAX_ARTICLE_CHARS = 12_000;
const TAIL_SECTIONS = /\n==+\s*(See also|References|Notes|Further reading|External links|Bibliography|Sources)\s*==+[\s\S]*$/i;

async function fullExtract(title: string): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    titles: title,
    format: "json",
    formatversion: "2",
    redirects: "1",
  });
  const resp = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": UA },
  });
  if (!resp.ok) return "";
  const j = await resp.json();
  const text: string = (j.query?.pages?.[0]?.extract ?? "").replace(TAIL_SECTIONS, "").trim();
  if (text.length <= MAX_ARTICLE_CHARS) return text;
  // Cut at the last paragraph break before the cap so no sentence is half-quoted.
  const cut = text.lastIndexOf("\n", MAX_ARTICLE_CHARS);
  return text.slice(0, cut > MAX_ARTICLE_CHARS / 2 ? cut : MAX_ARTICLE_CHARS);
}

async function rdapLookup(domain: string) {
  try {
    const resp = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    if (!resp.ok) return { reachable: false };
    const j = await resp.json();
    const events: Record<string, string> = {};
    for (const e of j.events ?? []) events[e.eventAction] = e.eventDate;
    let registrar: string | undefined;
    for (const ent of j.entities ?? []) {
      if ((ent.roles ?? []).includes("registrar")) {
        registrar = ent.vcardArray?.[1]?.find((f: any[]) => f[0] === "fn")?.[3];
      }
    }
    return {
      reachable: true,
      registered: events["registration"],
      expires: events["expiration"],
      status: j.status ?? [],
      registrar,
    };
  } catch {
    return { reachable: false };
  }
}

async function foundedDate(qid: string): Promise<string | undefined> {
  try {
    const resp = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
      { headers: { "User-Agent": UA } },
    );
    if (!resp.ok) return undefined;
    const j = await resp.json();
    const claims = j.entities?.[qid]?.claims?.P571;
    const t = claims?.[0]?.mainsnak?.datavalue?.value?.time; // "+2003-01-01T00:00:00Z"
    return t ? t.replace(/^\+/, "").slice(0, 10) : undefined;
  } catch {
    return undefined;
  }
}

// Pick the screenshot capture: the archived homepage closest to the midpoint
// between first capture and dissolution — "the site in its prime". This is
// the deterministic stand-in for the local pipeline's human contact-sheet
// pick, and the known quality ceiling of the automated path.
async function pickScreenshot(c: Candidate) {
  const first = c.firstCapture!;
  const dissolvedStamp = `${c.dissolvedYear}0101000000`;
  const firstYear = parseInt(first.slice(0, 4), 10);
  const midYear = Math.min(
    Math.floor((firstYear + c.dissolvedYear) / 2),
    c.dissolvedYear - 1,
  );
  const target = `${Math.max(midYear, firstYear)}0601`;
  // CDX "closest" is more reliable than the availability API, which
  // intermittently returns nothing and silently dropped us to the fallback.
  try {
    const resp = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${c.domain}/&output=json&fl=timestamp,original` +
        `&filter=statuscode:200&filter=mimetype:text/html&closest=${target}&sort=closest&limit=1&to=${c.dissolvedYear}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) },
    );
    if (resp.ok) {
      const rows = await resp.json();
      const [timestamp, original] = rows?.[1] ?? [];
      if (timestamp && timestamp <= dissolvedStamp) {
        return { timestamp, sourceUrl: `http://web.archive.org/web/${timestamp}/${original}` };
      }
    }
  } catch { /* fall through */ }
  // Fallback: first capture (origin story beats nothing).
  return {
    timestamp: first,
    sourceUrl: `http://web.archive.org/web/${first}/http://${c.domain}/`,
  };
}

export async function gatherEvidence(c: Candidate): Promise<Evidence> {
  const extract = await fullExtract(c.wikipediaTitle);
  if (extract.length < 400) {
    throw new Error(`Evidence too thin for ${c.domain}: extract ${extract.length} chars`);
  }
  const rdap = await rdapLookup(c.domain);
  const founded = await foundedDate(c.qid);
  const shot = await pickScreenshot(c);
  return {
    candidate: c,
    wikipedia: {
      title: c.wikipediaTitle,
      url: c.wikipediaUrl,
      description: c.description ?? "",
      extract,
    },
    rdap,
    wayback: {
      firstCapture: c.firstCapture!,
      lastCapture: c.lastCapture!,
      monthsArchived: c.monthsArchived!,
      screenshotTimestamp: shot.timestamp,
      screenshotSourceUrl: shot.sourceUrl,
    },
    founded,
    gatheredAt: new Date().toISOString(),
  };
}
