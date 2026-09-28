// Persistence: sqlite (val-scoped) for jobs, issues, subscribers, and the
// used-domain exclusion list. Blob storage holds the big artifacts
// (screenshot JPEG, final HTML) keyed by issue number / domain.
import { sqlite } from "https://esm.town/v/std/sqlite@34-main/main.ts";
import type { Job, Stage } from "./types.ts";

export async function initTables() {
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS used_domains (
    domain TEXT PRIMARY KEY,
    used_at TEXT NOT NULL
  )`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS issues (
    n INTEGER PRIMARY KEY,
    domain TEXT NOT NULL,
    subject TEXT NOT NULL,
    model TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  // Cron ticks and manual /tick calls can overlap. A partial unique index
  // allows only one active job, and lease_until lets only one tick work it.
  try {
    await sqlite.execute("ALTER TABLE jobs ADD COLUMN lease_until INTEGER");
  } catch { /* column already exists */ }
  await sqlite.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs((1)) WHERE stage NOT IN ('done','failed')",
  );
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS subscribers (
    email TEXT PRIMARY KEY,
    status TEXT NOT NULL,          -- pending | active | unsubscribed
    token TEXT NOT NULL UNIQUE,    -- confirm + unsubscribe links
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    last_confirm_sent_at TEXT
  )`);
}

export async function usedDomains(): Promise<Set<string>> {
  const r = await sqlite.execute("SELECT domain FROM used_domains");
  return new Set(r.rows.map((row: any) => String(row.domain)));
}

export async function markUsed(domain: string) {
  await sqlite.execute({
    sql: "INSERT OR IGNORE INTO used_domains (domain, used_at) VALUES (?, ?)",
    args: [domain.toLowerCase(), new Date().toISOString()],
  });
}

export async function seedUsedDomains(domains: string[]) {
  for (const d of domains) await markUsed(d);
}

// --- jobs ---------------------------------------------------------------

export async function activeJob(): Promise<Job | null> {
  const r = await sqlite.execute(
    "SELECT * FROM jobs WHERE stage NOT IN ('done','failed') ORDER BY id DESC LIMIT 1",
  );
  if (r.rows.length === 0) return null;
  return rowToJob(r.rows[0]);
}

export async function createJob(): Promise<Job> {
  const now = new Date().toISOString();
  const data = JSON.stringify({ pool: [], candidates: [] });
  await sqlite.execute({
    sql: "INSERT INTO jobs (stage, attempts, data_json, created_at, updated_at) VALUES ('discover', 0, ?, ?, ?)",
    args: [data, now, now],
  });
  return (await activeJob())!;
}

const LEASE_MS = 5 * 60_000; // longer than any single stage runs

// True if this tick now holds the job; false if another tick is working it.
export async function claimJob(id: number): Promise<boolean> {
  const now = Date.now();
  const r = await sqlite.execute({
    sql: "UPDATE jobs SET lease_until = ? WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)",
    args: [now + LEASE_MS, id, now],
  });
  return r.rowsAffected === 1;
}

export async function releaseJob(id: number) {
  await sqlite.execute({ sql: "UPDATE jobs SET lease_until = NULL WHERE id = ?", args: [id] });
}

export async function saveJob(job: Job) {
  const data = JSON.stringify({
    pool: job.pool,
    candidates: job.candidates,
    evidence: job.evidence,
    obituary: job.obituary,
    feedback: job.feedback,
    revisions: job.revisions,
    issueNumber: job.issueNumber,
  });
  await sqlite.execute({
    sql: "UPDATE jobs SET stage = ?, attempts = ?, data_json = ?, error = ?, updated_at = ? WHERE id = ?",
    args: [job.stage, job.attempts, data, job.error ?? null, new Date().toISOString(), job.id],
  });
}

