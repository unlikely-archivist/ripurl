// Stage "assemble_send" — render an issue as HTML.
//
// Design (2026-09-28 redesign): a single 600px column that reads like an
// obituary page, not a dashboard — hairline rules instead of boxes, left-
// aligned serif text, small-caps labels, one accent colour. Newspaper-obit
// conventions carry the structure: name and dates, a vital record (born, died,
// cause of death, resting place), then Life, Death, and Legacy.
//
// Email-safe: tables + inline styles, one column (so phones need no layout
// changes), a hidden preheader for the inbox preview line. Because this is a
// plain function, an un-rendered template cannot ship — a render guard still
// refuses output containing template syntax.

import type { Evidence, Obituary } from "./types.ts";
import { UNSUBSCRIBE_SENTINEL } from "./deliver.ts";

const INK = "#1f1d1a";
const MUTED = "#6b665e";
const RULE = "#dcd6cb";
const RED = "#9e2a2b";
const SHEET = "#fbfaf7";
const PAGE = "#ece8e1";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Obituary prose is allowed a small HTML vocabulary; everything else is escaped.
function proseHtml(s: string): string {
  return esc(s)
    .replaceAll("&lt;em&gt;", "<em>").replaceAll("&lt;/em&gt;", "</em>")
    .replaceAll("&lt;strong&gt;", "<strong>").replaceAll("&lt;/strong&gt;", "</strong>");
}

// Link bare mentions only — not "office.bomis.com" or "bomis.com/about".
function linkDomain(html: string, domain: string): string {
  const pattern = new RegExp(`(?<![\\w./-])${domain.replaceAll(".", "\\.")}(?![\\w/-]|\\.\\w)`, "g");
  return html.replace(pattern, `<a href="https://${domain}" style="color:${INK};">${domain}</a>`);
}

// The caption reads "<domain> in <year>, <note>." — keep the note lowercase-led.
export function captionClause(note: string): string {
  return note.replace(/\.+$/, "").replace(/^(A|An|The|This|Its)\b/, (w) => w.toLowerCase());
}

const RESPONSIVE = `<style>
  @media (max-width: 640px) {
    .rip-outer { padding: 0 !important; }
    .rip-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .rip-name { font-size: 34px !important; }
    .rip-record td { display: block !important; width: auto !important; }
    .rip-record .rip-label { padding-bottom: 0 !important; border-top: 1px solid ${RULE} !important; }
    .rip-record .rip-value { border-top: 0 !important; padding-top: 2px !important; }
  }
</style>`;

export interface AssembleInput {
  obituary: Obituary;
  evidence: Evidence;
  issueNumber: number;
  baseUrl: string; // this val's public HTTP endpoint, e.g. https://ripurl.val.run
  publishedAt?: string; // ISO; defaults to now (set when re-rendering a past issue)
}

export interface AssembledIssue {
  ownerHtml: string; // the owner copy: issue + cross-post kit
  subscriberHtml: string; // issue with UNSUBSCRIBE_SENTINEL to personalize
  webHtml: string; // permanent archive page
}

