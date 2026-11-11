// Leads without a posting (lead.mjs, the conversation stage), next actions (next.mjs and the tracker's Needs Attention),
// and the offer stage's checks (tracker.mjs, docs.mjs). Everything runs on the placeholder test workspace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../plugins/roleforward/tools/csv.mjs';
import { readFrontmatter, appendEvent } from '../plugins/roleforward/tools/frontmatter.mjs';
import { parseYaml } from '../plugins/roleforward/tools/workspace.mjs';
import { buildWorkspace, daysAgo } from './fixture.mjs';

const LEAD = `applications/employer-q/${daysAgo(2)}-head-of-data`;
const newLead = (ws, ...extra) => ws.run('lead', ['Employer Q', 'Head of Data', '--source', 'network', '--contact', 'Example Contact', '--date', daysAgo(2), ...extra]);
const attention = (ws) => ws.read('applications/tracker.md').split('## Needs Attention')[1].split('## Funnel')[0];
const csvRow = (ws, company) => parseCsv(ws.read('applications/data/applications.csv')).find((r) => r.company === company);
const fm = (text) => parseYaml(text.match(/^---\n([\s\S]*?)\n---\n/)[1]);

// ---- Leads ----

test('lead.mjs creates posting.md and lead.md from the templates, in conversation, and rebuilds the tracker', () => {
  const ws = buildWorkspace();
  try {
    const out = newLead(ws);
    assert.match(out, new RegExp(`^Created ${LEAD} \\(conversation ${daysAgo(2)}, source: network, contact: Example Contact\\), with posting\\.md and lead\\.md\\.\\n`));
    assert.match(out, /\(5 postings, 1 applied\)/, 'the tracker was rebuilt');
    const { data, body } = readFrontmatter(join(ws.root, LEAD, 'posting.md'));
    assert.deepEqual([data.company, data.role, data.source, data.referral, data.referrer, data.jd, data.resume, data.next],
      ['Employer Q', 'Head of Data', 'network', 'false', '', '', 'tbd', '']);
    assert.deepEqual(data.events, [`${daysAgo(2)} | conversation | lead without a posting, through Example Contact`]);
    assert.match(body, /^# Employer Q: Head of Data$/m);
    assert.match(body, /^## Triage$/m, 'the posting template body');
    const lead = ws.read(`${LEAD}/lead.md`);
    assert.deepEqual(fm(lead), { title: 'Lead: Employer Q, Head of Data', company: 'Employer Q', role: 'Head of Data', contact: 'Example Contact', source: 'network', first_heard: daysAgo(2) },
      'valid YAML for Obsidian');
    for (const h of ["What's Known", 'Still Unknown', 'Questions to Ask', 'Conversations']) assert.match(lead, new RegExp(`^## ${h}$`, 'm'), h);
    assert.equal(existsSync(join(ws.root, LEAD, 'jd.md')), false);
    assert.equal(csvRow(ws, 'Employer Q').status, 'conversation');
    assert.match(ws.read('applications/tracker.md'), /1 in conversation/);
  } finally { ws.cleanup(); }
});

test('lead.mjs: --stage interested, a referral, a reused company folder, and a refused duplicate', () => {
  const ws = buildWorkspace();
  try {
    ws.run('lead', ['employer b', 'Data Platform Lead', '--source', 'referral', '--contact', 'Example Referrer', '--stage', 'interested']);
    const dir = readdirSync(join(ws.root, 'applications', 'employer-b')).find((d) => d.endsWith('-data-platform-lead'));
    assert.ok(dir, 'the existing company folder');
    const { data } = readFrontmatter(join(ws.root, 'applications', 'employer-b', dir, 'posting.md'));
    assert.deepEqual([data.company, data.referral, data.referrer], ['Employer B', 'true', 'Example Referrer'], 'the spelling on record');
    assert.match(data.events[0], /^\d{4}-\d{2}-\d{2} \| interested \| lead without a posting, through Example Referrer$/);
    assert.match(ws.fails('lead', ['Employer B', 'Staff Data Engineer', '--source', 'network']).out, /already records this role\. Add an event to it instead\./);
  } finally { ws.cleanup(); }
});

test('lead.mjs checks its options', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.fails('lead', ['Employer Q', 'Role']).out, /--source is needed/);
    assert.match(ws.fails('lead', ['Employer Q', 'Role', '--source', 'billboard']).out, /--source must be one of scout, recruiter-inbound/);
    assert.match(ws.fails('lead', ['Employer Q', 'Role', '--source', 'network', '--stage', 'applied']).out, /--stage must be interested or conversation/);
    assert.match(ws.fails('lead', ['Employer Q', 'Role', '--source', 'network', '--date', '2026-02-30']).out, /--date must be YYYY-MM-DD/);
    assert.equal(ws.fails('lead', ['Employer Q']).status, 2);
    assert.equal(existsSync(join(ws.root, 'applications', 'employer-q')), false, 'nothing written');
  } finally { ws.cleanup(); }
});

