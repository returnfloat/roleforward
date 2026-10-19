// The CSV reader and writer (csv.mjs) and the posting.md frontmatter reader and editors (frontmatter.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv, toCsv } from '../plugins/roleforward/tools/csv.mjs';
import { readFrontmatter, writeFrontmatter, appendEvent, setLastEventNote, parseEvent } from '../plugins/roleforward/tools/frontmatter.mjs';

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
