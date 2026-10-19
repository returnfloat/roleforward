#!/usr/bin/env node
// Role fit and Preference fit: the two scores every shortlisted posting gets, shown side by side and never blended.
//   Role fit (1 to 5)        how well the user's record matches the role. The scout or /apply judges it.
//   Preference fit (1 to 5)  how well the role matches the user's preferences: the weighted average of each preference's
//                            rating (1 to 5, or unknown), from the Preferences table in the career direction file.
// The career direction file (workspace.yaml files.direction) holds the user's two lists, and only these decide what
// drops or ranks a posting:
//   ## Dealbreakers   bullets ("- **Wrong place:** ..."). Breaking one drops a posting before it's scored.
//   ## Preferences    a table: | Preference | Weight | Judged from |, at most five rows, weight high, medium, or low.
// Pay is neither: it's a standalone setting (targets.pay, pay.mjs) that only drops, and never changes either score.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/fit.mjs list                  the dealbreakers and preferences, with each preference's key
//   node <plugin>/tools/fit.mjs set <posting folder> [--role N] [<key>=<1-5|unknown>]...
//                                                     writes role_fit, the preference ratings, and preference_fit into that
//                                                     posting.md (keys can be shortened while unique)
//   node <plugin>/tools/fit.mjs show <posting folder>   one posting's scores
//   node <plugin>/tools/fit.mjs check                 live postings with a missing score or rating, or a rating for a
//                                                     preference that no longer exists

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrontmatter, writeFrontmatter, parseEvent } from './frontmatter.mjs';
import { loadWorkspace, relPath } from './workspace.mjs';

const { root, get } = loadWorkspace();
export const MAX_PREFERENCES = 5;
// Dealbreakers are capped too: each one hides postings the user never sees. Past the cap, only the first five apply,
// which errs toward showing more. Staleness, pay, and sponsorship are settings in workspace.yaml, not dealbreakers.
export const MAX_DEALBREAKERS = 5;
const WEIGHTS = { high: 3, medium: 2, low: 1 };
const LIVE = ['shortlisted', 'interested', 'applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final', 'offer'];
const today = new Date().toLocaleDateString('en-CA');
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The user's Dealbreakers and Preferences, plus any problems with them (too many preferences, a bad weight).
export function readDirection() {
  const file = join(root, get('files.direction', 'career-direction.md'));
  const out = { file, dealbreakers: [], preferences: [], problems: [] };
  if (!existsSync(file)) { out.problems.push(`No ${relPath(root, file)} yet.`); return out; }
  const section = (name) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').split(/^## /m).find((s) => s.toLowerCase().startsWith(name.toLowerCase()))?.split('\n').slice(1) ?? null;
  const db = section('Dealbreakers');
  if (!db) out.problems.push('No Dealbreakers section in the career direction file.');
  for (const l of db ?? []) { const m = l.match(/^- \*\*(.+?):?\*\*:?\s*(.*)$/); if (m) out.dealbreakers.push({ name: m[1].replace(/:$/, ''), text: m[2] }); }
  if (out.dealbreakers.length > MAX_DEALBREAKERS) out.problems.push(`${out.dealbreakers.length} dealbreakers: RoleForward uses at most ${MAX_DEALBREAKERS}. Only the first ${MAX_DEALBREAKERS} apply (${out.dealbreakers.slice(MAX_DEALBREAKERS).map((d) => d.name).join(', ')} doesn't). Merge or remove the rest.`);
  out.dealbreakers = out.dealbreakers.slice(0, MAX_DEALBREAKERS);
  const pr = section('Preferences');
  for (const l of pr ?? []) {
    const cells = l.trim().startsWith('|') ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : null;
    if (!cells || cells.length < 2 || /^-+$/.test(cells[0].replace(/:/g, '')) || cells[0].toLowerCase() === 'preference') continue;
    const [name, weight = '', judged = ''] = cells;
    const w = weight.toLowerCase();
    if (!WEIGHTS[w]) out.problems.push(`Preference "${name}": weight "${weight}" should be high, medium, or low.`);
    // The key leaves out any words in brackets: "Unit type (med-surg, step-down)" is unit-type.
    out.preferences.push({ name, key: slug(name.replace(/\([^)]*\)/g, ' ')), weight: WEIGHTS[w] ? w : 'medium', judged });
  }
  if (out.preferences.length > MAX_PREFERENCES) out.problems.push(`${out.preferences.length} preferences: RoleForward uses at most ${MAX_PREFERENCES}. Only the first ${MAX_PREFERENCES} count. Merge or remove the rest.`);
  out.preferences = out.preferences.slice(0, MAX_PREFERENCES);
  if (out.preferences.some((p) => /^(pay|comp|salary|compensation)\b/.test(p.key))) out.problems.push('A pay preference is listed. Pay is its own setting (targets.pay in workspace.yaml), so remove the row and set a floor there instead.');
  return out;
}

// Weighted average of the known ratings, one decimal, or '' when none is known.
export function preferenceFit(ratings, prefs) {
  let sum = 0, weight = 0;
  for (const p of prefs) { const r = +ratings?.[p.key]; if (r >= 1 && r <= 5) { sum += r * WEIGHTS[p.weight]; weight += WEIGHTS[p.weight]; } }
  return weight ? Math.round((sum / weight) * 10) / 10 : '';
}

// Ranking: the lower of the two scores first, then the higher, then the newest event. A posting without a Preference fit
// ranks by its Role fit alone. Used by the tracker, the sheet, and the scout's shortlist.
export function rankCompare(a, b) {
  const key = (r) => { const x = +r.role_fit || 0, y = r.preference_fit === '' || r.preference_fit === undefined ? x : +r.preference_fit || 0; return [Math.min(x, y), Math.max(x, y)]; };
  const [a1, a2] = key(a), [b1, b2] = key(b);
  return b1 - a1 || b2 - a2 || String(b.last_event ?? '').localeCompare(String(a.last_event ?? ''));
}