test('a lead with no jd.md is a normal record for the sheet, the Drive packet, and the doctor', () => {
  const ws = buildWorkspace({ drive: true });
  try {
    newLead(ws);
    const row = JSON.parse(ws.run('sheet', ['rows', 'shortlist'])).find((r) => r[0] === 'Employer Q');
    assert.equal(row[2], 'conversation');
    const id = LEAD.replace('applications/', '');
    assert.match(ws.run('docs', ['list']), new RegExp(`^${id}\\n {2}Employer Q · Head of Data: no Doc yet$`, 'm'));
    assert.match(ws.run('docs', ['markdown', id]), /\*\*Stage:\*\* conversation/);
    assert.doesNotMatch(ws.fails('doctor').out, /jd\.md|lead\.md|employer-q/i);
  } finally { ws.cleanup(); }
});

test('the conversation stage is never a response, and a lead that goes straight to an interview counts as applied', () => {
  const ws = buildWorkspace();
  try {
    newLead(ws);
    ws.run('tracker');
    assert.deepEqual([csvRow(ws, 'Employer Q').applied, csvRow(ws, 'Employer Q').responded], ['', '']);
    appendEvent(join(ws.root, LEAD, 'posting.md'), `${daysAgo(1)} | hiring-manager | met the team lead`, daysAgo(1));
    ws.run('tracker');
    const r = csvRow(ws, 'Employer Q');
    assert.deepEqual([r.applied, r.responded, r.furthest], [daysAgo(1), 'yes', 'hiring-manager']);
  } finally { ws.cleanup(); }
});

test('freeze makes lead.md read-only when there is no jd.md', () => {
  const ws = buildWorkspace();
  try {
    newLead(ws);
    ws.write('output/Test-Candidate-Resume-Apply.pdf', '%PDF stand-in');
    ws.write('output/Test-Candidate-Resume.txt', 'TEST CANDIDATE\n');
    const later = new Date(Date.now() + 1000);
    for (const f of ['Test-Candidate-Resume-Apply.pdf', 'Test-Candidate-Resume.txt']) utimesSync(join(ws.root, 'output', f), later, later);
    const p = `${LEAD}/posting.md`;
    ws.write(p, ws.read(p).replace('resume: tbd', 'resume: resume.md'));
    assert.match(ws.run('freeze', [LEAD]), /Read-only: resume\.md, Test-Candidate-Resume\.pdf, Test-Candidate-Resume\.txt, lead\.md\n/);
    assert.equal(statSync(join(ws.root, LEAD, 'lead.md')).mode & 0o222, 0);
    assert.deepEqual(readFrontmatter(join(ws.root, p)).data.events.map((e) => e.split(' | ')[1]), ['conversation', 'applied']);
    for (const f of readdirSync(join(ws.root, LEAD))) chmodSync(join(ws.root, LEAD, f), 0o644);
  } finally { ws.cleanup(); }
});

// ---- Next actions ----

test('next.mjs set and clear change only the next and updated lines, and rebuild the tracker', () => {
  const ws = buildWorkspace();
  try {
    const p = `${ws.folder('employer-c')}/posting.md`, before = ws.read(p);
    assert.match(ws.run('next', ['set', ws.folder('employer-c'), daysAgo(-5), 'Follow up with the recruiter']), /^Employer C, Lead Data Engineer: next \d{4}-\d{2}-\d{2}: Follow up with the recruiter\nWrote applications\/tracker\.md/);
    const after = ws.read(p);
    const strip = (t) => t.replace(/^next:.*\n/m, '').replace(/^updated:.*$/m, 'updated:');
    assert.equal(strip(after), strip(before), 'nothing else changed');
    assert.match(after, new RegExp(`\\n  - ${daysAgo(25)} \\| recruiter-screen \\| 30 min with the recruiter\\nnext: ${daysAgo(-5)} \\| Follow up with the recruiter\\nupdated: ${daysAgo(0)}\\n`), 'added after the events');
    assert.equal(csvRow(ws, 'Employer C').next_action, 'Follow up with the recruiter');
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(-6), 'Ask about the panel: who is on it?']);
    assert.match(ws.read(p), /^next: "\d{4}-\d{2}-\d{2} \| Ask about the panel: who is on it\?"$/m, 'quoted when YAML needs it');
    assert.equal(readFrontmatter(join(ws.root, p)).data.next, `${daysAgo(-6)} | Ask about the panel: who is on it?`);
    ws.run('next', ['clear', ws.folder('employer-c')]);
    assert.match(ws.read(p), /^next:\nupdated:/m);
    assert.match(ws.run('next', ['clear', ws.folder('employer-c')]), /has no next action\. Nothing to clear\./);
  } finally { ws.cleanup(); }
});

