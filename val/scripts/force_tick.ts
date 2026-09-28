// Manual pipeline advance for testing: starts a job if none is active
// (bypassing the Sunday window), otherwise advances the active job one stage.
// Run repeatedly to walk a whole issue through the pipeline by hand.
import { tick } from "../pipeline.ts";

const result = await tick(true);
console.log(result);
