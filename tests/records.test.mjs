// The CSV reader and writer (csv.mjs), the posting.md frontmatter reader and editors (frontmatter.mjs), and the shared
// record helpers (records.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, toCsv } from '../plugins/roleforward/tools/csv.mjs';
import { readFrontmatter, writeFrontmatter, appendEvent, setLastEventNote, setField, parseEvent } from '../plugins/roleforward/tools/frontmatter.mjs';
import { PIPELINE, LIVE, ENDED, parseNext, nextOf, stageOf, slug, isDate, newRecordDir } from '../plugins/roleforward/tools/records.mjs';

test('CSV round trip with commas, quotes, and newlines', () => {
  const rows = [['a,b', 'say "hi"', 'two\nlines'], ['', 3, 'plain']];
  const text = toCsv(['x', 'y', 'z'], rows);
  assert.equal(text, 'x,y,z\n"a,b","say ""hi""","two\nlines"\n,3,plain\n');
  assert.deepEqual(parseCsv(text), [{ x: 'a,b', y: 'say "hi"', z: 'two\nlines' }, { x: '', y: '3', z: 'plain' }]);
});

test('CSV reads Windows line endings and a missing final newline', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4'), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('CSV fills short rows with empty cells', () => {
  assert.deepEqual(parseCsv('a,b,c\n1\n'), [{ a: '1', b: '', c: '' }]);
});

