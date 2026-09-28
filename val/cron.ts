// The heartbeat. Runs every 15 minutes (cron set via interval settings).
// Each tick advances the weekly job by one stage; most ticks are no-ops.
// New jobs only start Sundays 14:00–20:00 UTC — see pipeline.ts.
import { tick } from "./pipeline.ts";

export default async function (interval: Interval) {
  const result = await tick();
  console.log(`[ripurl tick] ${result}`);
}
