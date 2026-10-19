#!/usr/bin/env node
// Logs an application the user made outside the /apply flow (LinkedIn Easy Apply, a referral form, a career fair),
// so the tracker and stats still count it. One command creates the record and, for a known resume, freezes it.
//   node <tools>/log.mjs "<Company>" "<Role>" [--date YYYY-MM-DD] [--url <posting link>] [--source <source>]
//        [--resume <default resume> | variants/<name>.md | other] [--referrer "<Full Name>"] [--location "<City, ST>"] [--work-mode remote|hybrid|onsite]
//
// - The record is applications/<company-slug>/<date>-<role-slug>/posting.md, with an applied event on --date (default today).
//   An existing company folder is reused when its postings name the same company.
// - --resume defaults to the default resume. A default or variant resume is frozen with freeze.mjs, which copies its
//   current render into the folder. That's what was sent only if the resume hasn't changed since, so say so when logging
//   an older application. --resume other (an older or outside file) records the application without a snapshot.
// - It refuses if the same company and role already has a record. Add an event to that one instead.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFrontmatter, writeFrontmatter } from './frontmatter.mjs';
import { loadWorkspace, PLUGIN, relPath } from './workspace.mjs';

const { root, get } = loadWorkspace();
const apps = join(root, 'applications');
const fail = (msg) => { console.error(msg); process.exit(1); };
const SOURCES = ['scout', 'recruiter-inbound', 'referral', 'linkedin', 'company-site', 'job-board', 'network'];

const args = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i] ?? '';
  else pos.push(args[i]);
}
let [company, role] = pos;
if (!company || !role) {
  console.error('Usage: node log.mjs "<Company>" "<Role>" [--date YYYY-MM-DD] [--url <link>] [--source <source>] [--resume <file>|other] [--referrer "<Name>"] [--location "<City, ST>"] [--work-mode remote|hybrid|onsite]');
  process.exit(2);
}
const date = opts.date || new Date().toLocaleDateString('en-CA');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got ${date}`);
if (opts.source && !SOURCES.includes(opts.source)) fail(`--source must be one of ${SOURCES.join(', ')}`);
if (opts['work-mode'] && !['remote', 'hybrid', 'onsite'].includes(opts['work-mode'])) fail('--work-mode must be remote, hybrid, or onsite');
const resume = opts.resume || get('files.resume');
if (resume !== 'other' && resume !== get('files.resume') && !/^variants\/[\w-]+\.md$/.test(resume))
  fail(`--resume must be ${get('files.resume')}, variants/<name>.md, or other`);
if (resume !== 'other' && !existsSync(join(root, resume))) fail(`No ${resume} in the workspace.`);

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// Reuse the folder of a company already in the workspace, and refuse a duplicate record.
let companyDir = slug(company);
if (existsSync(apps))
  for (const c of readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'data'))
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = join(apps, c.name, p.name, 'posting.md');
      if (!existsSync(file)) continue;
      const { data } = readFrontmatter(file);
      if (!same(data.company, company)) continue;
      companyDir = c.name; company = data.company;   // keep the spelling already on record
      if (same(data.role, role)) fail(`${relPath(root, file)} already records this role. Add an event to it instead.`);
    }

const dir = join(apps, companyDir, `${date}-${slug(role)}`);
if (existsSync(dir)) fail(`${relPath(root, dir)} already exists.`);
mkdirSync(dir, { recursive: true });
const data = {
  title: `${company}: ${role}`, company, role, track: '', level: '', work_mode: opts['work-mode'] || '', location: opts.location || '',
  posting: opts.url || '', jd: '', comp_min: '', comp_max: '', source: opts.source || '', referral: opts.referrer ? 'true' : 'false',
  referrer: opts.referrer || '', resume, resume_reason: '', scout_key: '', role_fit: '', preference_fit: '', why: '',
  events: [`${date} | applied | logged after applying outside the apply flow`], updated: date,
};
const posting = join(dir, 'posting.md');
writeFrontmatter(posting, data, `\n# ${company}: ${role}\n\nLogged with log.mjs: applied outside the apply flow, so there's no fit analysis or company research yet. Add them if it reaches an interview.\n`);
console.log(`Logged ${relPath(root, dir)} (applied ${date}, resume: ${resume}${opts.source ? `, source: ${opts.source}` : ''}).`);
if (!opts.source) console.log('No --source given. Set source: in posting.md so the breakdowns count it.');

const tool = (name, ...a) => execFileSync(process.execPath, [join(PLUGIN, 'tools', name), ...a], { stdio: 'inherit', cwd: root });
if (resume === 'other') tool('tracker.mjs');
else {
  try { tool('freeze.mjs', relPath(root, dir), date); }
  catch { console.error(`The record is saved, but it isn't frozen yet. Render ${resume}, then run: node <tools>/freeze.mjs ${relPath(root, dir)} ${date}`); process.exitCode = 1; }
}