test('next.mjs refuses an ended posting, a bad date, an empty action, and a folder with no record', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.fails('next', ['set', ws.folder('employer-d'), daysAgo(-1), 'Anything']).out, /Employer D, Principal Data Engineer has ended \(passed\), so it has no next action\./);
    assert.match(ws.fails('next', ['set', ws.folder('employer-c'), 'tomorrow', 'Anything']).out, /The date must be YYYY-MM-DD/);
    assert.match(ws.fails('next', ['set', ws.folder('employer-c'), daysAgo(-1)]).out, /Say what happens next/);
    assert.match(ws.fails('next', ['set', 'applications/nobody/nothing', daysAgo(-1), 'Anything']).out, /No posting\.md in applications\/nobody\/nothing/);
    assert.equal(ws.fails('next', ['later']).status, 2);
  } finally { ws.cleanup(); }
});

test('next.mjs list: overdue, then due soon, then later, then none, one line each with days in stage', () => {
  const ws = buildWorkspace();
  try {
    newLead(ws);
    ws.run('next', ['set', LEAD, daysAgo(-10), 'Check back with the contact']);
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(2), 'Follow up with the recruiter']);
    ws.run('next', ['set', ws.folder('employer-b'), daysAgo(-2), 'Apply']);
    const lines = ws.run('next', ['list']).trim().split('\n');
    assert.deepEqual(lines.map((l) => l.split(/\s{2,}/)[0]), ['overdue', 'due soon', 'later', 'none']);
    assert.equal(lines[0], `overdue   ${daysAgo(2)}  Employer C, Lead Data Engineer: Follow up with the recruiter (recruiter-screen for 25 days, ${ws.folder('employer-c').replace('applications/', '')})`);
    assert.match(lines[1], /^due soon  \d{4}-\d{2}-\d{2}  Employer B, Staff Data Engineer: Apply \(interested for 6 days, /);
    assert.match(lines[2], /Employer Q, Head of Data: Check back with the contact \(conversation for 2 days, /);
    assert.match(lines[3], /^none      -           Employer A, Senior Data Engineer: no next action \(shortlisted for 3 days, /);
    assert.doesNotMatch(lines.join('\n'), /Employer D/, 'ended postings are left out');
  } finally { ws.cleanup(); }
});

test('next.mjs list --due: only the lines that need the user now, by the tracker\'s rules', () => {
  const ws = buildWorkspace();
  try {
    // Shortlisted 3 days and interested 6: not yet. The application quiet for 25 days with no next action: yes.
    let lines = ws.run('next', ['list', '--due']).trim().split('\n');
    assert.deepEqual(lines.map((l) => l.split(/\s{2,}/)[0]), ['none']);
    assert.match(lines[0], /Employer C, Lead Data Engineer: no next action \(recruiter-screen for 25 days, /);
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(-10), 'Check back with the recruiter']);
    ws.run('next', ['set', ws.folder('employer-b'), daysAgo(1), 'Apply, or pass']);
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(-2), 'Decide on it']);
    lines = ws.run('next', ['list', '--due']).trim().split('\n');
    assert.deepEqual(lines.map((l) => l.split(/\s{2,}/)[0]), ['overdue', 'due soon'], 'a later next action means waiting on purpose');
    ws.run('next', ['clear', ws.folder('employer-b')]);
    ws.run('next', ['clear', ws.folder('employer-a')]);
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(-10), 'Check back with the recruiter']);
    assert.equal(ws.run('next', ['list', '--due']), 'Nothing is due or waiting on the user.\n');
    assert.equal(ws.run('next', ['list']).trim().split('\n').length, 3, 'list alone shows every live posting');
  } finally { ws.cleanup(); }
});

test('an ending logged anywhere leaves no open next action behind', () => {
  const ws = buildWorkspace();
  try {
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(1), 'Follow up with the recruiter']);
    // An ending written the way the scout's closure check and sheet.mjs pull --apply write one: an appended event only.
    appendEvent(join(ws.root, ws.folder('employer-c'), 'posting.md'), `${daysAgo(0)} | rejected | Example reason`, daysAgo(0));
    ws.run('tracker');
    assert.match(ws.read(`${ws.folder('employer-c')}/posting.md`), /^next: /m, 'the field is still there');
    assert.equal(csvRow(ws, 'Employer C').next_date, '');
    assert.doesNotMatch(attention(ws), /Follow up with the recruiter/);
    assert.doesNotMatch(ws.run('next', ['list']), /Employer C/);
    assert.match(ws.run('next', ['clear', ws.folder('employer-c')]), /next action cleared/, 'clear tidies an ended posting');
  } finally { ws.cleanup(); }
});