// The dealbreaker a drop reason names ("Wrong level: first-line manager"), for counting drops per dealbreaker.
export const dealbreakerOf = (reason, names) => names.find((n) => String(reason ?? '').toLowerCase().startsWith(n.toLowerCase())) ?? '';

// ---- Command line ----
const fail = (m) => { console.error(m); process.exit(1); };
const postingFile = (arg) => {
  const f = arg?.endsWith('posting.md') ? arg : join(arg ?? '', 'posting.md');
  return existsSync(f) ? f : fail(`No posting.md at ${f}`);
};
const ratingText = (v) => (v === '' || v === undefined ? 'not rated' : v);

function list() {
  const d = readDirection();
  console.log(`From ${relPath(root, d.file)}:\n\nDealbreakers (drop a posting), ${d.dealbreakers.length} of ${MAX_DEALBREAKERS}:\n${d.dealbreakers.map((x) => `  - ${x.name}`).join('\n') || '  none'}`);
  console.log(`\nPreferences (rank what's left), ${d.preferences.length} of ${MAX_PREFERENCES}:\n${d.preferences.map((p) => `  - ${p.name} (${p.weight}), key ${p.key}`).join('\n') || '  none: Preference fit stays blank, and postings rank by Role fit'}`);
  for (const p of d.problems) console.log(`\n[check] ${p}`);
}

function set(folder, args) {
  const file = postingFile(folder), { data, body } = readFrontmatter(file), d = readDirection();
  const ratings = { ...(data.preferences && typeof data.preferences === 'object' ? data.preferences : {}) };
  let role = data.role_fit ?? '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--role') { role = args[++i]; if (!(+role >= 1 && +role <= 5)) fail(`--role takes 1 to 5, not "${role}".`); continue; }
    const [k, v] = args[i].split('=');
    const matches = d.preferences.filter((p) => p.key === slug(k) || p.key.startsWith(slug(k)));
    if (matches.length !== 1) fail(`"${k}" ${matches.length ? 'matches more than one' : "isn't one of the"} preferences: ${d.preferences.map((p) => p.key).join(', ')}`);
    if (!(v === 'unknown' || (+v >= 1 && +v <= 5))) fail(`${matches[0].key} takes 1 to 5 or unknown, not "${v}".`);
    ratings[matches[0].key] = v === 'unknown' ? 'unknown' : +v;
  }
  for (const p of d.preferences) ratings[p.key] ??= 'unknown';
  const kept = Object.fromEntries(d.preferences.map((p) => [p.key, ratings[p.key]]));
  // Rebuild the frontmatter with the scores where they were (or after scout_key), keeping every other key.
  const out = {};
  const scores = { role_fit: role === '' ? '' : +role, preference_fit: preferenceFit(kept, d.preferences), ...(d.preferences.length ? { preferences: kept } : {}) };
  let placed = false;
  for (const [k, v] of Object.entries(data)) {
    if (['role_fit', 'preference_fit', 'preferences'].includes(k)) { if (!placed) { Object.assign(out, scores); placed = true; } continue; }
    out[k] = v;
    if (k === 'scout_key' && !placed) { Object.assign(out, scores); placed = true; }
  }
  if (!placed) Object.assign(out, scores);
  out.updated = today;
  writeFrontmatter(file, out, body);
  show(folder);
}

function show(folder) {
  const { data } = readFrontmatter(postingFile(folder)), d = readDirection();
  console.log(`${data.company}, ${data.role}\n  Role fit: ${ratingText(data.role_fit)}\n  Preference fit: ${ratingText(data.preference_fit)}`);
  for (const p of d.preferences) console.log(`    ${p.name} (${p.weight}): ${ratingText(data.preferences?.[p.key])}`);
}

function check() {
  const d = readDirection(), dir = join(root, 'applications'), keys = d.preferences.map((p) => p.key), issues = [];
  for (const c of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (!c.isDirectory() || c.name === 'data') continue;
    for (const p of readdirSync(join(dir, c.name), { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const file = join(dir, c.name, p.name, 'posting.md');
      if (!existsSync(file)) continue;
      const { data } = readFrontmatter(file);
      const stage = (data.events || []).map(parseEvent).at(-1)?.stage;
      if (!LIVE.includes(stage)) continue;
      const r = data.preferences && typeof data.preferences === 'object' ? data.preferences : {};
      const why = [!(+data.role_fit) && 'no Role fit',
        keys.filter((k) => !(k in r)).length && `not rated for ${keys.filter((k) => !(k in r)).join(', ')}`,
        Object.keys(r).filter((k) => !keys.includes(k)).length && `rated for removed ${Object.keys(r).filter((k) => !keys.includes(k)).join(', ')}`].filter(Boolean);
      if (why.length) issues.push(`  ${c.name}/${p.name}: ${why.join('; ')}`);
    }
  }
  for (const p of d.problems) console.log(`[check] ${p}`);
  console.log(issues.length ? `Live postings to score again (fit.mjs set <folder> ...):\n${issues.join('\n')}` : 'Every live posting has both scores for the current preferences.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  if (cmd === 'list') list();
  else if (cmd === 'set') set(arg, rest);
  else if (cmd === 'show') show(arg);
  else if (cmd === 'check') check();
  else console.error('Usage: node <plugin>/tools/fit.mjs list | set <posting folder> [--role N] [<key>=<1-5|unknown>]... | show <posting folder> | check');
}
