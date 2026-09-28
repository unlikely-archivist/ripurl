// Is the domain actually dead TODAY? A recorded dissolution only proves the
// company died — its URL may still be alive (a band's site kept by the estate,
// an acquirer's own homepage listed as the dead company's website). An
// obituary for a living URL is the one mistake this publication can't make.
//
// Verdicts:
//   dark        — no DNS / connection refused: nothing answers anymore
//   unreachable — both http and https hang until timeout
//   gone        — the server answers 404/410
//   blank       — the server answers with an empty page and no title
//   redirected  — sends visitors to a different domain (absorbed, sold, spam)
//   parked      — a for-sale / parking page (incl. JS "/lander" parking shells)
//   repurposed  — serves a page that no longer mentions the company
//   alive       — still the company's (or its successor's) own site  → reject
//   inconclusive— bot wall, 5xx, JS shell we can't read               → reject
//
// Only "alive" and "inconclusive" disqualify. Everything else is a corpse,
// and the verdict itself becomes evidence ("what the URL does today").

export type Verdict =
  | "dark"
  | "unreachable"
  | "gone"
  | "blank"
  | "redirected"
  | "parked"
  | "repurposed"
  | "alive"
  | "inconclusive";

export interface DomainToday {
  verdict: Verdict;
  checkedAt: string;
  status?: number;
  finalUrl?: string; // where a visitor ends up
  finalDomain?: string;
  title?: string;
  detail?: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Matched against the raw HTML, so parking-provider markup counts too.
const PARKED =
  /domain (name )?(is|may be) for sale|buy this domain|this domain is parked|parked free|domain parking|make an offer on this domain|inquire about this domain|resources and information\.?<\/title>|sedoparking|parkingcrew|bodis\.com|afternic|hugedomains|dan\.com\/|undeveloped\.com|data-adblockkey|location\.href\s*=\s*["']\/lander/i;

// Last two labels — good enough because discovery only admits .com/.net/.org/etc.
export function registrable(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join(".");
}

// Distinctive words of the company name, for "does this page still mention it?"
export function nameTokens(company: string): string[] {
  const stop = new Set(["the", "inc", "llc", "ltd", "corp", "corporation", "company", "co", "group", "entertainment", "studios", "studio", "media", "network", "networks", "online", "com", "net", "org"]);
  return company.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
}

function metaRefresh(html: string): string | undefined {
  const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
  return m?.[1];
}

function titleOf(html: string): string | undefined {
  return html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim() || undefined;
}

async function fetchStep(url: string): Promise<Response> {
  return await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    signal: AbortSignal.timeout(12_000),
  });
}

const isTimeout = (msg: string) => /timed? ?out|aborted/i.test(msg);
const isDnsOrRefused = (msg: string) =>
  /dns|lookup|name or service|no address|nodename|NXDOMAIN|connection refused|ECONNREFUSED/i.test(msg);

export async function checkDomainToday(domain: string, company: string): Promise<DomainToday> {
  const first = await follow(`http://${domain}/`, domain, company);
  // Some servers only answer on 443; a hang on both schemes means nobody's home.
  if (first.verdict === "inconclusive" && first.detail && isTimeout(first.detail)) {
    const second = await follow(`https://${domain}/`, domain, company);
    if (second.verdict === "inconclusive" && second.detail && isTimeout(second.detail)) {
      return { ...second, verdict: "unreachable" };
    }
    return second;
  }
  return first;
}

async function follow(startUrl: string, domain: string, company: string): Promise<DomainToday> {
  const checkedAt = new Date().toISOString();
  const home = registrable(domain);
  let url = startUrl;

  for (let hop = 0; hop < 6; hop++) {
    let resp: Response;
    try {
      resp = await fetchStep(url);
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (isDnsOrRefused(msg)) return { verdict: "dark", checkedAt, detail: msg.slice(0, 160) };
      return { verdict: "inconclusive", checkedAt, detail: msg.slice(0, 160) };
    }

    const loc = resp.headers.get("location");
    if (resp.status >= 300 && resp.status < 400 && loc) {
      await resp.body?.cancel();
      url = new URL(loc, url).toString();
      if (registrable(new URL(url).hostname) !== home) {
        return { verdict: "redirected", checkedAt, status: resp.status, finalUrl: url, finalDomain: registrable(new URL(url).hostname) };
      }
      continue;
    }

    if (resp.status === 404 || resp.status === 410) {
      await resp.body?.cancel();
      return { verdict: "gone", checkedAt, status: resp.status, finalUrl: url };
    }
    if (resp.status !== 200) {
      await resp.body?.cancel();
      return { verdict: "inconclusive", checkedAt, status: resp.status, finalUrl: url };
    }

    const html = (await resp.text()).slice(0, 200_000);
    if (PARKED.test(html)) return { verdict: "parked", checkedAt, status: 200, finalUrl: url, title: titleOf(html) };
    const refresh = metaRefresh(html);
    if (refresh) {
      const next = new URL(refresh, url).toString();
      if (registrable(new URL(next).hostname) !== home) {
        return { verdict: "redirected", checkedAt, status: 200, finalUrl: next, finalDomain: registrable(new URL(next).hostname), detail: "meta refresh" };
      }
      url = next;
      continue;
    }

    const title = titleOf(html);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    const mentions = (s: string) => nameTokens(company).some((t) => s.toLowerCase().includes(t));
    if (text.replace(/\s+/g, "").length < 200) {
      if (!title && !/<script/i.test(html)) return { verdict: "blank", checkedAt, status: 200, finalUrl: url };
      // A JS app shell: the title is all we can read. Naming the company = alive.
      if (title && mentions(title)) return { verdict: "alive", checkedAt, status: 200, finalUrl: url, title, detail: "app shell" };
      return { verdict: "inconclusive", checkedAt, status: 200, finalUrl: url, title, detail: "near-empty page" };
    }
    return { verdict: mentions(text) ? "alive" : "repurposed", checkedAt, status: 200, finalUrl: url, title };
  }
  return { verdict: "inconclusive", checkedAt, detail: "too many redirects" };
}

export function isDead(t: DomainToday): boolean {
  return t.verdict !== "alive" && t.verdict !== "inconclusive";
}