export function assembleIssue(input: AssembleInput): AssembledIssue {
  const { obituary: ob, evidence, issueNumber, baseUrl } = input;
  const domain = ob.domain;
  const imgUrl = `${baseUrl}/img/${domain}`;
  const issueUrl = `${baseUrl}/issue/${issueNumber}`;
  const shotYear = evidence.wayback.screenshotTimestamp.slice(0, 4);
  const date = new Date(input.publishedAt ?? Date.now()).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const born = evidence.founded?.slice(0, 4);
  const died = evidence.candidate.dissolvedDate.slice(0, 4);
  const epithet = ob.subject_line.replace(/^In Loving Memory of [^:]+:\s*/i, "");

  const para = (html: string, extra = "") =>
    `<p style="margin:0 0 18px 0; font-family:${SERIF}; font-size:17px; line-height:1.7; color:${INK};${extra}">${html}</p>`;
  const label = (text: string) =>
    `<p style="margin:34px 0 12px 0; font-family:${SERIF}; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:${RED};">${text}</p>`;
  const rule = `<tr><td class="rip-pad" style="padding:0 48px;"><div style="border-top:1px solid ${RULE}; height:1px; line-height:1px; font-size:1px;">&nbsp;</div></td></tr>`;

  const intro = linkDomain(proseHtml(ob.intro), domain);
  const lede = para(
    `<span style="float:left; font-size:62px; line-height:52px; padding:6px 10px 0 0; color:${RED};">${intro.charAt(0)}</span>${intro.slice(1)}`,
    " font-size:18px;",
  );

  const record: [string, string][] = [
    ...(born ? [["Born", born] as [string, string]] : []),
    ["Died", died],
    ["In its prime", esc(ob.prime_years)],
    ["Cause of death", esc(ob.manner_of_death)],
    ["Resting place", esc(ob.disposition)],
    ["Remembered by", `${evidence.wayback.monthsArchived} months of Internet Archive captures`],
  ];
  const recordRows = record.map(([k, v], i) => `
      <tr>
        <td class="rip-label" width="130" valign="top" style="padding:10px 16px 10px 0; font-family:${SERIF}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${MUTED};${i ? ` border-top:1px solid ${RULE};` : ""}">${k}</td>
        <td class="rip-value" valign="top" style="padding:9px 0; font-family:${SERIF}; font-size:15px; line-height:1.5; color:${INK};${i ? ` border-top:1px solid ${RULE};` : ""}">${v}</td>
      </tr>`).join("");

  const timeline = ob.lineage.map((s) => `
      <tr>
        <td width="64" valign="top" style="padding:7px 12px 7px 0; font-family:${SERIF}; font-size:14px; font-weight:bold; color:${RED};">${esc(s.year)}</td>
        <td valign="top" style="padding:7px 0; font-family:${SERIF}; font-size:15px; line-height:1.5; color:${INK};">${esc(s.label)}</td>
      </tr>`).join("");

  const sources = ob.sources.map((s) =>
    `<p style="margin:0 0 6px 0; font-family:${SERIF}; font-size:13px; line-height:1.5; color:${MUTED};"><a href="${esc(s.url)}" style="color:${MUTED};">${proseHtml(s.cite)}</a></p>`
  ).join("");

  const link = (href: string, text: string) => `<a href="${href}" style="color:${MUTED};">${text}</a>`;
  const dot = "&nbsp;&nbsp;·&nbsp;&nbsp;";

  const issue = (footerLinks: string) => `
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background-color:${SHEET};">
    <!-- masthead -->
    <tr><td class="rip-pad" align="center" style="padding:36px 48px 22px 48px;">
      <a href="${baseUrl}/" style="font-family:${SERIF}; font-size:26px; font-weight:bold; letter-spacing:2px; color:${INK}; text-decoration:none;"><span style="color:${RED};">RIP</span> · URL</a>
      <p style="margin:8px 0 0 0; font-family:${SERIF}; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:${MUTED};">No.&nbsp;${issueNumber} &nbsp;·&nbsp; ${date}</p>
    </td></tr>
    ${rule}

    <!-- name and dates -->
    <tr><td class="rip-pad" align="center" style="padding:40px 48px 8px 48px;">
      <p style="margin:0 0 14px 0; font-family:${SERIF}; font-size:11px; letter-spacing:4px; text-transform:uppercase; color:${RED};">In loving memory of</p>
      <h1 class="rip-name" style="margin:0; font-family:${SERIF}; font-size:44px; font-weight:normal; line-height:1.1; color:${INK}; word-break:break-word;">${domain}</h1>
      <p style="margin:12px 0 0 0; font-family:${SERIF}; font-size:16px; letter-spacing:3px; color:${MUTED};">${born ? `${born} &ndash; ${died}` : `d. ${died}`}</p>
      <p style="margin:18px 0 0 0; font-family:${SERIF}; font-size:20px; font-style:italic; line-height:1.4; color:${INK};">${esc(epithet)}</p>
    </td></tr>

    <!-- the site as it was -->
    <tr><td class="rip-pad" style="padding:32px 48px 0 48px;">
      <img src="${imgUrl}" alt="${domain} as archived in ${shotYear}" width="504" style="display:block; width:100%; max-width:504px; height:auto; margin:0 auto; border:1px solid ${RULE};">
      <p style="margin:10px 0 0 0; font-family:${SERIF}; font-size:13px; font-style:italic; line-height:1.5; color:${MUTED}; text-align:center;">${domain} in ${shotYear}, ${proseHtml(captionClause(ob.screenshot_note))}.</p>
    </td></tr>

    <!-- obituary -->
    <tr><td class="rip-pad" style="padding:36px 48px 0 48px;">
      ${lede}
      <table role="presentation" class="rip-record" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 8px 0; border-top:1px solid ${INK}; border-bottom:1px solid ${INK};">${recordRows}
      </table>
      ${label("Life")}
      ${para(linkDomain(proseHtml(ob.the_rise), domain))}
      ${label("Death")}
      ${para(linkDomain(proseHtml(ob.the_fall), domain))}
      ${ob.lineage.length ? `${label("How it got here")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${timeline}
      </table>` : ""}
      ${label("Legacy")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="border-left:2px solid ${RED}; padding:2px 0 2px 20px; font-family:${SERIF}; font-size:19px; font-style:italic; line-height:1.6; color:${INK};">${linkDomain(proseHtml(ob.legacy), domain)}</td>
      </tr></table>
    </td></tr>

    <!-- sources -->
    <tr><td class="rip-pad" style="padding:40px 48px 0 48px;">
      <p style="margin:0 0 10px 0; font-family:${SERIF}; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:${MUTED};">Sources</p>
      ${sources}
    </td></tr>

    <!-- footer -->
    <tr><td class="rip-pad" align="center" style="padding:36px 48px 40px 48px;">
      <div style="border-top:1px solid ${RULE}; height:1px; line-height:1px; font-size:1px; margin-bottom:24px;">&nbsp;</div>
      <p style="margin:0 0 10px 0; font-family:${SERIF}; font-size:13px; font-style:italic; line-height:1.6; color:${MUTED};">RIP · URL is a weekly obituary for dead websites, published Sundays by Unlikely Archive.</p>
      <p style="margin:0; font-family:${SERIF}; font-size:13px; color:${MUTED};">${footerLinks}</p>
    </td></tr>
  </table>`;

  const emailFooter = link(issueUrl, "Read on the web") + dot + link(`${baseUrl}/about`, "How this is made") + dot +
    link(UNSUBSCRIBE_SENTINEL, "Unsubscribe");
  const webFooter = link(`${baseUrl}/`, "All issues") + dot + link(`${baseUrl}/about`, "How this is made") + dot +
    link(`${baseUrl}/#subscribe`, "Subscribe");

  // Cross-post kit rides in the owner copy BELOW the issue — for Eryn's hands, not readers' eyes.
  const crossPost = `
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; margin-top:24px;">
    <tr><td style="font-family:'Courier New', monospace; font-size:12px; line-height:1.5; color:#555; padding:14px; border:1px dashed #999; background:#f5f5f2;">
      <strong>CROSS-POST KIT (not part of the issue)</strong><br><br>
      <strong>X:</strong> ${esc(ob.x_post).replaceAll("{URL}", issueUrl)}<br><br>
      <strong>Tumblr:</strong> ${esc(ob.tumblr_post).replaceAll("{URL}", issueUrl)}
    </td></tr>
  </table>`;

  // The inbox preview line: the first sentence of the legacy, not the masthead.
  const preview = esc(ob.legacy.replace(/<[^>]+>/g, "").split(/(?<=[.!?])\s/)[0].slice(0, 180));
  const preheader =
    `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${preview}&#8202;&zwnj;&nbsp;&#8202;&zwnj;&nbsp;&#8202;&zwnj;&nbsp;</div>`;

  const shell = (inner: string, extraHead = "") => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><title>${esc(ob.subject_line)}</title>${extraHead}${RESPONSIVE}</head>
<body style="margin:0; padding:0; background-color:${PAGE};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="rip-outer" style="background-color:${PAGE}; padding:32px 0;"><tr><td align="center">
  ${inner}
  </td></tr></table>
</body>
</html>`;

  const description = esc(ob.legacy.replace(/<[^>]+>/g, "").slice(0, 200));
  const webHead = `
<meta name="description" content="${description}">
<meta property="og:title" content="${esc(ob.subject_line)}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:type" content="article">
<link rel="alternate" type="application/rss+xml" title="RIP · URL" href="${baseUrl}/feed.xml">`;

  const ownerHtml = shell(issue(emailFooter.replace(UNSUBSCRIBE_SENTINEL, `${baseUrl}/`)) + crossPost);
  const subscriberHtml = shell(issue(emailFooter));
  const webHtml = shell(issue(webFooter), webHead);

  // Render guard — refuse to ship anything that smells un-rendered.
  for (const html of [ownerHtml, subscriberHtml, webHtml]) {
    for (const bad of ["{{", "{%", ">undefined<", ">null<", "{URL}", "undefined &ndash;"]) {
      if (html.includes(bad)) throw new Error(`render guard tripped on "${bad}"`);
    }
  }
  return { ownerHtml, subscriberHtml, webHtml };
}
