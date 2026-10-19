#!/usr/bin/env node
// The optional visa module, for a user who needs an employer to sponsor a work visa (workspace.yaml targets.visa).
// It reads what a posting says about sponsorship, and shows each employer's H-1B record from USCIS's public
// H-1B Employer Data Hub. It never contacts anyone, and the user's own status stays in workspace.yaml.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/visa.mjs fetch [years...]      downloads the USCIS hub's yearly CSV files (default: the three
//                                                      latest in its archive, about 7 MB) and builds applications/data/sponsors.csv
//   node <plugin>/tools/visa.mjs import <file...>      adds newer years exported by hand from the hub (Crosstab view, CSV)
//   node <plugin>/tools/visa.mjs history <company>     that employer's H-1B approvals, with the filing names counted
//   node <plugin>/tools/visa.mjs check <file>          what a job description says about sponsorship
//   node <plugin>/tools/visa.mjs status                the setting, the data's years, and days left before the deadline
//
// Settings in workspace.yaml targets.visa: needs_sponsorship (true turns the module on), status (for example H-1B or
// F-1 OPT), deadline (YYYY-MM-DD, optional: when the current status runs out, for example 60 days after a layoff), and
// aliases (a company and the other names it files under, such as its subsidiaries).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, readCsv, writeCsv } from './csv.mjs';
import { abbreviates, norm } from './connections.mjs';
import { loadWorkspace } from './workspace.mjs';

const { root, get } = loadWorkspace();
const FILE = join(root, 'applications', 'data', 'sponsors.csv');
const COLS = ['norm', 'employer', 'years', 'initial_approvals', 'continuing_approvals', 'denials'];
const HUB = 'https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-';
const ARCHIVE_YEARS = [2021, 2022, 2023];   // the newest years the hub's archive page offers as files
const today = new Date().toLocaleDateString('en-CA');

export const visaOn = () => get('targets.visa.needs_sponsorship', false) === true;

// Days until targets.visa.deadline, or null when no deadline is set.
export function daysLeft() {
  const d = get('targets.visa.deadline', '');
  return /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? Math.round((Date.parse(d) - Date.parse(today)) / 864e5) : null;
}
export function deadlineLine() {
  const n = daysLeft();
  if (n === null) return '';
  return n < 0 ? `Visa deadline ${get('targets.visa.deadline')} has passed. Update targets.visa in workspace.yaml.`
    : `Visa deadline: ${n} day${n === 1 ? '' : 's'} left (${get('targets.visa.deadline')}${get('targets.visa.status') ? `, ${get('targets.visa.status')}` : ''}).`;
}

