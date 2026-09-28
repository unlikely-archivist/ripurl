// Shared shapes passed between pipeline stages.
// Every stage reads/writes these — nothing hides in loose objects.
import type { DomainToday } from "./liveness.ts";

export interface Candidate {
  company: string;
  qid: string; // Wikidata entity id, e.g. Q65073105
  domain: string; // derived from the entity's own P856 official-website claim
  website: string;
  dissolvedDate: string; // YYYY-MM-DD
  dissolvedYear: number;
  wikipediaTitle: string;
  wikipediaUrl: string;
  // filled during enrichment:
  extract?: string; // Wikipedia lead text (plain)
  description?: string; // Wikipedia short description
  monthsArchived?: number; // distinct months with Wayback captures
  firstCapture?: string; // YYYYMMDDhhmmss
  lastCapture?: string;
  today?: DomainToday; // what the URL does now — proof it's actually dead
  score?: number;
}

export interface Evidence {
  candidate: Candidate;
  wikipedia: {
    title: string;
    url: string;
    description: string;
    extract: string; // article body (up to ~12k chars), plain text
  };
  rdap: {
    reachable: boolean;
    registered?: string; // ISO date
    expires?: string;
    status?: string[];
    registrar?: string;
  };
  wayback: {
    firstCapture: string;
    lastCapture: string;
    monthsArchived: number;
    screenshotTimestamp: string; // capture chosen for the hero image
    screenshotSourceUrl: string; // the archived page the render points at
  };
  founded?: string; // from Wikidata P571, if present
  gatheredAt: string; // ISO timestamp — every issue carries its evidence trail
}

export interface Obituary {
  insufficient_evidence: boolean;
  domain: string;
  subject_line: string;
  prime_years: string;
  category: string;
  intro: string;
  the_rise: string;
  the_fall: string;
  manner_of_death: string;
  disposition: string;
  legacy: string;
  lineage: { year: string; label: string }[];
  sources: { cite: string; url: string }[];
  screenshot_note: string;
  x_post: string; // <=280 chars, for manual cross-post
  tumblr_post: string; // short + tags, for manual cross-post
}

// The cron advances one Job through these stages, one tick at a time,
// so no single run risks the platform wall-clock limit.
export type Stage =
  | "discover" // build the gated candidate pool (cheap gates, whole pool)
  | "vet" // liveness + archive checks, one batch per tick
  | "evidence"
  | "screenshot"
  | "generate"
  | "verify" // independent fact-check of the draft against the evidence
  | "assemble_send" // publish to the archive + owner copy
  | "deliver" // subscriber fan-out, time-boxed per tick
  | "done"
  | "failed";

export interface Job {
  id: number;
  stage: Stage;
  attempts: number; // per-stage attempt counter
  pool: Candidate[]; // passed the cheap gates, not yet vetted
  candidates: Candidate[]; // vetted finalists, ranked; [0] is current, rest are fallbacks
  evidence?: Evidence;
  obituary?: Obituary;
  feedback?: string[]; // fact-check findings the next draft must fix
  revisions: number; // redrafts of the current candidate
  issueNumber?: number; // set once published
  error?: string;
  createdAt: string;
  updatedAt: string;
}
