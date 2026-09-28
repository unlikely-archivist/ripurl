// Delivery. Two channels:
//   • owner copy — Val Town std/email, which on the free plan can only reach
//     the val owner. Carries the cross-post kit. Always on.
//   • subscribers — the Gmail API as the sending account (free, ~500
//     recipients/day on a personal Gmail). Switched on by setting
//     GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER.
//     The OAuth app must be in "In production" publishing status — a
//     "Testing" app's refresh token expires after 7 days.
//
// Subscriber sends are idempotent per (issue, email) via the deliveries
// table, so a run cut off mid-list resumes next tick without double-sending.

import { email as stdEmail } from "https://esm.town/v/std/email";
import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { activeSubscribers } from "./state.ts";

export const UNSUBSCRIBE_SENTINEL = "%%UNSUBSCRIBE_URL%%";

export function subscriptionsEnabled(): boolean {
  return ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_SENDER"]
    .every((k) => Boolean(Deno.env.get(k)));
}

export async function sendOwnerCopy(subject: string, html: string) {
  await stdEmail({ subject, html });
}

// --- Gmail API ---------------------------------------------------------------

async function gmailAccessToken(): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const encodeHeader = (s: string) => `=?UTF-8?B?${b64(utf8(s))}?=`;

function mime(to: string, subject: string, html: string, unsubscribeUrl?: string): string {
  const sender = Deno.env.get("GMAIL_SENDER")!;
  const body = b64(utf8(html)).replace(/.{76}/g, "$&\r\n");
  const headers = [
    `From: ${encodeHeader("RIP · URL")} <${sender}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (unsubscribeUrl) {
    headers.push(`List-Unsubscribe: <${unsubscribeUrl}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export async function gmailSend(accessToken: string, to: string, subject: string, html: string, unsubscribeUrl?: string) {
  const raw = b64(utf8(mime(to, subject, html, unsubscribeUrl))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!resp.ok) throw new Error(`Gmail send to ${to} failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
}

export async function sendConfirmation(to: string, confirmUrl: string) {
  const token = await gmailAccessToken();
  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:520px;">
    <p style="font-size:22px;font-weight:bold;letter-spacing:2px;"><span style="color:#a82828;">RIP</span> · URL</p>
    <p>Someone — hopefully you — asked to receive a weekly obituary for a dead website.</p>
    <p><a href="${confirmUrl}" style="color:#a82828;">Confirm your subscription</a></p>
    <p style="color:#8a8677;font-size:13px;font-style:italic;">If this wasn't you, ignore this email and nothing will happen.</p>
  </div>`;
  await gmailSend(token, to, "Confirm your RIP · URL subscription", html);
}

// --- subscriber fan-out ------------------------------------------------------

async function initDeliveries() {
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS deliveries (
    issue_n INTEGER NOT NULL,
    email TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (issue_n, email)
  )`);
}

// Sends to every active subscriber not yet sent this issue, until the time
// budget runs out. Returns how many remain (0 = finished).
export async function deliverToSubscribers(
  issueN: number,
  subject: string,
  html: string, // contains UNSUBSCRIBE_SENTINEL
  baseUrl: string,
  budgetMs = 40_000,
): Promise<{ sent: number; remaining: number; failed: string[] }> {
  if (!subscriptionsEnabled()) return { sent: 0, remaining: 0, failed: [] };
  await initDeliveries();
  const done = new Set(
    (await sqlite.execute({ sql: "SELECT email FROM deliveries WHERE issue_n = ?", args: [issueN] }))
      .rows.map((r: any) => String(r.email)),
  );
  const todo = (await activeSubscribers()).filter((s) => !done.has(s.email));
  if (todo.length === 0) return { sent: 0, remaining: 0, failed: [] };

  const started = Date.now();
  const token = await gmailAccessToken();
  let sent = 0;
  const failed: string[] = [];
  for (const s of todo) {
    if (Date.now() - started > budgetMs) break;
    const unsub = `${baseUrl}/unsubscribe?t=${s.token}`;
    try {
      await gmailSend(token, s.email, subject, html.replaceAll(UNSUBSCRIBE_SENTINEL, unsub), unsub);
      sent++;
    } catch (err) {
      failed.push(`${s.email}: ${(err as Error).message}`);
    }
    // Recorded even on failure: one attempt per address per issue, never a retry storm.
    await sqlite.execute({
      sql: "INSERT OR IGNORE INTO deliveries (issue_n, email, sent_at) VALUES (?, ?, ?)",
      args: [issueN, s.email, new Date().toISOString()],
    });
  }
  const remaining = todo.length - sent - failed.length;
  return { sent, remaining, failed };
}