// ---- what a posting says ----
// Checked in order: a clear "no", then citizenship or clearance requirements (which rule out most visa holders), then a clear "yes".
// [pattern, needs context]: a pattern marked true counts only when its sentence also mentions visas or work authorization,
// so "does not sponsor relocation" or "an executive sponsor" don't count.
const NO = [
  [/\b(unable|not able|cannot|can ?not|will not|won'?t|does not|do not|doesn'?t|don'?t|are not|is not|not)\s+(be\s+)?(able\s+to\s+)?(currently\s+)?(provide|offer|support|consider)\s+(any\s+)?(visa\s+|immigration\s+|employment\s+|h-?1b\s+)?sponsorship/i, false],
  [/\b(unable|not able|cannot|can ?not|will not|won'?t|does not|do not|doesn'?t|don'?t|not)\s+(be\s+)?(able\s+)?(to\s+)?sponsor\b/i, true],
  [/\bno\s+(visa\s+|immigration\s+|h-?1b\s+)?sponsorship\b/i, false],
  [/\bsponsorship\s+(is\s+|will\s+)?not\s+(be\s+)?(available|offered|provided|possible|considered)/i, false],
  [/\bwithout\s+(the\s+)?(need\s+(for|of)\s+|requiring\s+)?(current\s+or\s+future\s+|now\s+or\s+in\s+the\s+future\s+)?(visa\s+|employer\s+|employment\s+|company\s+)?sponsorship/i, false],
  [/\bnot\s+(eligible|open)\s+(for|to)\s+(visa\s+)?sponsorship/i, false],
];
const CITIZEN = [
  [/\b(u\.?\s?s\.?|united states)\s+citizen(ship)?\s+(is\s+)?(required|only)\b/i, false],
  [/\bmust\s+(be|hold)\s+(a\s+)?(u\.?\s?s\.?|united states)\s+citizen/i, false],
  [/\b(security|secret|top secret|ts\/sci|public trust)\s+clearance\b/i, false],
];
const YES = [
  [/\b(visa\s+|h-?1b\s+|immigration\s+)?sponsorship\s+(is\s+|may\s+be\s+|will\s+be\s+)?(available|offered|provided)\b/i, true],
  [/\b(will|can|do|does|may|we)\s+sponsor\b/i, true],
  [/\bopen\s+to\s+(visa\s+)?sponsorship\b/i, false],
];
const CONTEXT = /visa|immigra|h-?1b|work authori[sz]|authori[sz]ed to work|work permit|green card|employment authori[sz]/i;
// The sentence around a match, trimmed, so the user sees the posting's own words.
function quote(text, m) {
  const start = Math.max(text.lastIndexOf('.', m.index) + 1, text.lastIndexOf('\n', m.index) + 1, m.index - 160);
  const ends = ['.', '\n'].map((c) => text.indexOf(c, m.index + m[0].length)).filter((i) => i >= 0);
  const end = Math.min(...ends, m.index + m[0].length + 160, text.length);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}
export function sponsorshipText(text) {
  text = String(text ?? '');
  for (const [says, list] of [['no', NO], ['citizens', CITIZEN], ['yes', YES]])
    for (const [re, context] of list) {
      for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
        const q = quote(text, m);
        if (!context || CONTEXT.test(q)) return { says, quote: q };
      }
    }
  return { says: '', quote: '' };
}

// ---- employer history (USCIS H-1B Employer Data Hub) ----
// Rows from the hub's archive files ("Fiscal Year", Employer, "Initial Approval", ...) or a crosstab export from its
// current site, which Tableau writes as UTF-16 with tabs. Column names are matched loosely so either works.
function readHubFile(path) {
  const buf = readFileSync(path);
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8').replace(/^\uFEFF/, '');
  if (text.split('\n', 1)[0].includes('\t')) text = text.split('\n').map((l) => l.split('\t').map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]), low = (k) => k.toLowerCase(), col = (...words) => keys.find((k) => words.every((w) => low(k).includes(w)));
  const year = col('fiscal'), employer = col('employer') ?? col('petitioner');
  // Archive files have Initial and Continuing columns. The current hub splits approvals into six petition types:
  // new employment and new concurrent count as initial, and the rest (continuation, changes, amendments) as continuing.
  const approvals = keys.filter((k) => low(k).includes('approv')), denials = keys.filter((k) => low(k).includes('denia'));
  const initial = approvals.filter((k) => /initial|new employment|new concurrent/.test(low(k))), continuing = approvals.filter((k) => !initial.includes(k));
  if (!employer || !initial.length || !continuing.length)
    throw new Error(`${path}: not a USCIS H-1B Employer Data Hub file (no employer column, or no initial and continuing approval columns)`);
  const n = (v) => +String(v ?? '').replace(/,/g, '') || 0, sum = (r, ks) => ks.reduce((t, k) => t + n(r[k]), 0);
  return rows.filter((r) => r[employer]?.trim()).map((r) => ({ year: String(r[year] ?? '').trim(), employer: r[employer].trim(),
    ia: sum(r, initial), ca: sum(r, continuing), den: sum(r, denials) }));
}

// Merges hub rows into sponsors.csv, one line per employer name, replacing any year already there.
function build(rows) {
  const old = readCsv(FILE), byNorm = new Map();
  const newYears = new Set(rows.map((r) => r.year));
  // Years already in the file stay unless the new rows bring the same year again.
  for (const o of old) byNorm.set(o.norm, { ...o, byYear: JSON.parse(o.by_year || '{}') });
  for (const e of byNorm.values()) for (const y of newYears) delete e.byYear[y];
  for (const r of rows) {
    const k = norm(r.employer);
    if (!k) continue;
    const e = byNorm.get(k) ?? { norm: k, employer: r.employer, byYear: {} };
    const y = (e.byYear[r.year] ??= [0, 0, 0]);
    y[0] += r.ia; y[1] += r.ca; y[2] += r.den;
    byNorm.set(k, e);
  }
  const out = [...byNorm.values()].map((e) => {
    const ys = Object.keys(e.byYear).filter(Boolean).sort(), sum = (i) => ys.reduce((s, y) => s + e.byYear[y][i], 0);
    return { norm: e.norm, employer: e.employer, years: ys.join(' '), initial_approvals: sum(0), continuing_approvals: sum(1), denials: sum(2), by_year: JSON.stringify(e.byYear) };
  }).filter((e) => e.years);
  mkdirSync(join(root, 'applications', 'data'), { recursive: true });
  writeCsv(FILE, [...COLS, 'by_year'], out.sort((a, b) => a.norm.localeCompare(b.norm)));
  const years = [...new Set(out.flatMap((e) => e.years.split(' ')))].sort();
  console.log(`Wrote applications/data/sponsors.csv: ${out.length.toLocaleString()} employers, fiscal years ${years.join(', ')}.`);
}

let cache;
const sponsors = () => (cache ??= readCsv(FILE));
// Every filing name counted for a company: its own name plus targets.visa.aliases groups (a parent and the
// subsidiaries that file for it, matched both ways, as in the connections module).
function names(company) {
  const out = new Set([norm(company)]);
  for (const [k, v] of Object.entries(get('targets.visa.aliases', {}) || {})) {
    const group = [k, ...(Array.isArray(v) ? v : [v])].map(norm);
    if (group.some((n) => out.has(n))) group.forEach((n) => out.add(n));
  }
  out.delete('');
  return out;
}
const volume = (h) => +h.initial_approvals + +h.continuing_approvals;
// Counts filings under the company's names. Names that start with it ("Amazon Web Services", but also "Apple Tree Dental")
// are listed as similar, never counted, so a person or Claude decides which belong and adds them as aliases.
export function history(company) {
  const want = names(company);
  if (!want.size || !existsSync(FILE)) return null;
  const hits = sponsors().filter((s) => want.has(s.norm));
  const similar = sponsors().filter((s) => !want.has(s.norm) && ([...want].some((k) => s.norm.startsWith(k + ' ')) || abbreviates(s.employer, company) || abbreviates(company, s.employer))).sort((a, b) => volume(b) - volume(a));
  const years = [...new Set(sponsors().flatMap((s) => s.years.split(' ')))].filter(Boolean).sort();
  const sum = (f) => hits.reduce((n, h) => n + (+h[f] || 0), 0);
  return { initial: sum('initial_approvals'), continuing: sum('continuing_approvals'), denials: sum('denials'),
    names: hits.sort((a, b) => volume(b) - volume(a)).map((h) => h.employer), similar: similar.map((h) => [h.employer, volume(h)]), years };
}
// One line for triage notes and the scout's show command.
export function historyLine(company) {
  const h = history(company);
  if (!h) return 'no sponsorship data yet (run visa.mjs fetch)';
  const span = h.years.length ? `FY${h.years[0]}${h.years.length > 1 ? `-FY${h.years.at(-1)}` : ''}` : '';
  const similar = h.similar.length ? `. Similar filing names, not counted: ${h.similar.slice(0, 3).map(([n, v]) => `${n} (${v.toLocaleString()})`).join('; ')}${h.similar.length > 3 ? `; and ${h.similar.length - 3} more` : ''}` : '';
  if (!h.names.length) return `no H-1B petitions under this exact name in USCIS data (${span})${similar || '. A parent or differently named company may file instead'}`;
  const decided = h.initial + h.continuing + h.denials;
  return `${h.initial.toLocaleString()} new H-1B approvals and ${h.continuing.toLocaleString()} continuing (${span}, ${Math.round((100 * (h.initial + h.continuing)) / decided)}% approved), filed as ${h.names.slice(0, 3).join('; ')}${h.names.length > 3 ? `; and ${h.names.length - 3} more` : ''}${similar}`;
}

async function fetchHub(years) {
  const tmp = join(root, 'applications', 'data', '.uscis');
  mkdirSync(tmp, { recursive: true });
  const rows = [];
  try {
    for (const y of years) {
      const r = await fetch(`${HUB}${y}.csv`, { headers: { 'User-Agent': 'Mozilla/5.0 (RoleForward visa module)' } });
      if (!r.ok) throw new Error(`USCIS returned ${r.status} for fiscal year ${y}. The hub's archive page lists which years are available as files.`);
      const f = join(tmp, `${y}.csv`);
      writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      const got = readHubFile(f);
      console.log(`FY${y}: ${got.length.toLocaleString()} rows`);
      rows.push(...got);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  build(rows);
}

function status() {
  console.log(visaOn() ? `Visa module on: needs sponsorship${get('targets.visa.status') ? ` (current status ${get('targets.visa.status')})` : ''}.` : 'Visa module off (targets.visa.needs_sponsorship isn\'t true).');
  const line = deadlineLine();
  if (line) console.log(line);
  if (!existsSync(FILE)) return console.log('No sponsorship data yet. Run: node <plugin>/tools/visa.mjs fetch');
  const years = [...new Set(sponsors().flatMap((s) => s.years.split(' ')))].filter(Boolean).sort();
  console.log(`Sponsorship data: ${sponsors().length.toLocaleString()} employers, fiscal years ${years.join(', ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'fetch') await fetchHub(args.length ? args : ARCHIVE_YEARS);
    else if (cmd === 'import') build(args.flatMap(readHubFile));
    else if (cmd === 'history') {
      const h = history(args.join(' '));
      console.log(`${args.join(' ')}: ${historyLine(args.join(' '))}`);
      if (h?.names.length > 3) console.log(`Filing names counted:\n${h.names.map((n) => `  ${n}`).join('\n')}`);
      if (h?.similar.length) console.log(`Similar filing names, not counted (add the ones that are the same employer under targets.visa.aliases):\n${h.similar.slice(0, 25).map(([n, v]) => `  ${n} (${v.toLocaleString()} approvals)`).join('\n')}${h.similar.length > 25 ? `\n  and ${h.similar.length - 25} more` : ''}`);
    } else if (cmd === 'check') {
      const r = sponsorshipText(readFileSync(args[0], 'utf8'));
      console.log(r.says ? `Says ${r.says === 'no' ? 'no sponsorship' : r.says === 'citizens' ? 'citizenship or a clearance is required' : 'sponsorship is available'}: "${r.quote}"` : 'Sponsorship not mentioned.');
    } else if (cmd === 'status') status();
    else console.error('Usage: node <plugin>/tools/visa.mjs fetch [years...] | import <file...> | history <company> | check <file> | status');
  } catch (e) { console.error(e.message); process.exit(1); }
}
