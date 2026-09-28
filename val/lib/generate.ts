// Stages "generate" and "verify" — write the obituary, then fact-check it,
// via the Claude API. The ONLY stages that cost money (~$0.10–0.20/issue).
//
// Fabrication guards (the failure that killed the old vals, 2026-07-12):
//   1. The prompt contains ONLY evidence this pipeline fetched, and forbids
//      facts from anywhere else.
//   2. Escape hatch: the model must set insufficient_evidence=true rather
//      than pad thin material — the orchestrator then moves to a fallback
//      candidate instead of publishing filler.
//   3. Structured output (json_schema) — a malformed or un-rendered result
//      is impossible at the schema level.
//   4. Post-checks: domain appears in copy; sources only cite hosts the
//      evidence actually came from; no pipeline vocabulary leaks into prose.
//   5. Independent fact-check (factCheck): a separate call reads the draft
//      against the same evidence and lists every unsupported factual claim.
//      Any finding sends the draft back for a revision (added 2026-09-28
//      after the pilot's cranberries.com issue dated a "hiatus" the band
//      had long since ended).
//
// Model note: the writer runs without thinking (= off on Opus 4.8) to stay
// inside Val Town's per-run wall clock; the fact-checker uses adaptive
// thinking, because a missed claim costs more than a slower check.
// RIPURL_MODEL overrides the model for both calls.

import Anthropic from "npm:@anthropic-ai/sdk";
import { blob } from "https://esm.town/v/std/blob/main.ts";
import type { Evidence, Obituary } from "./types.ts";

const OBITUARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "insufficient_evidence",
    "domain",
    "subject_line",
    "prime_years",
    "category",
    "intro",
    "the_rise",
    "the_fall",
    "manner_of_death",
    "disposition",
    "legacy",
    "lineage",
    "sources",
    "screenshot_note",
    "x_post",
    "tumblr_post",
  ],
  properties: {
    insufficient_evidence: {
      type: "boolean",
      description:
        "Set true ONLY if the evidence cannot support an honest obituary; leave every other field as an empty string/array in that case.",
    },
    domain: { type: "string" },
    subject_line: {
      type: "string",
      description: 'Format: "In Loving Memory of <domain>: <darkly funny epithet>"',
    },
    prime_years: { type: "string", description: 'e.g. "2007–2009"' },
    category: { type: "string", description: 'e.g. "Social Music Streaming Network"' },
    intro: {
      type: "string",
      description:
        "Opening paragraph. May use <em>/<strong> sparingly. Sets the scene before the site existed.",
    },
    the_rise: { type: "string", description: "Narrative of the ascent — scenes, arc, specifics. HTML em/strong allowed." },
    the_fall: {
      type: "string",
      description:
        "Narrative of the death. Must diagnose the real cause, not just narrate events in order.",
    },
    manner_of_death: { type: "string", description: 'At most 8 words, e.g. "Acquired and shut down by MySpace, 2009"' },
    disposition: {
      type: "string",
      description:
        "At most 25 words: what the domain is doing now, from domain_today and the registration evidence. One sentence, sentence case.",
    },
    legacy: {
      type: "string",
      description:
        "The editorial standfirst: why this death matters beyond one company. Original copy, no quote marks.",
    },
    lineage: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["year", "label"],
        properties: { year: { type: "string" }, label: { type: "string" } },
      },
      description: "3–6 dated beats: founded → pivot(s) → peak → death. Dry chronology lives here, not in prose.",
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cite", "url"],
        properties: { cite: { type: "string" }, url: { type: "string" } },
      },
      description:
        "Academic-style citations. ONLY the Wikipedia article and the archived capture supplied in the evidence.",
    },
    screenshot_note: {
      type: "string",
      description:
        'One lowercase clause that completes the caption "<domain> in <year>, …" — what the reader sees in the attached capture.',
    },
    x_post: { type: "string", description: "Cross-post teaser for X, under 280 characters, link goes at the end as {URL}." },
    tumblr_post: {
      type: "string",
      description: "Cross-post for Tumblr: 2-3 sentences + a line of #tags. Link placeholder {URL}.",
    },
  },
} as const;

const FACT_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["unsupported_claims"],
  properties: {
    unsupported_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "problem", "verdict"],
        properties: {
          claim: { type: "string", description: "The draft's wording, quoted." },
          problem: { type: "string", description: "What the evidence says instead, or that it says nothing." },
          verdict: {
            type: "string",
            enum: ["contradicted", "unsupported", "ok"],
            description: "Your conclusion. Use ok if, on reflection, the evidence does support the claim.",
          },
        },
      },
    },
  },
} as const;

