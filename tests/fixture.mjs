#!/usr/bin/env node
// Builds a test workspace on the fly, so no workspace files are kept in the repository. Every value is a plain
// placeholder (Test Candidate, Employer A, example.invalid): nothing here should read as a real person or employer.
// Dates are relative to today, so stage ages and staleness checks mean the same thing on every run.
//
// In tests:   import { buildWorkspace } from './fixture.mjs';
//             const ws = buildWorkspace();          a fresh folder under the system temp folder
//             ws.run('tracker');                    runs plugins/roleforward/tools/tracker.mjs inside it, returns stdout
//             ws.cleanup();                         removed unless ROLEFORWARD_KEEP_FIXTURE is set
// By hand:    node tests/fixture.mjs <folder>       writes one to look at (the folder must be empty or missing)
//
// Options: { website: true } turns the website module on, with example.invalid addresses. { pay: { min, drop_below, unlisted } }
// sets a pay floor. { visa: true } and { connections: true } turn those modules on, each with one placeholder alias.
// { drive: true } turns on the Google Drive folder's Docs.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'roleforward');
const VERSION = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;

export const daysAgo = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA');

// The plugin's generic files, copied as onboarding would. They hold template text only.
const TEMPLATE_COPIES = ['CLAUDE.md', 'MEMORY.md', 'resume-writing-guide.md', 'linkedin.md', 'interview-prep.md', 'variants/README.md',
  'applications/README.md', 'applications/profile.md', 'applications/posting-template.md', 'applications/company-template.md'];

const workspaceYaml = ({ website, pay, visa, connections, drive }) => `workspace_version: ${VERSION}

person:
  name: Test Candidate
  file_stem: Test-Candidate

files:
  resume: resume.md
  portfolio: portfolio.md
  guide: resume-writing-guide.md
  direction: career-direction.md
  linkedin: linkedin.md
  memory: MEMORY.md
  interview_prep: interview-prep.md

targets:
  field: data engineering
  titles: [Senior Data Engineer, Staff Data Engineer]
  level_baseline: Employer Y, Senior Data Engineer
  level_track: published pay bands
  country: US
  remote: true
  places:
    "Example City, ST": [Nearby Town]
${pay ? `  pay:\n${Object.entries(pay).map(([k, v]) => `    ${k}: ${v}`).join('\n')}\n` : ''}${visa ? `  visa:
    needs_sponsorship: true
    status: H-1B
    deadline: ${daysAgo(-30)}
    aliases:
      Employer A: [Employer A Subsidiary]
` : ''}
scout:
  search_terms: [data engineer]
  max_shortlist: 10
  cadence: weekly
  stale_days: 60
  discover: []
  title_all:
    - '\\bdata\\b'
    - '\\b(senior|staff|lead|principal)\\b'
  title_none: '\\b(intern|sales|recruit\\w*)\\b'
  remote_words: 'remote|anywhere|distributed|virtual'

apply:
  depth: light

tracker:
  maturity_field: function_maturity

theme:
  primary: '#132a45'
  accent: '#d8b66a'

render:
  max_pages: 2

website:
  enabled: ${website ? 'true' : 'false'}
${website ? `  domain: example.invalid
  url: https://example.invalid/
  site_role: Data Engineer
  description: Test Candidate, a placeholder profile for RoleForward's tests.
  job_title: Senior Data Engineer
  location: Example City, ST
  initials: TC
  location_line: EXAMPLE CITY, ST
` : ''}
linkedin:
  enabled: true

connections:
  enabled: ${connections ? 'true' : 'false'}
${connections ? `  aliases:
    Employer A: [Employer A Brand]
` : ''}
sheet:
  scout_log_days: 14
  history_days: 30

drive:
  enabled: ${drive ? 'true' : 'false'}

index:
  title: Career Workspace Index
`;

// Bullets are placeholders, but each has a number, so number and sync checks have something to compare.
const BULLETS = {
  lead: 'Cut example pipeline run time by 40% by leading a team of 5 through a scheduler redesign.',
  quality: 'Raised example data quality checks from 20 to 120 tables by building a shared test library.',
  cost: 'Lowered example storage cost by 25% by moving cold tables to a cheaper tier.',
  migrate: 'Moved 30 example reports to a new warehouse with no missed deadlines by planning the cutover in 3 waves.',
};

