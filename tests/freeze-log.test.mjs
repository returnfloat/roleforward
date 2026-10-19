// Freezing a submitted application (freeze.mjs) and logging one made outside the apply flow (log.mjs). The resume PDF
// is a stand-in file here: freezing copies and hashes it, and never reads it, so these tests need no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { readFrontmatter } from '../plugins/roleforward/tools/frontmatter.mjs';
import { buildWorkspace, daysAgo } from './fixture.mjs';

// A workspace with the default resume "rendered", so it can be frozen.
function rendered() {
  const ws = buildWorkspace();
  ws.write('output/Test-Candidate-Resume-Apply.pdf', '%PDF stand-in');
  ws.write('output/Test-Candidate-Resume.txt', 'TEST CANDIDATE\n');
  const later = new Date(Date.now() + 1000);
  for (const f of ['Test-Candidate-Resume-Apply.pdf', 'Test-Candidate-Resume.txt']) utimesSync(join(ws.root, 'output', f), later, later);
  // Frozen files are read-only, so make them writable again before the folder is removed (Windows refuses otherwise).
  const cleanup = ws.cleanup;
  ws.cleanup = () => { for (const p of ws.postings) { const d = join(ws.root, ws.folder(p.slug)); if (existsSync(d)) for (const f of readdirSync(d)) chmodSync(join(d, f), 0o644); } cleanup(); };
  return ws;
}
const writable = (file) => (statSync(file).mode & 0o222) !== 0;

test('freeze snapshots the resume, hashes the files, makes them read-only, and adds the applied event', () => {
  const ws = rendered();
  try {
    const folder = ws.folder('employer-b');
    ws.write(`${folder}/posting.md`, ws.read(`${folder}/posting.md`).replace('resume: tbd', 'resume: resume.md'));
    ws.write(`${folder}/answers.md`, 'Example answers.\n');
    const out = ws.run('freeze', [folder, daysAgo(1)]);
    assert.match(out, new RegExp(`^Frozen ${folder} \\(applied ${daysAgo(1)}, resume: resume\\.md\\)\\. Read-only: resume\\.md, Test-Candidate-Resume\\.pdf, Test-Candidate-Resume\\.txt, answers\\.md, jd\\.md\\n`));
    const { data } = readFrontmatter(join(ws.root, folder, 'posting.md'));
    assert.equal(data.frozen, daysAgo(1));
    assert.deepEqual(Object.keys(data.frozen_files), ['resume.md', 'Test-Candidate-Resume.pdf', 'Test-Candidate-Resume.txt', 'answers.md', 'jd.md']);
    assert.ok(Object.values(data.frozen_files).every((h) => /^[0-9a-f]{64}$/.test(h)));
    assert.equal(data.events.at(-1), `${daysAgo(1)} | applied`);
    assert.match(ws.read(`${folder}/resume.md`), /^---\nfrozen: \d{4}-\d{2}-\d{2}\nsnapshot_of: resume\.md\ntitle: "Test Candidate: Resume \(default\)"/);
    for (const f of Object.keys(data.frozen_files)) assert.equal(writable(join(ws.root, folder, f)), false, f);
    assert.equal(writable(join(ws.root, folder, 'posting.md')), true, 'posting.md stays writable for later events');
    assert.match(ws.read('applications/tracker.md'), /Employer B \| Staff Data Engineer \| .* \| applied \|/, 'the tracker was rebuilt');
  } finally { ws.cleanup(); }
});

