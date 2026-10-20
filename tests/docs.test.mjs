// Google Docs made on request in the Drive folder (docs.mjs): what each Doc holds, which copy is current, and the
// sheet's link to a posting's packet. docs.mjs never talks to Google, so everything here is local.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspace } from './fixture.mjs';

const idOf = (ws, slug) => ws.folder(slug).replace(/^applications\//, '');

test('docs.mjs markdown: a packet holds the fit, company, answers without self-identification, and prep plan', () => {
  const ws = buildWorkspace({ drive: true });
  try {
    const dir = ws.folder('employer-b');
    ws.write(`${dir}/answers.md`, '# Answers\n\n## Standard Fields\n\n- **Work authorization:** Example answer\n- **EEO questions:** Example choice\n\n## Voluntary Self-Identification (EEO)\n\n- **Gender, race and ethnicity, veteran, disability:** Example choice\n\n## Why This Company?\n\nExample reason, see [company.md](../company.md) and [[an example note]].\n');
    ws.write(`${dir}/prep.md`, '---\ntitle: Example\n---\n\n# Prep\n\n## Week 1\n\n- Example study item: https://example.invalid/guide\n');
    const md = ws.run('docs', ['markdown', idOf(ws, 'employer-b')]);
    assert.match(md, /^Employer B · Staff Data Engineer\n\n\*Made by RoleForward from your career workspace on \d{4}-\d{2}-\d{2}\. Asking for a fresh copy replaces this one, so edits made here aren't kept\.\*\n\n\*\*Stage:\*\* interested/);
    for (const h of ['Fit and Recommendation', 'Company', 'Application Answers', 'Prep Plan']) assert.match(md, new RegExp(`^# ${h}$`, 'm'), h);
    assert.match(md, /Work authorization:\*\* Example answer/);
    assert.doesNotMatch(md, /EEO|Self-Identification|Gender/, 'voluntary self-identification stays in the workspace');
    assert.match(md, /Example reason, see company\.md and an example note\./, 'workspace links keep their text only');
    assert.match(md, /- Example study item: https:\/\/example\.invalid\/guide/);
    assert.doesNotMatch(md, /^title: Example$/m, 'no front matter');
    assert.doesNotMatch(md, /^# Resume Sent$/m, 'not frozen yet');

    assert.match(ws.run('docs', ['markdown', 'prep']), /^Interview Prep\n\n\*Made by RoleForward/);
    assert.match(ws.fails('docs', ['markdown', 'nobody/nothing']).out, /No Doc for "nobody\/nothing"/);
  } finally { ws.cleanup(); }
});

test('docs.mjs list and record: a fresh copy replaces the last one, a change shows, and an ended posting archives', () => {
  const ws = buildWorkspace({ drive: true });
  try {
    const b = idOf(ws, 'employer-b'), c = idOf(ws, 'employer-c');
    const list = ws.run('docs', ['list']);
    assert.match(list, /^prep\n {2}Interview Prep: no Doc yet$/m);
    assert.match(list, new RegExp(`^${b}\\n {2}Employer B · Staff Data Engineer: no Doc yet$`, 'm'), 'interested');
    assert.match(list, new RegExp(`^${c}\\n`, 'm'), 'past applied');
    assert.doesNotMatch(list, /Employer A|Employer D/, 'only shortlisted, or ended without a Doc');

    assert.equal(ws.run('docs', ['record', b, '--doc', 'doc-1']).trim(), `${b}: https://docs.google.com/document/d/doc-1/edit`);
    assert.match(ws.run('docs', ['list']), new RegExp(`Employer B · Staff Data Engineer: current \\(made \\d{4}-\\d{2}-\\d{2}\\)\\n {2}https://docs\\.google\\.com/document/d/doc-1/edit`));
    ws.write(`${ws.folder('employer-b')}/prep.md`, '# Prep\n\n- Something new\n');
    assert.match(ws.run('docs', ['list']), /Staff Data Engineer: made \d{4}-\d{2}-\d{2}, the workspace has changed since/);
    assert.match(ws.run('docs', ['record', b, '--doc', 'doc-2']), /\nTrash the previous copy: doc-1\n$/);

    ws.write(`${ws.folder('employer-b')}/posting.md`, ws.read(`${ws.folder('employer-b')}/posting.md`).replace(/(\n {2}- [^\n]*interested[^\n]*)/, '$1\n  - 2099-01-01 | passed | Example reason'));
    assert.match(ws.run('docs', ['list']), /Staff Data Engineer: the posting has ended: move it to Archive/);
    assert.match(ws.run('docs', ['record', b, '--archived']), /archived \d{4}-\d{2}-\d{2}/);
    assert.match(ws.run('docs', ['list']), /Staff Data Engineer: archived \d{4}-\d{2}-\d{2}$/m);
    assert.doesNotMatch(ws.run('docs', ['record', b, '--doc', 'doc-3']), /Trash the previous copy/, 'an archived copy stays in Archive');
    assert.match(ws.fails('docs', ['record', 'prep', '--archived']).out, /No Doc recorded for "prep"/);
  } finally { ws.cleanup(); }
});

test('docs.mjs: a frozen posting adds the text of the resume that was sent', () => {
  const ws = buildWorkspace({ drive: true });
  try {
    const dir = ws.folder('employer-c');
    ws.write(`${dir}/posting.md`, ws.read(`${dir}/posting.md`).replace(/^updated:/m, 'frozen: 2026-01-02\nupdated:'));
    ws.write(`${dir}/Test-Candidate-Resume.txt`, 'TEST CANDIDATE\nExample City, ST\n\nWORK EXPERIENCE\n- Example bullet one\n- Example bullet two\n');
    const md = ws.run('docs', ['markdown', idOf(ws, 'employer-c')]);
    assert.match(md, /^# Resume Sent\n\nThe text of the resume sent on 2026-01-02\./m);
    assert.match(md, /\nTEST CANDIDATE\n\n\nExample City, ST\n/);
    assert.match(md, /- Example bullet one\n- Example bullet two/);
  } finally { ws.cleanup(); }
});

test("sheet.mjs: with a packet Doc, the posting's role links to it", () => {
  const ws = buildWorkspace({ drive: true });
  try {
    ws.run('tracker');
    const b = idOf(ws, 'employer-b');
    ws.run('docs', ['record', b, '--doc', 'doc-9']);
    const row = JSON.parse(ws.run('sheet', ['rows', 'shortlist'])).find((r) => r.at(-1) === b);
    assert.equal(row[1], '=HYPERLINK("https://docs.google.com/document/d/doc-9/edit","Staff Data Engineer")');
    const other = JSON.parse(ws.run('sheet', ['rows', 'shortlist'])).find((r) => r[0] === 'Employer A');
    assert.equal(other[1], 'Senior Data Engineer', 'no Doc, no link');
  } finally { ws.cleanup(); }
});

test('docs.mjs refuses with the Drive folder off', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.fails('docs', ['list']).out, /The Drive folder is off \(drive\.enabled in workspace\.yaml\)/);
  } finally { ws.cleanup(); }
});