const resumeMd = `---
title: "Test Candidate: Resume (default)"
variant: "Default, for placeholder data engineering roles"
reviewed: ${daysAgo(10)}
---

# Test Candidate

Example City, ST · 000-000-0000 · candidate@example.invalid

**Senior Data Engineer · Example Positioning Phrase · Example Specialty**

## Summary

Placeholder summary for RoleForward's tests. Test Candidate is a fictional data engineer with example results in pipeline speed, data quality, and cost, written only so the tools have a resume to read.

## Core Competencies

- **Example Group One:** Example skill, another example skill, a third example skill.
- **Example Group Two:** Example tool, another example tool.

## Work Experience

### Employer Y

**Senior Data Engineer** · Example City, ST (Hybrid) · Jan 2022 to Present

- **Pipeline Speed:** ${BULLETS.lead}
- **Data Quality:** ${BULLETS.quality}

### Employer X

**Data Engineer** · Example City, ST (Onsite) · Jun 2018 to Dec 2021

- **Storage Cost:** ${BULLETS.cost}
- **Warehouse Move:** ${BULLETS.migrate}

## Education & Recognition

- **Example Degree:** Example University.
- **Example Certification:** Example Issuer.
`;

const portfolioMd = `---
title: "Test Candidate: Career Portfolio (resume source and interview defense)"
updated: ${daysAgo(10)}
---

# Test Candidate: Career Portfolio

Placeholder record for RoleForward's tests. Every number below is invented.

## Disclosure Rules (apply to every output)

- **Confidential names:** none in this placeholder record.

## Role Timeline

- **Senior Data Engineer, Employer Y, Jan 2022 to Present:** example charter.
- **Data Engineer, Employer X, Jun 2018 to Dec 2021:** example charter.

## Impact Areas

### Pipeline speed

**Resume lines:**
- \`[BOTH][pipelines][core]\` ${BULLETS.lead}

**Outcomes:**
- Example result, 40%. (Self-reported. Team-led.)

### Data quality

**Resume lines:**
- \`[IC][quality][core]\` ${BULLETS.quality}

### Storage cost

**Resume lines:**
- \`[IC][cost][opt]\` ${BULLETS.cost}

### Warehouse move

**Resume lines:**
- \`[IC][migration][core]\` ${BULLETS.migrate}

## Education and Recognition

- **Education:** Example Degree, Example University.
- **Certifications:** Example Certification, Example Issuer.
`;

const directionMd = `---
title: "Career Direction (personal, never published)"
updated: ${daysAgo(10)}
---

# Career Direction

## Dealbreakers

- **Wrong role:** anything that isn't data engineering.
- **Wrong level:** below senior.
- **Wrong place:** outside Example City or remote in the US.

## Preferences

| Preference | Weight | Judged from |
|---|---|---|
| Work location and office days | high | the posting's location and remote terms |
| Team size | medium | the posting's team description |

## Research Notes

- Example signal, and where to find it.
`;

const watchlistMd = `---
title: Scout Watchlist
updated: ${daysAgo(10)}
---

# Scout Watchlist

Placeholder employers for RoleForward's tests.

## Watchlist

| Company | Source | Board | Why | Domain |
|---|---|---|---|---|
| Employer A | greenhouse | test-employer-a | Example reason | Test Domain One |
| Employer B | ashby | test-employer-b | Example reason | Test Domain One |
| Employer C | lever | test-employer-c | Example reason | Test Domain Two |
| Employer D | workday | test-employer-d/wd1/Careers | Example reason | Test Domain Two |
| Employer E | manual |  | Example reason | Test Domain Two |
| ~Employer F | greenhouse | test-employer-f | Example reason, paused | Test Domain One |
`;