const dir = mkdtempSync(join(tmpdir(), 'roleforward-records-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const POSTING = `---
company: Employer A
role: "Senior Data Engineer: Platform"
referral: false
why: 'It''s a placeholder'
stability: 0               # a trailing comment
preferences:
  team-size: 3
  work-location-and-office-days: unknown
events:
  - 2026-10-01 | shortlisted
  - "2026-10-02 | interested | note: with a colon"
updated: 2026-10-02
---

# Body stays as it is
`;

test('frontmatter reads scalars, quotes, comments, maps, and lists', () => {
  const f = join(dir, 'read.md');
  writeFileSync(f, POSTING);
  const { data, body } = readFrontmatter(f);
  assert.equal(data.role, 'Senior Data Engineer: Platform');
  assert.equal(data.why, "It's a placeholder");
  assert.equal(data.stability, '0');
  assert.deepEqual(data.preferences, { 'team-size': '3', 'work-location-and-office-days': 'unknown' });
  assert.deepEqual(data.events, ['2026-10-01 | shortlisted', '2026-10-02 | interested | note: with a colon']);
  assert.equal(body, '\n# Body stays as it is\n');
});

test('frontmatter round trip keeps key order and quotes what needs it', () => {
  const f = join(dir, 'write.md');
  writeFileSync(f, POSTING);
  const { data, body } = readFrontmatter(f);
  writeFrontmatter(f, data, body);
  const again = readFrontmatter(f);
  assert.deepEqual(again.data, data);
  assert.deepEqual(Object.keys(again.data), Object.keys(data));
  assert.match(readFileSync(f, 'utf8'), /^role: "Senior Data Engineer: Platform"$/m);
});

test('appendEvent adds after the last event, sets updated, and leaves every other line alone', () => {
  const f = join(dir, 'append.md');
  writeFileSync(f, POSTING);
  appendEvent(f, '2026-10-05 | applied', '2026-10-05');
  const after = readFileSync(f, 'utf8');
  assert.equal(after, POSTING.replace('updated: 2026-10-02', 'updated: 2026-10-05')
    .replace('  - "2026-10-02 | interested | note: with a colon"\n', '  - "2026-10-02 | interested | note: with a colon"\n  - 2026-10-05 | applied\n'));
});

test('appendEvent starts an events list when there is none', () => {
  const f = join(dir, 'noevents.md');
  writeFileSync(f, '---\ncompany: Employer A\n---\nBody\n');
  appendEvent(f, '2026-10-05 | shortlisted', '2026-10-05');
  assert.deepEqual(readFrontmatter(f).data.events, ['2026-10-05 | shortlisted']);
});

test('setLastEventNote replaces only the last event note', () => {
  const f = join(dir, 'note.md');
  writeFileSync(f, POSTING);
  setLastEventNote(f, 'Example reason', '2026-10-06');
  const { data } = readFrontmatter(f);
  assert.deepEqual(data.events, ['2026-10-01 | shortlisted', '2026-10-02 | interested | Example reason']);
  assert.equal(data.updated, '2026-10-06');
});

test('parseEvent keeps a note that contains the separator', () => {
  assert.deepEqual(parseEvent('2026-10-02 | interested | a | b'), { date: '2026-10-02', stage: 'interested', note: 'a | b' });
  assert.deepEqual(parseEvent('2026-10-02 | shortlisted'), { date: '2026-10-02', stage: 'shortlisted', note: '' });
});

test('a workspace whose files have Windows line endings reads the same', async () => {
  const { buildWorkspace } = await import('./fixture.mjs');
  const { readdirSync, statSync } = await import('node:fs');
  const lf = buildWorkspace(), crlf = buildWorkspace();
  try {
    // Turn every text file in one copy into CRLF, as a Windows editor or checkout might.
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk(crlf.root).filter((f) => /\.(md|yaml|csv)$/.test(f))) writeFileSync(f, readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
    assert.match(readFileSync(join(crlf.root, 'workspace.yaml'), 'utf8'), /\r\n/);
    const same = (tool, args = []) => assert.equal(crlf.run(tool, args).replaceAll(crlf.root, ''), lf.run(tool, args).replaceAll(lf.root, ''), `${tool} ${args.join(' ')}`);
    same('fit', ['list']);
    same('fit', ['check']);
    same('watchlist', ['list']);
    same('tracker');
    assert.equal(crlf.read('applications/data/applications.csv'), lf.read('applications/data/applications.csv'));
    assert.deepEqual(readFrontmatter(join(crlf.root, crlf.folder('employer-c'), 'posting.md')).data, readFrontmatter(join(lf.root, lf.folder('employer-c'), 'posting.md')).data);
    const doctorLines = (ws) => ws.run('doctor').split('\n').filter((l) => !/Workspace:|Browser|Chrome/.test(l)).join('\n');
    assert.equal(doctorLines(crlf), doctorLines(lf));
  } finally { lf.cleanup(); crlf.cleanup(); }
});

test('setField replaces or adds one field and updated, and leaves every other byte alone', () => {
  const f = join(dir, 'field.md');
  const text = '---\ncompany: Employer A\nevents:\n  - 2026-10-01 | applied\nupdated: 2026-10-01\n---\n\n# Body  with  odd   spacing\n';
  writeFileSync(f, text);
  setField(f, 'next', '2026-10-15 | Follow up', '2026-10-02');
  assert.equal(readFileSync(f, 'utf8'), text.replace('updated: 2026-10-01', 'next: 2026-10-15 | Follow up\nupdated: 2026-10-02'));
  setField(f, 'next', '', '2026-10-03');
  assert.equal(readFileSync(f, 'utf8'), text.replace('updated: 2026-10-01', 'next:\nupdated: 2026-10-03'));
  setField(f, 'next', 'a #2 note', '2026-10-03');
  assert.equal(readFrontmatter(f).data.next, 'a #2 note', 'a " #" is quoted, so it is not read as a comment');
});

test('records: stages, next actions, and folder names', () => {
  assert.equal(PIPELINE.indexOf('conversation'), PIPELINE.indexOf('interested') + 1);
  assert.equal(PIPELINE.indexOf('applied'), PIPELINE.indexOf('conversation') + 1);
  assert.ok(LIVE.includes('conversation') && !LIVE.includes('accepted') && ENDED.includes('accepted'));
  assert.deepEqual(parseNext('2026-11-14 | Reply to the recruiter | about the screen'), { date: '2026-11-14', action: 'Reply to the recruiter | about the screen' });
  assert.equal(parseNext(''), null);
  assert.deepEqual(parseNext('2026-02-30 | Reply'), { bad: '2026-02-30 | Reply' });
  assert.deepEqual(parseNext('2026-11-14'), { bad: '2026-11-14' });
  const live = { events: ['2026-10-02 | interested', '2026-10-01 | shortlisted'], next: '2026-10-09 | Apply' };
  assert.equal(stageOf(live), 'interested', 'by date, not by line order');
  assert.deepEqual(nextOf(live), { date: '2026-10-09', action: 'Apply' });
  assert.equal(nextOf({ ...live, events: [...live.events, '2026-10-03 | passed'] }), null, 'ignored once ended');
  assert.equal(slug('Café & Co: Senior/Staff Role'), 'cafe-and-co-senior-staff-role');
  assert.ok(isDate('2024-02-29') && !isDate('2026-02-29') && !isDate('2026-1-01'));
});

test('newRecordDir reuses a company folder and refuses a duplicate', () => {
  const root = mkdtempSync(join(tmpdir(), 'roleforward-newrecord-'));
  try {
    const p = join(root, 'applications', 'employer-a-inc', '2026-10-01-data-engineer');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'posting.md'), '---\ncompany: Employer A\nrole: Data Engineer\n---\n');
    const r = newRecordDir(root, 'employer a', 'Staff Data Engineer', '2026-10-05');
    assert.deepEqual([r.company, r.companyDir, r.dir], ['Employer A', 'employer-a-inc', join(root, 'applications', 'employer-a-inc', '2026-10-05-staff-data-engineer')]);
    assert.throws(() => newRecordDir(root, 'Employer A', 'data engineer', '2026-10-05'), /applications\/employer-a-inc\/2026-10-01-data-engineer\/posting\.md already records this role/);
    assert.equal(newRecordDir(root, 'Employer B', 'Data Engineer', '2026-10-05').companyDir, 'employer-b');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
