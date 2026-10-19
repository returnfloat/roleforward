// The tracker (tracker.mjs) and the index it rebuilds (index.mjs), from the test workspace's records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../plugins/roleforward/tools/csv.mjs';
import { PLUGIN, buildWorkspace, daysAgo } from './fixture.mjs';

const ws = buildWorkspace();
test.after(() => ws.cleanup());
const out = ws.run('tracker');
const apps = parseCsv(ws.read('applications/data/applications.csv'));
const byCompany = Object.fromEntries(apps.map((r) => [r.company, r]));

test('tracker reports what it wrote', () => {
  assert.equal(out.trim(), 'Wrote applications/tracker.md, data/*.csv, and INDEX.md (4 postings, 1 applied)');
});

test('applications.csv has one row per posting, with status, scores, and record IDs', () => {
  assert.deepEqual(apps.map((r) => [r.company, r.status, r.role_fit, r.preference_fit]), [
    ['Employer A', 'shortlisted', '4', '5'], ['Employer B', 'interested', '3', '3.6'],
    ['Employer C', 'recruiter-screen', '5', '3.4'], ['Employer D', 'passed', '2', '3.8']]);
  assert.equal(byCompany['Employer A'].id, ws.folder('employer-a').replace('applications/', ''));
  assert.doesNotMatch(apps.map((r) => r.id).join(), /\\/, 'record IDs use forward slashes');
});

test('the applied posting has its response, timing, and referral', () => {
  const c = byCompany['Employer C'];
  assert.deepEqual([c.applied, c.responded, c.first_response_days, c.furthest, c.referral, c.days_since_last_event],
    [daysAgo(30), 'yes', '5', 'recruiter-screen', 'yes', '25']);
  assert.equal(byCompany['Employer A'].responded, '');
});

test('company research is joined onto its postings', () => {
  assert.equal(byCompany['Employer B'].ownership, 'private-vc');
  assert.equal(byCompany['Employer A'].ownership, '');
});

test('events.csv has one row per event', () => {
  const events = parseCsv(ws.read('applications/data/events.csv'));
  assert.equal(events.length, 9);
  assert.deepEqual(events.filter((e) => e.company === 'Employer C').map((e) => e.stage), ['shortlisted', 'interested', 'applied', 'recruiter-screen']);
  assert.equal(events.find((e) => e.stage === 'recruiter-screen').note, '30 min with the recruiter');
});

test('stats.json counts the scout and the drops by dealbreaker or setting', () => {
  const stats = JSON.parse(ws.read('applications/data/stats.json'));
  const summary = Object.fromEntries(stats.summary);
  assert.equal(summary['Postings tracked'], 4);
  assert.equal(summary['Scout: postings screened'], 8);
  assert.equal(summary['Scout: dropped'], 3);
  assert.equal(summary['Scout: held'], 1);
  assert.equal(summary['Response rate'], '100%');
  assert.deepEqual(stats.drops, [['Stale', 1], ['Wrong place', 1], ['Wrong role', 1]]);
});

test('tracker.md lists what needs attention, best fit first', () => {
  const md = ws.read('applications/tracker.md');
  const attention = md.split('## Needs Attention')[1].split('## Funnel')[0];
  assert.match(attention, /Employer C, Lead Data Engineer:\*\* no update in 25 days/);
  assert.match(attention, /Employer A, Senior Data Engineer:\*\* shortlisted .*role fit 4\/5, preference fit 5\/5/);
  assert.match(attention, /Employer B, Staff Data Engineer:\*\* interested since/);
  // apply.depth light asks for company research only once an interview is scheduled.
  assert.match(attention, /Employer C:\*\* company research not done yet \(interviewing\)/);
  assert.doesNotMatch(attention, /Employer B:\*\* company research/);
});

test('pruned postings in archive.csv still count', () => {
  const extra = buildWorkspace();
  try {
    extra.write('applications/data/archive.csv', 'id,company,role,source,role_fit,preference_fit,why,posting,shortlisted,outcome,ended,reason,archived\n'
      + `employer-z/x,Employer Z,Senior Data Engineer,scout,2,,Example,https://example.invalid/jobs/z,${daysAgo(90)},expired,${daysAgo(80)},,${daysAgo(40)}\n`);
    assert.match(extra.run('tracker'), /\(5 postings, 1 applied\)/);
    assert.match(extra.read('applications/tracker.md'), /\| Employer Z \| .* \| archived \d{4}-\d{2}-\d{2} \|/);
  } finally { extra.cleanup(); }
});

test('an unknown stage stops the tracker and names the file', () => {
  const bad = buildWorkspace();
  try {
    const f = `${bad.folder('employer-a')}/posting.md`;
    bad.write(f, bad.read(f).replace('| shortlisted', '| shortlistd'));
    const r = bad.fails('tracker');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /employer-a.*posting\.md: unknown stage "shortlistd"/);
  } finally { bad.cleanup(); }
});

test('INDEX.md links every record and core file, and README.md is the plugin README', () => {
  const index = ws.read('INDEX.md');
  for (const p of ws.postings) assert.match(index, new RegExp(`\\*\\*${p.role}\\*\\* \\(`));
  assert.match(index, /\[\[applications\/employer-b\/company\|Company research\]\] \(`applications\/employer-b\/company\.md`\): quick check/);
  assert.match(index, /\[\[career-direction\|career-direction\]\]/);
  assert.doesNotMatch(index, /\*\*\(missing\)\*\*/, 'every default core file exists in the test workspace');
  const readme = ws.read('README.md');
  assert.match(readme, /^<!-- Copied from the RoleForward plugin's README/);
  const shipped = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
  assert.ok(readme.endsWith(shipped), 'the README body is the plugin README');
});

test('a custom index.files list still lists module folders', () => {
  const custom = buildWorkspace({ connections: true });
  try {
    custom.write('workspace.yaml', custom.read('workspace.yaml').replace('index:\n  title: Career Workspace Index\n',
      'index:\n  title: Career Workspace Index\n  files:\n    - "output/ | Rendered resumes."\n'));
    custom.run('tracker');
    const index = custom.read('INDEX.md');
    assert.match(index, /- `output\/` \(not created yet\): Rendered resumes\./, 'the workspace\'s own entry stays');
    assert.match(index, /- `contacts\/` \(not created yet\): LinkedIn connections/);
    assert.doesNotMatch(index, /applications\/data\//, 'defaults the workspace replaced stay out');
  } finally { custom.cleanup(); }
});

test('the tracker writes nothing outside the workspace data it owns', () => {
  for (const f of ['applications/tracker.md', 'applications/data/applications.csv', 'applications/data/events.csv', 'applications/data/stats.json', 'INDEX.md', 'README.md'])
    assert.ok(existsSync(join(ws.root, f)), f);
});