const VOICE = `You are the obituary writer for RIP · URL, a weekly publication by Unlikely Archive that
performs autopsies on dead domain names. Voice: darkly funny, elegiac, archival — an obituary
writer with taste, not a content marketer.

Hard rules:
- Story, not fact-dump. Push dry chronology into the lineage timeline; use the_rise/the_fall for
  narrative — scenes, arc, specifics.
- Analyze the why and why-it-matters. the_fall and legacy must diagnose the real cause of death
  and say what the story means beyond one company.
- No pipeline language. Never describe how anything was found, matched, scored, or verified.
  Never mention Wikidata, RDAP, CDX, SPARQL, databases, or automation. Citing Wikipedia or the
  Internet Archive by name in a source citation is fine.
- EVIDENCE ONLY. Every factual claim must come from the evidence block in the user message.
  If the evidence doesn't say it, you don't write it. No dates, numbers, names, or events from
  memory. If the evidence is too thin for an honest obituary, set insufficient_evidence=true.
- Superlatives are facts. "Largest", "first", "only", "most", "biggest" and the like appear only if
  the evidence says so in those terms.
- The ending must match the evidence. If the article says the company was revived, reunited,
  or lives on under a new owner, the obituary says so — never bury something that isn't dead.
- Match the register of the exemplar below (an imeem.com obituary) — its warmth, rhythm, and bite.
  Do NOT reuse its phrases or sentence frames ("Before a single…", "for a few bright years it was
  the sound of…", "the ghost that walked so…"). Every issue finds its own opening and its own ending.
  intro: "Before a single green Spotify icon existed, there was a website where you could type in
  almost any song and hear it, in full, for free... It was called imeem, and for a few bright
  years it was <em>the sound of the social web.</em>"
  legacy: "imeem was right about everything except how to pay for it... imeem is the ghost that
  walked so Spotify could run."`;

const CHECKER = `You are the fact-checker for an obituary newsletter about dead websites. You receive an
evidence file and a draft. List every FACTUAL claim in the draft that the evidence does not
support: dates, years, numbers, names, places, products, events, causes stated as fact, and any
claim about what happened after the evidence's story ends. Superlatives ("largest", "first",
"only", "most") are factual claims too — list any the evidence doesn't state. A claim that
contradicts the evidence is the worst kind — always list it.

Do NOT list: opinion, metaphor, jokes, rhetorical framing, or interpretation that is clearly the
writer's voice rather than a fact ("it was the sound of the social web"). Do not list claims that
paraphrase the evidence faithfully. The attached screenshot is evidence too: a description of
what is visible in it is supported. Only list claims you conclude are unsupported or wrong —
never list a claim just to say it checks out. If everything checks out, return an empty list.`;

class InsufficientEvidenceError extends Error {}
export { InsufficientEvidenceError };

const BANNED_IN_PROSE = /\b(Wikidata|RDAP|CDX|SPARQL|pipeline|automated|auto-generated)\b/i;

function client(): { client: Anthropic; model: string } {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in the Val Town environment-variables UI — the pipeline cannot write copy without it.",
    );
  }
  return { client: new Anthropic({ apiKey }), model: Deno.env.get("RIPURL_MODEL") ?? "claude-opus-4-8" };
}

// What a visitor gets at the URL today, in plain words for the writer.
function describeToday(evidence: Evidence): string {
  const t = evidence.candidate.today;
  if (!t) return "not checked";
  switch (t.verdict) {
    case "dark": return "the domain no longer resolves — nothing answers at all";
    case "unreachable": return "the server never answers; the page just hangs";
    case "gone": return `the server answers with an error page (HTTP ${t.status})`;
    case "blank": return "the server answers with a completely empty page";
    case "redirected": return `visitors are sent to ${t.finalDomain}`;
    case "parked": return "a domain-parking page (ads / for-sale placeholder)";
    case "repurposed": return `an unrelated website${t.title ? ` titled "${t.title}"` : ""}`;
    default: return t.verdict;
  }
}

function evidenceBlock(evidence: Evidence) {
  const c = evidence.candidate;
  return {
    company: c.company,
    domain: c.domain,
    founded: evidence.founded ?? "not recorded",
    dissolved: c.dissolvedDate,
    wikipedia_description: evidence.wikipedia.description,
    wikipedia_article_text: evidence.wikipedia.extract,
    wikipedia_article_url: evidence.wikipedia.url,
    domain_today: describeToday(evidence),
    domain_registration: evidence.rdap.reachable
      ? {
        registered: evidence.rdap.registered,
        paid_up_until: evidence.rdap.expires,
        registrar: evidence.rdap.registrar ?? "unknown",
        status_flags: evidence.rdap.status,
      }
      : "domain no longer registered (RDAP lookup found nothing)",
    archive_record: {
      first_capture: evidence.wayback.firstCapture,
      last_capture: evidence.wayback.lastCapture,
      months_with_captures: evidence.wayback.monthsArchived,
      screenshot_capture_timestamp: evidence.wayback.screenshotTimestamp,
      screenshot_archived_page: evidence.wayback.screenshotSourceUrl,
    },
  };
}

// The archived screenshot, so screenshot_note describes what's actually in it.
async function screenshotBlock(domain: string) {
  try {
    const bytes = new Uint8Array(await (await blob.get(`img:${domain}`)).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return [{ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: btoa(s) } }];
  } catch {
    return []; // no stored screenshot: the text-only evidence still stands
  }
}

const SCREENSHOT_NOTE =
  "\n\nThe attached image is the archived capture listed as screenshot_capture_timestamp. " +
  "screenshot_note must describe only what is visible in it.";