function rowToJob(row: any): Job {
  const data = JSON.parse(String(row.data_json));
  return {
    id: Number(row.id),
    stage: String(row.stage) as Stage,
    attempts: Number(row.attempts),
    pool: data.pool ?? [],
    candidates: data.candidates ?? [],
    evidence: data.evidence,
    obituary: data.obituary,
    feedback: data.feedback,
    revisions: data.revisions ?? 0,
    issueNumber: data.issueNumber,
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// --- issues ---------------------------------------------------------------

export async function nextIssueNumber(): Promise<number> {
  const r = await sqlite.execute("SELECT MAX(n) AS m FROM issues");
  const m = r.rows[0]?.m;
  return m == null ? 1 : Number(m) + 1;
}

export async function recordIssue(
  n: number,
  domain: string,
  subject: string,
  model: string,
  evidenceJson: string,
) {
  await sqlite.execute({
    sql: "INSERT INTO issues (n, domain, subject, model, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [n, domain, subject, model, evidenceJson, new Date().toISOString()],
  });
}

export async function listIssues() {
  const r = await sqlite.execute(
    "SELECT n, domain, subject, created_at FROM issues ORDER BY n DESC",
  );
  return r.rows.map((row: any) => ({
    n: Number(row.n),
    domain: String(row.domain),
    subject: String(row.subject),
    createdAt: String(row.created_at),
  }));
}

export async function getIssue(n: number) {
  const r = await sqlite.execute({ sql: "SELECT * FROM issues WHERE n = ?", args: [n] });
  if (r.rows.length === 0) return null;
  const row: any = r.rows[0];
  return {
    n: Number(row.n),
    domain: String(row.domain),
    subject: String(row.subject),
    model: String(row.model),
    evidenceJson: String(row.evidence_json),
    createdAt: String(row.created_at),
  };
}

export async function daysSinceLastIssue(): Promise<number> {
  const r = await sqlite.execute("SELECT MAX(created_at) AS m FROM issues");
  const m = r.rows[0]?.m;
  if (m == null) return Infinity;
  return (Date.now() - new Date(String(m)).getTime()) / 86_400_000;
}

// --- subscribers ------------------------------------------------------------

export interface Subscriber {
  email: string;
  status: "pending" | "active" | "unsubscribed";
  token: string;
  lastConfirmSentAt?: string;
}

function rowToSubscriber(row: any): Subscriber {
  return {
    email: String(row.email),
    status: String(row.status) as Subscriber["status"],
    token: String(row.token),
    lastConfirmSentAt: row.last_confirm_sent_at ? String(row.last_confirm_sent_at) : undefined,
  };
}

export async function getSubscriber(email: string): Promise<Subscriber | null> {
  const r = await sqlite.execute({ sql: "SELECT * FROM subscribers WHERE email = ?", args: [email] });
  return r.rows.length ? rowToSubscriber(r.rows[0]) : null;
}

// New or returning address → pending with a fresh token (double opt-in again).
export async function upsertPending(email: string): Promise<Subscriber> {
  const token = crypto.randomUUID().replaceAll("-", "");
  const now = new Date().toISOString();
  await sqlite.execute({
    sql: `INSERT INTO subscribers (email, status, token, created_at) VALUES (?, 'pending', ?, ?)
          ON CONFLICT(email) DO UPDATE SET status = 'pending', token = excluded.token`,
    args: [email, token, now],
  });
  return (await getSubscriber(email))!;
}

export async function markConfirmSent(email: string) {
  await sqlite.execute({
    sql: "UPDATE subscribers SET last_confirm_sent_at = ? WHERE email = ?",
    args: [new Date().toISOString(), email],
  });
}

export async function setStatusByToken(token: string, status: Subscriber["status"]): Promise<Subscriber | null> {
  const confirmedAt = status === "active" ? new Date().toISOString() : null;
  await sqlite.execute({
    sql: "UPDATE subscribers SET status = ?, confirmed_at = COALESCE(?, confirmed_at) WHERE token = ?",
    args: [status, confirmedAt, token],
  });
  const r = await sqlite.execute({ sql: "SELECT * FROM subscribers WHERE token = ?", args: [token] });
  return r.rows.length ? rowToSubscriber(r.rows[0]) : null;
}

export async function activeSubscribers(): Promise<Subscriber[]> {
  const r = await sqlite.execute("SELECT * FROM subscribers WHERE status = 'active'");
  return r.rows.map(rowToSubscriber);
}