test('Needs Attention: next actions due within 3 days in date order, and a future one means waiting on purpose', () => {
  const ws = buildWorkspace();
  try {
    ws.run('next', ['set', ws.folder('employer-b'), daysAgo(-2), 'Apply, or pass']);
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(0), 'Decide on it']);
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(-10), 'Check back if the recruiter is still quiet']);
    let a = attention(ws);
    const lines = a.trim().split('\n');
    assert.equal(lines[0], '- **Employer A, Senior Data Engineer:** Decide on it. Due today.');
    assert.equal(lines[1], `- **Employer B, Staff Data Engineer:** Apply, or pass. Due ${daysAgo(-2)}, in 2 days.`);
    assert.doesNotMatch(a, /no update in/, 'a future next action is waiting on purpose');
    assert.doesNotMatch(a, /Check back if the recruiter/, 'not due within 3 days');
    assert.doesNotMatch(a, /Interested or pass\?|Apply or pass\./, 'the decision has a date');
    ws.run('next', ['set', ws.folder('employer-c'), daysAgo(3), 'Follow up with the recruiter']);
    a = attention(ws);
    assert.match(a, /- \*\*Employer C, Lead Data Engineer:\*\* Follow up with the recruiter\. Overdue by 3 days \(due \d{4}-\d{2}-\d{2}\)\.\n/);
    assert.match(a, /Employer C, Lead Data Engineer:\*\* no update in 25 days/, 'overdue: the quiet flag comes back');
    assert.ok(a.indexOf('Overdue by 3') < a.indexOf('Due today'), 'date order');
    assert.match(ws.read('applications/tracker.md'), /\| recruiter-screen \| [\d-]+ \| [\d-]+ \| \d{4}-\d{2}-\d{2}: Follow up with the recruiter \|/, 'the table shows it');
    const row = JSON.parse(ws.run('sheet', ['rows', 'shortlist'])).find((r) => r[0] === 'Employer C');
    assert.equal(row[6], `${daysAgo(3)} · Follow up with the recruiter`, 'the sheet shows it after Last event');
  } finally { ws.cleanup(); }
});

test('Needs Attention: a decision left 7 days with no next action is waiting on the user', () => {
  const ws = buildWorkspace();
  try {
    const p = `${ws.folder('employer-b')}/posting.md`;
    ws.write(p, ws.read(p).replace(/  - \d{4}-\d{2}-\d{2} \| interested/, `  - ${daysAgo(7)} | interested`));
    ws.run('tracker');
    const a = attention(ws);
    assert.match(a, /Employer B, Staff Data Engineer:\*\* waiting on your decision for 7 days, interested since/);
    assert.match(a, /Employer A, Senior Data Engineer:\*\* shortlisted /, 'under 7 days: the usual line');
    assert.doesNotMatch(a, /Employer A[^\n]*waiting on your decision/);
  } finally { ws.cleanup(); }
});

test('Needs Attention: a next field in the wrong format is flagged', () => {
  const ws = buildWorkspace();
  try {
    const p = `${ws.folder('employer-b')}/posting.md`;
    ws.write(p, ws.read(p).replace(/^updated:/m, 'next: soon\nupdated:'));
    ws.run('tracker');
    assert.match(attention(ws), /Employer B, Staff Data Engineer:\*\* its next field isn't "YYYY-MM-DD \| what happens next" \(now "soon"\)/);
    assert.match(ws.run('next', ['list']), /^check {5}-/m);
  } finally { ws.cleanup(); }
});

// ---- Offers ----

test('an offer with no offer.md needs attention, and offer.md never goes into a Drive packet', () => {
  const ws = buildWorkspace({ drive: true });
  try {
    const dir = ws.folder('employer-c');
    appendEvent(join(ws.root, dir, 'posting.md'), `${daysAgo(0)} | offer`, daysAgo(0));
    ws.run('tracker');
    assert.match(attention(ws), /Employer C, Lead Data Engineer:\*\* an offer with no offer\.md yet\./);
    ws.write(`${dir}/offer.md`, '---\ntitle: "Offer: Employer C, Lead Data Engineer"\n---\n\n# Employer C\n\n## Terms\n\nExample offer term.\n');
    ws.run('tracker');
    assert.doesNotMatch(attention(ws), /offer\.md/);
    assert.doesNotMatch(ws.run('docs', ['markdown', dir.replace('applications/', '')]), /Example offer term|## Terms/);
  } finally { ws.cleanup(); }
});