// One posting per kind of record the tools treat differently: waiting for review, interested, applied with a reply
// (and gone quiet, so it shows as stale), and passed.
const POSTINGS = [
  { company: 'Employer A', slug: 'employer-a', role: 'Senior Data Engineer', key: 'greenhouse:test-employer-a:1001', mode: 'remote', location: 'Remote, US',
    role_fit: 4, prefs: { 'work-location-and-office-days': 5, 'team-size': 'unknown' }, events: [[3, 'shortlisted']] },
  { company: 'Employer B', slug: 'employer-b', role: 'Staff Data Engineer', key: 'ashby:test-employer-b:test-002', mode: 'hybrid', location: 'Example City, ST',
    role_fit: 3, prefs: { 'work-location-and-office-days': 4, 'team-size': 3 }, events: [[8, 'shortlisted'], [6, 'interested']], company_md: true },
  { company: 'Employer C', slug: 'employer-c', role: 'Lead Data Engineer', key: 'lever:test-employer-c:test-003', mode: 'onsite', location: 'Example City, ST',
    role_fit: 5, prefs: { 'work-location-and-office-days': 3, 'team-size': 4 }, referral: true,
    events: [[35, 'shortlisted'], [33, 'interested'], [30, 'applied'], [25, 'recruiter-screen', '30 min with the recruiter']] },
  { company: 'Employer D', slug: 'employer-d', role: 'Principal Data Engineer', key: 'workday:test-employer-d/wd1/Careers:test-004', mode: 'remote', location: 'Remote, US',
    role_fit: 2, prefs: { 'work-location-and-office-days': 5, 'team-size': 2 }, events: [[12, 'shortlisted'], [11, 'passed', 'Example pass reason']] },
];

const prefFit = (prefs) => {
  const w = { 'work-location-and-office-days': 3, 'team-size': 2 };
  let s = 0, t = 0;
  for (const [k, v] of Object.entries(prefs)) if (typeof v === 'number') { s += v * w[k]; t += w[k]; }
  return t ? Math.round((s / t) * 10) / 10 : '';
};

function postingMd(p) {
  const first = daysAgo(p.events[0][0]), last = daysAgo(p.events.at(-1)[0]);
  return `---
title: "${p.company}: ${p.role} (fit analysis)"
company: ${p.company}
role: ${p.role}
track: balanced
level: ${p.role.split(' ')[0]}
work_mode: ${p.mode}
location: ${p.location}
posting: https://example.invalid/jobs/${p.key.split(':').at(-1)}
jd: jd.md
comp_min: 150000
comp_max: 190000
source: scout
referral: ${p.referral ? 'true' : 'false'}
referrer: ${p.referral ? 'Example Referrer' : ''}
resume: ${p.events.some((e) => e[1] === 'applied') ? 'resume.md' : 'tbd'}
resume_reason:
scout_key: ${p.key}
role_fit: ${p.role_fit}
preference_fit: ${prefFit(p.prefs)}
preferences:
${Object.entries(p.prefs).map(([k, v]) => `  ${k}: ${v}`).join('\n')}
why: "Example reason it's worth a look"
events:
${p.events.map(([d, stage, note]) => `  - ${[daysAgo(d), stage, note].filter(Boolean).join(' | ')}`).join('\n')}
updated: ${last}
---

# ${p.company}: ${p.role}

## Triage

Placeholder triage, shortlisted ${first}.
`;
}

const jdMd = (p) => `# ${p.company}: ${p.role}

Placeholder job description. Example responsibilities, example requirements. Pay range $150,000 - $190,000.
`;

const companyMd = (p) => `---
company: ${p.company}
quick_checked: ${daysAgo(6)}
researched:
ownership: private-vc
stability: 0
growth: 0
function_maturity: 0
verdict: "Example verdict"
---

# ${p.company}

## Quick Check (${daysAgo(6)})

**Verdict:** Example verdict.
`;

