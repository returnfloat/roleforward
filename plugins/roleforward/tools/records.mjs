// What the tools that read or write application records share: the stages, the next-action field, and finding or
// creating a posting's folder (applications/<company-slug>/<YYYY-MM-DD>-<role-slug>/posting.md). No command line.
// The record format is in the plugin's templates/applications/README.md.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter, parseEvent } from './frontmatter.mjs';
import { relPath } from './workspace.mjs';

// Pipeline stages in order. /scout shortlists a posting, the user marks it interested, may talk with someone at the
// employer first (conversation), then applies. Anything after "applied" is a response.
export const PIPELINE = ['shortlisted', 'interested', 'conversation', 'applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final', 'offer', 'accepted'];
// Endings. "expired" means the posting closed before the user decided. "accepted" ends a search too, so it counts as ended.
export const ENDINGS = ['expired', 'passed', 'rejected', 'withdrawn', 'no-response', 'declined-offer'];
export const LIVE = PIPELINE.filter((s) => s !== 'accepted');
export const ENDED = [...ENDINGS, 'accepted'];
// Stages before an application. Events in them, and withdrawn or no-response, are never a response.
export const BEFORE_APPLYING = ['shortlisted', 'interested', 'conversation'];
// When a live posting needs the user: a next action due within SOON_DAYS, a decision (shortlisted or interested) left
// DECIDE_DAYS with no next action, and an application or conversation quiet for STALE_DAYS. The tracker's Needs Attention
// list and next.mjs list --due use the same numbers.
export const SOON_DAYS = 3, DECIDE_DAYS = 7, STALE_DAYS = 21;
export const SOURCES = ['scout','recruiter-inbound', 'referral', 'linkedin', 'company-site', 'job-board', 'network'];

export const today = () => new Date().toLocaleDateString('en-CA');
const day = (d) => new Date(d + 'T00:00:00Z');
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 864e5);
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(day(s).getTime()) && day(s).toISOString().slice(0, 10) === s;

// Folder names: lower case, accents dropped, "&" as "and", anything else a hyphen, at most 60 characters.
export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
export const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// A record's events in date order (same-day events keep the order they were written in), and its current stage.
export const eventsOf = (data) => (data.events || []).map(parseEvent).sort((a, b) => a.date.localeCompare(b.date));
export const stageOf = (data) => eventsOf(data).at(-1)?.stage ?? 'shortlisted';

// next: "YYYY-MM-DD | what happens next". Returns null when empty, { date, action } when well formed, or { bad } with
// the raw text when not.
export function parseNext(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const [date, ...rest] = raw.split(' | ');
  const action = rest.join(' | ').trim();
  return isDate(date.trim()) && action ? { date: date.trim(), action } : { bad: raw };
}
// A posting's next action, which only a live posting has: on an ended one, a leftover next field is ignored.
export const nextOf = (data) => (LIVE.includes(stageOf(data)) ? parseNext(data.next) : null);

// What a live posting with no next action shows instead: the usual next step for its stage, dated from the day it
// reached that stage. It's a suggestion for display. Only a next action the user set counts as waiting on purpose.
const SUGGESTED = { shortlisted: [7, 'Decide: interested or pass'], interested: [7, 'Apply, or pass'], conversation: [7, 'Check back with your contact'],
  applied: [14, 'Follow up if there\'s no reply'], offer: [7, 'Answer the offer'] };
export function suggestedNext(stage, since) {
  if (!LIVE.includes(stage) || !isDate(since)) return null;
  const [n, action] = SUGGESTED[stage] ?? [7, 'Check back on the next step'];
  return { date: new Date(day(since).getTime() + n * 864e5).toISOString().slice(0, 10), action };
}
// The Next cell for a tracker row (its status, last_event, next_date, and next_action): the set one, or the suggestion.
export function nextCell(r, sep) {
  if (r.next_date) return `${r.next_date}${sep}${r.next_action}`;
  const s = suggestedNext(r.status, r.last_event);
  return s ? `${s.date}${sep}${s.action} (suggested)` : '';
}

// Every posting.md in the workspace: { id (the Record ID, "<company>/<folder>"), dir, file, companyDir }.
export function eachPosting(root) {
  const apps = join(root, 'applications'), out = [];
  if (!existsSync(apps)) return out;
  for (const c of readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'data'))
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = join(apps, c.name, p.name, 'posting.md');
      if (existsSync(file)) out.push({ id: `${c.name}/${p.name}`, dir: join(apps, c.name, p.name), file, companyDir: c.name });
    }
  return out;
}

// Where a new record goes: the folder of a company already in the workspace (and its spelling on record), or a new one.
// Throws when the same company and role already has a record, or the folder exists.
export function newRecordDir(root, company, role, date) {
  let companyDir = slug(company);
  for (const p of eachPosting(root)) {
    const { data } = readFrontmatter(p.file);
    if (!same(data.company, company)) continue;
    companyDir = p.companyDir; company = data.company;
    if (same(data.role, role)) throw new Error(`${relPath(root, p.file)} already records this role. Add an event to it instead.`);
  }
  const dir = join(root, 'applications', companyDir, `${date}-${slug(role)}`);
  if (existsSync(dir)) throw new Error(`${relPath(root, dir)} already exists.`);
  return { dir, company, companyDir };
}