function textOf(response: any, domain: string): string {
  if (response.stop_reason === "refusal") throw new InsufficientEvidenceError(`model refused for ${domain}`);
  if (response.stop_reason === "max_tokens") throw new Error("model response truncated at max_tokens");
  const text = response.content.find((b: any) => b.type === "text")?.text;
  if (!text) throw new Error("no text block in model response");
  return text;
}

// For a revision, pass the rejected draft and the fact-checker's findings.
// Revisions are surgical — rewriting from scratch fixes the flagged claims
// but invents new ones, and the loop never converges.
export async function writeObituary(
  evidence: Evidence,
  feedback?: string[],
  previous?: Obituary,
): Promise<{ obituary: Obituary; model: string }> {
  const { client: api, model } = client();
  const c = evidence.candidate;
  const revision = feedback?.length && previous
    ? `\n\nREVISION. Here is your previous draft:\n${JSON.stringify(previous, null, 2)}\n\n` +
      `A fact-checker flagged these claims as unsupported by the evidence:\n- ${feedback.join("\n- ")}\n\n` +
      `Return the same draft with ONLY those claims fixed — cut each one, or replace it with what the ` +
      `evidence actually says. Leave every other sentence exactly as it is.`
    : "";

  const response = await api.messages.create({
    model,
    max_tokens: 8000,
    system: VOICE,
    output_config: { format: { type: "json_schema", schema: OBITUARY_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          ...(await screenshotBlock(c.domain)),
          {
            type: "text",
            text: `Write this week's obituary. Evidence file (the ONLY permitted source of facts):\n\n` +
              JSON.stringify(evidenceBlock(evidence), null, 2) + SCREENSHOT_NOTE + revision,
          },
        ],
      },
    ],
  });
  const ob = JSON.parse(textOf(response, c.domain)) as Obituary;

  if (ob.insufficient_evidence) {
    throw new InsufficientEvidenceError(`model judged evidence too thin for ${c.domain}`);
  }

  // Post-checks — fail loudly rather than publish a defective issue.
  const prose = [ob.intro, ob.the_rise, ob.the_fall, ob.legacy].join(" ");
  if (!prose.toLowerCase().includes(c.domain.split(".")[0].toLowerCase())) {
    throw new Error(`obituary never mentions ${c.domain}`);
  }
  if (BANNED_IN_PROSE.test(prose)) {
    throw new Error("pipeline language leaked into prose");
  }
  for (const s of ob.sources) {
    const host = new URL(s.url).hostname;
    if (!["en.wikipedia.org", "web.archive.org", "www.wikipedia.org"].includes(host)) {
      throw new Error(`source cites unapproved host: ${host}`);
    }
  }
  const required = [ob.subject_line, ob.intro, ob.the_rise, ob.the_fall, ob.legacy, ob.manner_of_death, ob.disposition];
  if (required.some((f) => !f || f.trim().length < 20)) {
    throw new Error("a required obituary field is missing or too short");
  }
  ob.domain = c.domain; // never trust the echo
  // The archive citation is built from the evidence, never from the model:
  // it must name the exact capture the reader is looking at.
  const ts = evidence.wayback.screenshotTimestamp;
  const captured = new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8)))
    .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  ob.sources = [
    ...ob.sources.filter((s) => new URL(s.url).hostname !== "web.archive.org"),
    { cite: `Internet Archive, Wayback Machine capture of ${c.domain}, ${captured}.`, url: evidence.wayback.screenshotSourceUrl },
  ];
  return { obituary: ob, model };
}

// Returns the unsupported claims, formatted as revision notes. Empty = passes.
export async function factCheck(evidence: Evidence, ob: Obituary): Promise<string[]> {
  const { client: api, model } = client();
  const draft = {
    subject_line: ob.subject_line,
    category: ob.category,
    prime_years: ob.prime_years,
    manner_of_death: ob.manner_of_death,
    disposition: ob.disposition,
    intro: ob.intro,
    the_rise: ob.the_rise,
    the_fall: ob.the_fall,
    legacy: ob.legacy,
    lineage: ob.lineage,
    screenshot_note: ob.screenshot_note,
  };
  const response = await api.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" }, // careful reading matters more here than speed
    system: CHECKER,
    output_config: { format: { type: "json_schema", schema: FACT_CHECK_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          ...(await screenshotBlock(evidence.candidate.domain)),
          {
            type: "text",
            text: `EVIDENCE:\n${JSON.stringify(evidenceBlock(evidence), null, 2)}\n\nDRAFT:\n${JSON.stringify(draft, null, 2)}`,
          },
        ],
      },
    ],
  });
  const { unsupported_claims } = JSON.parse(textOf(response, evidence.candidate.domain)) as {
    unsupported_claims: { claim: string; problem: string; verdict: "contradicted" | "unsupported" | "ok" }[];
  };
  // The checker sometimes talks itself out of a finding mid-list; the verdict
  // field lets it say so, and only real findings count.
  return unsupported_claims
    .filter((u) => u.verdict !== "ok")
    .map((u) => `"${u.claim}" — ${u.problem}`);
}
