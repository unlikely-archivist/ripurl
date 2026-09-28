// Stage 3 — Capture the hero screenshot without a browser.
//
// Verified 2026-07-14: WordPress mShots (s0.wp.com/mshots) renders Wayback
// pages server-side and returns a real JPEG, but only if you (a) send a
// browser User-Agent (403 otherwise), (b) use the `if_` flag in the Wayback
// URL to strip the archive toolbar, and (c) poll — the first responses are a
// small placeholder GIF until the render is cached (~10-40s).
// (thum.io returns its loading spinner for Wayback pages; microlink captures
// a blank page. Neither is usable — do not switch to them.)
//
// We fetch the JPEG bytes and store them in blob storage, so the published
// issue never depends on a third-party image URL staying alive.

import { blob } from "https://esm.town/v/std/blob/main.ts";
import jpeg from "npm:jpeg-js@0.4.4";

// Old sites often render as a small fixed layout in one corner of the
// 1000×750 capture. Trim the empty margin (the automated version of the local
// pipeline's hand crop): find the bounding box of pixels that differ from the
// bottom-right background colour, pad it, and crop if that removes a real
// chunk. Never crops below 400px wide, so sparse-but-intentional pages survive.
export function trimDeadSpace(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const img = jpeg.decode(bytes, { useTArray: true });
  const { width: w, height: h, data } = img;
  const at = (x: number, y: number) => (y * w + x) * 4;
  const bg = at(w - 2, h - 2);
  const differs = (i: number) =>
    Math.abs(data[i] - data[bg]) + Math.abs(data[i + 1] - data[bg + 1]) + Math.abs(data[i + 2] - data[bg + 2]) > 36;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (differs(at(x, y))) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return bytes; // uniform image: leave it for the size guard
  const pad = 24;
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
  let x1 = Math.min(w, maxX + pad), y1 = Math.min(h, maxY + pad);
  if (x1 - x0 < 400) x1 = Math.min(w, x0 + 400);
  y1 = Math.max(y1, Math.min(h, y0 + Math.round((x1 - x0) * 0.5))); // no letterbox slivers
  const cw = x1 - x0, ch = y1 - y0;
  if (cw * ch > 0.8 * w * h) return bytes; // not worth a re-encode
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(at(x0, y0 + y), at(x0, y0 + y) + cw * 4), y * cw * 4);
  return new Uint8Array(jpeg.encode({ data: out, width: cw, height: ch }, 90).data);
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function toolbarFreeWaybackUrl(timestamp: string, domain: string): string {
  return `http://web.archive.org/web/${timestamp}if_/http://${domain}/`;
}

export function mshotsUrl(target: string, width = 1000): string {
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(target)}?w=${width}`;
}

// The Internet Archive's own error pages — the pilot published one of these
// as an issue's hero image (iup.com: "Temporarily Offline").
const ARCHIVE_ERROR = /Temporarily Offline|services are temporarily offline|Wayback Machine (has not archived|doesn't have that page)|Hrm\.|This snapshot cannot be displayed|Got an HTTP \d{3} response at crawl time/i;

// Confirm the archived page itself is a real capture before rendering it.
async function archivedPageIsReal(target: string): Promise<boolean> {
  try {
    const resp = await fetch(target, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) return false;
    return !ARCHIVE_ERROR.test((await resp.text()).slice(0, 50_000));
  } catch {
    return false;
  }
}

// One polling attempt. Returns true once a real JPEG is stored.
// The cron calls this each tick while the job sits in the "screenshot"
// stage, so mShots gets rendering time between ticks for free (the URL must
// stay identical across ticks for its cached render to be picked up).
export async function tryCaptureScreenshot(
  timestamp: string,
  domain: string,
): Promise<boolean> {
  const target = toolbarFreeWaybackUrl(timestamp, domain);
  if (!(await archivedPageIsReal(target))) {
    throw new Error(`archived page for ${domain} at ${timestamp} is an Archive error page or unreachable`);
  }
  const url = mshotsUrl(target);
  // Poll a few times within this tick; if not ready, the next tick retries.
  for (let i = 0; i < 3; i++) {
    const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    const type = resp.headers.get("content-type") ?? "";
    const bytes = await resp.arrayBuffer();
    // Guard: a real render is a JPEG well above placeholder size. Small or
    // non-JPEG responses are the loading GIF / an error page — reject them.
    if (resp.ok && type.includes("image/jpeg") && bytes.byteLength > 25_000) {
      await blob.set(`img:${domain}`, trimDeadSpace(new Uint8Array(bytes)));
      await blob.set(`img:${domain}:ts`, timestamp);
      return true;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return false;
}

// True only if the stored image is from this exact capture — an image kept
// from an earlier run of the same domain may be a different year, and the
// caption and source citation must match the picture.
export async function screenshotStored(domain: string, timestamp: string): Promise<boolean> {
  try {
    return (await (await blob.get(`img:${domain}:ts`)).text()) === timestamp;
  } catch {
    return false;
  }
}