// seen.csv: the shortlisted postings, plus one held and drops under each dealbreaker and one setting.
const SEEN_COLS = ['key', 'company', 'title', 'location', 'posted', 'url', 'first_seen', 'last_seen', 'decision', 'reason'];
const seenRows = () => [
  ...POSTINGS.map((p) => [p.key, p.company, p.role, p.location, daysAgo(p.events[0][0] + 2), `https://example.invalid/jobs/${p.key.split(':').at(-1)}`, daysAgo(p.events[0][0]), daysAgo(1), 'shortlisted', 'Example reason']),
  ['greenhouse:test-employer-a:test-101', 'Employer A', 'Senior Data Analyst', 'Remote, US', daysAgo(9), 'https://example.invalid/jobs/test-101', daysAgo(8), daysAgo(1), 'dropped', 'Wrong role: analyst, not engineering'],
  ['ashby:test-employer-b:test-102', 'Employer B', 'Lead Data Engineer', 'London', daysAgo(9), 'https://example.invalid/jobs/test-102', daysAgo(8), daysAgo(1), 'dropped', 'Wrong place: London'],
  ['lever:test-employer-c:test-103', 'Employer C', 'Senior Data Engineer', 'Example City, ST', daysAgo(90), 'https://example.invalid/jobs/test-103', daysAgo(8), daysAgo(1), 'dropped', 'Stale: posted 90 days ago'],
  ['lever:test-employer-c:test-104', 'Employer C', 'Senior Data Platform Engineer', 'Remote, US', daysAgo(5), 'https://example.invalid/jobs/test-104', daysAgo(4), daysAgo(1), 'held', 'Over the weekly cap'],
];
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function buildWorkspace({ dir, website = false, pay = null, visa = false, connections = false, drive = false } = {}) {
  // The real path, as the tools resolve it (macOS's temp folder sits behind a symlink).
  const root = dir ? resolve(dir) : realpathSync(mkdtempSync(join(tmpdir(), 'roleforward-test-')));
  if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} isn't empty. Pick an empty or new folder.`);
  const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };

  for (const f of TEMPLATE_COPIES) { mkdirSync(dirname(join(root, f)), { recursive: true }); copyFileSync(join(PLUGIN, 'templates', f), join(root, f)); }
  write('workspace.yaml', workspaceYaml({ website, pay, visa, connections, drive }));
  write('resume.md', resumeMd);
  write('portfolio.md', portfolioMd);
  write('career-direction.md', directionMd);
  write('applications/watchlist.md', watchlistMd);
  for (const p of POSTINGS) {
    const folder = `applications/${p.slug}/${daysAgo(p.events[0][0])}-${p.role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    write(`${folder}/posting.md`, postingMd(p));
    write(`${folder}/jd.md`, jdMd(p));
    if (p.company_md) write(`applications/${p.slug}/company.md`, companyMd(p));
  }
  write('applications/data/seen.csv', [SEEN_COLS, ...seenRows()].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

  // Runs one plugin tool inside the workspace and returns what it printed. Throws (with its output) when it fails.
  // opts.node adds Node options before the tool, such as the feed tests' --import preload.
  const run = (tool, args = [], { node = [], env = {}, ...opts } = {}) => execFileSync(process.execPath, [...node, join(PLUGIN, 'tools', `${tool}.mjs`), ...args], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
    env: { ...process.env, ROLEFORWARD_WORKSPACE_DIR: root, ...env },
  });
  const cleanup = () => { if (!process.env.ROLEFORWARD_KEEP_FIXTURE && !dir) rmSync(root, { recursive: true, force: true }); };
  // Like run, but for a command expected to fail: returns { status, out } with stdout and stderr together.
  const fails = (tool, args = [], opts = {}) => {
    try { return { status: 0, out: run(tool, args, opts) }; } catch (e) { return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  };
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const folder = (slug) => {
    const p = POSTINGS.find((x) => x.slug === slug);
    return `applications/${p.slug}/${daysAgo(p.events[0][0])}-${p.role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  };
  return { root, run, fails, read, write, folder, cleanup, postings: POSTINGS };
}

// ---- A minimal zip writer, for the zip reader's and the LinkedIn import's tests ----
// entries: [{ name, text, deflate }]. Stored or deflated, the two methods the reader supports.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, text, deflate = true } of entries) {
    const raw = Buffer.from(text, 'utf8'), data = deflate ? deflateRawSync(raw) : raw, nm = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nm.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(raw), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nm.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nm, data); central.push(dir, nm);
    offset += 30 + nm.length + data.length;
  }
  const dirBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBuf, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node tests/fixture.mjs <empty or new folder> [--website]'); process.exit(1); }
  const { root } = buildWorkspace({ dir, website: process.argv.includes('--website') });
  console.log(`Wrote a test workspace to ${root}`);
}
