#!/usr/bin/env node
// A posting's next action: the optional next field in posting.md, "YYYY-MM-DD | what happens next", where the date is
// when to act or check back.
//   node <tools>/next.mjs set <posting folder> <YYYY-MM-DD> "<what happens next>"
//   node <tools>/next.mjs clear <posting folder>
//   node <tools>/next.mjs list [--due]
//
// - set and clear change only the next line and updated in posting.md, leaving every other byte as it was, then rebuild
//   the tracker. set refuses a posting that has ended. clear works on any posting.
// - list prints one line per live posting, for the user or another skill's report: overdue first, then due within 3
//   days, then later, then live postings with no next action. Each line has the date, the posting, the action, its
//   current stage and how many days it has been there, and its folder. With --due, only the lines that need the user
//   now: overdue, due soon, or not in the right format, and postings with no next action that the tracker's Needs
//   Attention list shows (a decision left 7 days, or an application or conversation quiet for 21), for a run report.
// An ended posting's next field is ignored everywhere, so a leftover one never shows as an open item.

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFrontmatter, setField } from './frontmatter.mjs';
import { loadWorkspace, PLUGIN, relPath } from './workspace.mjs';
import { LIVE, PIPELINE, eachPosting, eventsOf, stageOf, nextOf, isDate, daysBetween, today, SOON_DAYS, DECIDE_DAYS, STALE_DAYS } from './records.mjs';

const fail = (msg) => { console.error(msg); process.exit(1); };
const USAGE = 'Usage: node next.mjs set <posting folder> <YYYY-MM-DD> "<what happens next>" | clear <posting folder> | list [--due]';

function postingOf(root, folder) {
  if (!folder) fail(USAGE);
  const file = join(resolve(folder), 'posting.md');
  if (!existsSync(file)) fail(`No posting.md in ${relPath(root, resolve(folder))}.`);
  return file;
}

const tracker = (root) => execFileSync(process.execPath, [join(PLUGIN, 'tools', 'tracker.mjs')], { stdio: 'inherit', cwd: root });

function set(root, folder, date, action) {
  const file = postingOf(root, folder), { data } = readFrontmatter(file), stage = stageOf(data);
  if (!isDate(date)) fail(`The date must be YYYY-MM-DD, got ${date ?? 'nothing'}.`);
  action = String(action ?? '').replace(/\s+/g, ' ').trim();
  if (!action) fail('Say what happens next, for example "Follow up with the recruiter".');
  if (!LIVE.includes(stage)) fail(`${data.company}, ${data.role} has ended (${stage}), so it has no next action.`);
  setField(file, 'next', `${date} | ${action}`, today());
  console.log(`${data.company}, ${data.role}: next ${date}: ${action}`);
  tracker(root);
}

function clear(root, folder) {
  const file = postingOf(root, folder), { data } = readFrontmatter(file);
  if (!String(data.next ?? '').trim()) return console.log(`${data.company}, ${data.role} has no next action. Nothing to clear.`);
  setField(file, 'next', '', today());
  console.log(`${data.company}, ${data.role}: next action cleared.`);
  tracker(root);
}

// A posting with no next action that needs the user anyway, by the tracker's rules: a decision left DECIDE_DAYS, or an
// application or conversation quiet for STALE_DAYS.
const needsUser = (r) => (['shortlisted', 'interested'].includes(r.stage) && r.inStage >= DECIDE_DAYS)
  || ((r.stage === 'conversation' || PIPELINE.indexOf(r.stage) >= PIPELINE.indexOf('applied')) && r.inStage >= STALE_DAYS);

function list(root, due) {
  const now = today(), rows = [];
  for (const p of eachPosting(root)) {
    const { data } = readFrontmatter(p.file), stage = stageOf(data);
    if (!LIVE.includes(stage)) continue;
    const last = eventsOf(data).at(-1)?.date, n = nextOf(data);
    const inStage = last ? daysBetween(last, now) : 0;
    const when = !n ? 'none' : n.bad ? 'check' : n.date < now ? 'overdue' : daysBetween(now, n.date) <= SOON_DAYS ? 'due soon' : 'later';
    rows.push({ when, date: n?.date ?? '', what: n?.bad ? `next isn't "YYYY-MM-DD | what happens next": ${n.bad}` : n?.action ?? 'no next action',
      name: `${data.company}, ${data.role}`, stage, inStage, id: p.id });
  }
  const ORDER = ['check', 'overdue', 'due soon', 'later', 'none'];
  rows.sort((a, b) => ORDER.indexOf(a.when) - ORDER.indexOf(b.when) || a.date.localeCompare(b.date) || b.inStage - a.inStage || a.name.localeCompare(b.name));
  if (!rows.length) return console.log('No live postings.');
  const shown = due ? rows.filter((r) => ['check', 'overdue', 'due soon'].includes(r.when) || (r.when === 'none' && needsUser(r))) : rows;
  if (!shown.length) return console.log('Nothing is due or waiting on the user.');
  for (const r of shown)
    console.log(`${r.when.padEnd(8)}  ${(r.date || '-').padEnd(10)}  ${r.name}: ${r.what} (${r.stage} for ${r.inStage} day${r.inStage === 1 ? '' : 's'}, ${r.id})`);
}

const [cmd, folder, ...rest] = process.argv.slice(2);
const { root } = loadWorkspace();
if (cmd === 'set') set(root, folder, rest[0], rest.slice(1).join(' '));
else if (cmd === 'clear') clear(root, folder);
else if (cmd === 'list') list(root, folder === '--due');
else { console.error(USAGE); process.exit(2); }
