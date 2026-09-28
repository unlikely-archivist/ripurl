// Manual check: run trimDeadSpace over stored screenshots without saving
// anything, and report the crop each one would get.
import { blob } from "https://esm.town/v/std/blob@30-main/main.ts";
import jpeg from "npm:jpeg-js@0.4.4";
import { trimDeadSpace } from "../lib/screenshot.ts";

for (const d of ["mci.com", "westwood.com", "bomis.com", "saban.com", "iup.com"]) {
  const src = new Uint8Array(await (await blob.get(`img:${d}`)).arrayBuffer());
  const t0 = Date.now();
  const out = trimDeadSpace(src);
  const a = jpeg.decode(src), b = jpeg.decode(out);
  console.log(`${d.padEnd(14)} ${a.width}x${a.height} → ${b.width}x${b.height}  ${Date.now() - t0}ms`);
}