test('freeze --check passes untouched records and names a changed file', () => {
  const ws = rendered();
  try {
    const folder = ws.folder('employer-b');
    ws.write(`${folder}/posting.md`, ws.read(`${folder}/posting.md`).replace('resume: tbd', 'resume: resume.md'));
    ws.run('freeze', [folder]);
    assert.equal(ws.run('freeze', ['--check']).trim(), '1 frozen posting checked, 0 changed files');
    chmodSync(join(ws.root, folder, 'jd.md'), 0o644);
    ws.write(`${folder}/jd.md`, 'Edited after submitting.\n');
    const r = ws.fails('freeze', ['--check']);
    assert.equal(r.status, 1);
    assert.match(r.out, new RegExp(`CHANGED: ${folder}/jd\\.md`.replace(/\//g, '[\\\\/]')));
  } finally { ws.cleanup(); }
});

test('freeze refuses a stale render, a missing render, a second freeze, and an unknown resume', () => {
  const ws = rendered();
  try {
    const folder = ws.folder('employer-b'), posting = `${folder}/posting.md`;
    ws.write(posting, ws.read(posting).replace('resume: tbd', 'resume: resume.md'));
    const future = new Date(Date.now() + 60000);
    utimesSync(join(ws.root, 'resume.md'), future, future);
    assert.match(ws.fails('freeze', [folder]).out, /output[\\/]Test-Candidate-Resume-Apply\.pdf is older than resume\.md\. Render it first\./);

    ws.write(posting, ws.read(posting).replace('resume: resume.md', 'resume: variants/leadership.md'));
    assert.match(ws.fails('freeze', [folder]).out, /Missing variants[\\/]leadership\.md\. Render it first\./);

    ws.write(posting, ws.read(posting).replace('resume: variants/leadership.md', 'resume: old-resume.docx'));
    assert.match(ws.fails('freeze', [folder]).out, /resume: must be resume\.md, variants\/<name>\.md, or tailored/);

    ws.write(posting, ws.read(posting).replace('resume: old-resume.docx', 'resume: resume.md').replace('updated:', 'frozen: 2026-01-01\nupdated:'));
    assert.match(ws.fails('freeze', [folder]).out, /Already frozen on 2026-01-01\./);
    assert.match(ws.fails('freeze', [folder, 'yesterday']).out, /Applied date must be YYYY-MM-DD/);
  } finally { ws.cleanup(); }
});

test('a tailored resume is frozen from the posting folder', () => {
  const ws = rendered();
  try {
    const folder = ws.folder('employer-b'), posting = `${folder}/posting.md`;
    ws.write(posting, ws.read(posting).replace('resume: tbd', 'resume: tailored'));
    ws.write(`${folder}/resume.md`, ws.read('resume.md'));
    ws.write(`${folder}/Test-Candidate-Resume.pdf`, '%PDF tailored stand-in');
    ws.write(`${folder}/Test-Candidate-Resume.txt`, 'TAILORED\n');
    const later = new Date(Date.now() + 1000);
    utimesSync(join(ws.root, folder, 'Test-Candidate-Resume.pdf'), later, later);
    ws.run('freeze', [folder]);
    assert.equal(ws.read(`${folder}/Test-Candidate-Resume.txt`), 'TAILORED\n', 'its own render, not the default');
    assert.match(ws.read(`${folder}/resume.md`), /^---\nfrozen: \d{4}-\d{2}-\d{2}\ntitle:/, 'no snapshot_of line');
  } finally { ws.cleanup(); }
});

test('log records an outside application and freezes it with the default resume', () => {
  const ws = rendered();
  try {
    const out = ws.run('log', ['Employer Z', 'Senior Data Engineer', '--date', daysAgo(2), '--source', 'linkedin', '--location', 'Example City, ST', '--work-mode', 'hybrid']);
    const folder = `applications/employer-z/${daysAgo(2)}-senior-data-engineer`;
    assert.match(out, new RegExp(`^Logged ${folder} \\(applied ${daysAgo(2)}, resume: resume\\.md, source: linkedin\\)\\.`));
    const { data } = readFrontmatter(join(ws.root, folder, 'posting.md'));
    assert.deepEqual([data.company, data.source, data.work_mode, data.location, data.frozen], ['Employer Z', 'linkedin', 'hybrid', 'Example City, ST', daysAgo(2)]);
    assert.deepEqual(data.events, [`${daysAgo(2)} | applied | logged after applying outside the apply flow`]);
    chmodSync(join(ws.root, folder, 'resume.md'), 0o644);
    for (const f of ['Test-Candidate-Resume.pdf', 'Test-Candidate-Resume.txt']) chmodSync(join(ws.root, folder, f), 0o644);
  } finally { ws.cleanup(); }
});

test('log reuses a company folder and its spelling, and refuses a duplicate', () => {
  const ws = rendered();
  try {
    ws.run('log', ['employer b', 'Lead Data Engineer', '--resume', 'other', '--source', 'referral', '--referrer', 'Example Referrer']);
    const dirs = readdirSync(join(ws.root, 'applications', 'employer-b'));
    assert.equal(dirs.filter((d) => d.endsWith('-lead-data-engineer')).length, 1);
    const { data } = readFrontmatter(join(ws.root, 'applications', 'employer-b', dirs.find((d) => d.endsWith('-lead-data-engineer')), 'posting.md'));
    assert.deepEqual([data.company, data.referral, data.referrer, data.resume, data.frozen], ['Employer B', 'true', 'Example Referrer', 'other', undefined]);
    assert.match(ws.fails('log', ['Employer B', 'Staff Data Engineer', '--resume', 'other']).out, /already records this role\. Add an event to it instead\./);
  } finally { ws.cleanup(); }
});

test('log checks its options', () => {
  const ws = rendered();
  try {
    assert.match(ws.fails('log', ['Employer Z', 'Role', '--source', 'billboard']).out, /--source must be one of scout, recruiter-inbound, referral/);
    assert.match(ws.fails('log', ['Employer Z', 'Role', '--date', 'today']).out, /--date must be YYYY-MM-DD/);
    assert.match(ws.fails('log', ['Employer Z', 'Role', '--work-mode', 'sometimes']).out, /--work-mode must be remote, hybrid, or onsite/);
    assert.match(ws.fails('log', ['Employer Z', 'Role', '--resume', 'variants/missing.md']).out, /No variants\/missing\.md in the workspace\./);
    assert.equal(ws.fails('log', ['Employer Z']).status, 2);
  } finally { ws.cleanup(); }
});
