// The one mistake RIP·URL can't make is an obituary for a living URL.
// These tests fake what a domain answers and check the verdict, with no network.
import { assertEquals } from "jsr:@std/assert@1";
import { checkDomainToday, type DomainToday, isDead, nameTokens, registrable } from "../val/lib/liveness.ts";

type Reply = Response | Error;

// Replace fetch with a lookup table of URL -> reply for the length of one test.
async function withSite(routes: Record<string, () => Reply>, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    if (!route) return Promise.reject(new Error(`unexpected fetch: ${url}`));
    const reply = route();
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const page = (html: string, status = 200) => () => new Response(html, { status, headers: { "content-type": "text/html" } });
const redirect = (to: string, status = 301) => () => new Response(null, { status, headers: { location: to } });
const padding = "<p>" + "Lorem ipsum dolor sit amet. ".repeat(20) + "</p>";

async function verdictFor(routes: Record<string, () => Reply>, company = "Bomis"): Promise<DomainToday> {
  let result!: DomainToday;
  await withSite(routes, async () => {
    result = await checkDomainToday("bomis.com", company);
  });
  return result;
}

Deno.test("no DNS answer is dark", async () => {
  const t = await verdictFor({ "http://bomis.com/": () => new Error("dns error: failed to lookup address information") });
  assertEquals(t.verdict, "dark");
});

Deno.test("a hang on both http and https is unreachable", async () => {
  const t = await verdictFor({
    "http://bomis.com/": () => new Error("The signal has been aborted"),
    "https://bomis.com/": () => new Error("The signal has been aborted"),
  });
  assertEquals(t.verdict, "unreachable");
});

Deno.test("a hang on http but a live https site is judged on https", async () => {
  const t = await verdictFor({
    "http://bomis.com/": () => new Error("timed out"),
    "https://bomis.com/": page(`<title>Bomis</title>${padding}<p>Welcome to Bomis</p>`),
  });
  assertEquals(t.verdict, "alive");
});

Deno.test("404 and 410 are gone", async () => {
  for (const status of [404, 410]) {
    const t = await verdictFor({ "http://bomis.com/": page("", status) });
    assertEquals(t.verdict, "gone", `status ${status}`);
  }
});

Deno.test("a redirect to another domain is redirected, and records where it went", async () => {
  const t = await verdictFor({ "http://bomis.com/": redirect("https://www.acquirer.com/welcome") });
  assertEquals(t.verdict, "redirected");
  assertEquals(t.finalDomain, "acquirer.com");
});

Deno.test("a redirect within the same domain is followed", async () => {
  const t = await verdictFor({
    "http://bomis.com/": redirect("https://www.bomis.com/"),
    "https://www.bomis.com/": page(`<title>Bomis</title>${padding}<p>Bomis search</p>`),
  });
  assertEquals(t.verdict, "alive");
});

Deno.test("a meta refresh to another domain is redirected", async () => {
  const t = await verdictFor({
    "http://bomis.com/": page(`<meta http-equiv="refresh" content="0; url=https://spam.net/">`),
  });
  assertEquals(t.verdict, "redirected");
  assertEquals(t.finalDomain, "spam.net");
});

Deno.test("parking pages are parked, including JS /lander shells", async () => {
  for (const html of [
    `<title>bomis.com is for sale</title><p>This domain may be for sale. Make an offer on this domain.</p>`,
    `<script>window.location.href="/lander"</script>`,
    `<div data-adblockkey="MFww..."></div>`,
  ]) {
    const t = await verdictFor({ "http://bomis.com/": page(html) });
    assertEquals(t.verdict, "parked", html);
  }
});

Deno.test("an empty page with no title is blank", async () => {
  const t = await verdictFor({ "http://bomis.com/": page("<html><body></body></html>") });
  assertEquals(t.verdict, "blank");
});

Deno.test("a JS app shell whose title names the company counts as alive", async () => {
  const t = await verdictFor({ "http://bomis.com/": page(`<title>Bomis | Home</title><div id="root"></div><script src="/app.js"></script>`) });
  assertEquals(t.verdict, "alive");
});

Deno.test("a near-empty page that doesn't name the company is inconclusive, not dead", async () => {
  const t = await verdictFor({ "http://bomis.com/": page(`<title>Loading</title><script src="/app.js"></script>`) });
  assertEquals(t.verdict, "inconclusive");
});

Deno.test("a full page that never mentions the company is repurposed", async () => {
  const t = await verdictFor({ "http://bomis.com/": page(`<title>Best Casino Bonuses</title>${padding}`) });
  assertEquals(t.verdict, "repurposed");
});

Deno.test("a full page that still mentions the company is alive", async () => {
  const t = await verdictFor({ "http://bomis.com/": page(`<title>Home</title>${padding}<p>The Bomis archive</p>`) });
  assertEquals(t.verdict, "alive");
});

Deno.test("server errors and bot walls are inconclusive, not dead", async () => {
  for (const status of [403, 500, 503]) {
    const t = await verdictFor({ "http://bomis.com/": page("", status) });
    assertEquals(t.verdict, "inconclusive", `status ${status}`);
  }
});

Deno.test("endless redirects within the domain are inconclusive", async () => {
  const t = await verdictFor({
    "http://bomis.com/": redirect("http://bomis.com/a"),
    "http://bomis.com/a": redirect("http://bomis.com/b"),
    "http://bomis.com/b": redirect("http://bomis.com/a"),
  });
  assertEquals(t.verdict, "inconclusive");
});

Deno.test("only alive and inconclusive keep a site off the obituary list", () => {
  const verdicts = ["dark", "unreachable", "gone", "blank", "redirected", "parked", "repurposed", "alive", "inconclusive"] as const;
  const dead = verdicts.filter((verdict) => isDead({ verdict, checkedAt: "" }));
  assertEquals(dead, ["dark", "unreachable", "gone", "blank", "redirected", "parked", "repurposed"]);
});

Deno.test("registrable strips www and subdomains", () => {
  assertEquals(registrable("WWW.Bomis.com"), "bomis.com");
  assertEquals(registrable("search.bomis.com"), "bomis.com");
});

Deno.test("nameTokens keeps distinctive words and drops filler", () => {
  assertEquals(nameTokens("The Globe.com, Inc."), ["globe"]);
  assertEquals(nameTokens("Legend Entertainment Company"), ["legend"]);
});
