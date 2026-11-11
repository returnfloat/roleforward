#!/usr/bin/env node
// Creates the record for a lead that has no job posting: a role a recruiter wrote about, or one a contact described.
//   node <tools>/lead.mjs "<Company>" "<Role>" --source <source> [--contact "<Full Name>"] [--date YYYY-MM-DD]
//        [--stage interested|conversation]
//
// - The record is applications/<company-slug>/<date>-<role-slug>/, like any posting's. An existing company folder is
//   reused when its postings name the same company, and the same company and role twice is refused.
// - posting.md comes from the posting template, with the first event on --date (default today): conversation (the
//   default: the user is talking with someone at the employer) or interested (they've heard of it, and no one is talking yet).
// - lead.md comes from the lead template and stands in for jd.md: what's known about the role, who said it, what's still
//   unknown, and the questions to ask. When a formal job description arrives, jd.md is captured as usual and lead.md stays.
// - --contact is the person the lead came through. With --source referral, they're recorded as the referrer too.
// Then the tracker is rebuilt.

import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFrontmatter, writeFrontmatter } from './frontmatter.mjs';
import { loadWorkspace, PLUGIN, relPath } from './workspace.mjs';
import { SOURCES, isDate, newRecordDir, today } from './records.mjs';

const { root } = loadWorkspace();
const fail = (msg) => { console.error(msg); process.exit(1); };
const USAGE = 'Usage: node lead.mjs "<Company>" "<Role>" --source <source> [--contact "<Name>"] [--date YYYY-MM-DD] [--stage interested|conversation]';

const args = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i] ?? '';
  else pos.push(args[i]);
}
let [company, role] = pos;
if (!company || !role) { console.error(USAGE); process.exit(2); }
const date = opts.date || today();
const stage = opts.stage || 'conversation';
const contact = opts.contact || '';
if (!isDate(date)) fail(`--date must be YYYY-MM-DD, got ${date}`);
if (!opts.source) fail(`--source is needed, so the breakdowns count the lead: one of ${SOURCES.join(', ')}`);
if (!SOURCES.includes(opts.source)) fail(`--source must be one of ${SOURCES.join(', ')}`);
if (!['interested', 'conversation'].includes(stage)) fail('--stage must be interested or conversation');

let dir;
try { ({ dir, company } = newRecordDir(root, company, role, date)); } catch (e) { fail(e.message); }
mkdirSync(dir, { recursive: true });

// Both files start from the plugin's templates, so a lead's record reads like any other posting's.
const template = (name) => readFrontmatter(join(PLUGIN, 'templates', 'applications', name));
const heading = (body) => body.replace(/^# Company: Role/m, `# ${company}: ${role}`);
const referral = opts.source === 'referral' && contact;

const posting = template('posting-template.md');
writeFrontmatter(join(dir, 'posting.md'), {
  ...posting.data, title: `${company}: ${role} (fit analysis)`, company, role, jd: '', source: opts.source,
  referral: referral ? 'true' : 'false', referrer: referral ? contact : '',
  events: [`${date} | ${stage} | lead without a posting${contact ? `, through ${contact}` : ''}`], next: '', updated: date,
}, heading(posting.body));

const lead = template('lead-template.md');
writeFrontmatter(join(dir, 'lead.md'), { ...lead.data, title: `Lead: ${company}, ${role}`, company, role, contact, source: opts.source, first_heard: date }, heading(lead.body));

console.log(`Created ${relPath(root, dir)} (${stage} ${date}, source: ${opts.source}${contact ? `, contact: ${contact}` : ''}), with posting.md and lead.md.`);
execFileSync(process.execPath, [join(PLUGIN, 'tools', 'tracker.mjs')], { stdio: 'inherit', cwd: root });
