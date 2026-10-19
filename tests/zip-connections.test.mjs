// The zip reader (zip.mjs) and the connections module's import and matching (connections.mjs).
// The LinkedIn export here is made up in place: placeholder names, no real people.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZipEntry } from '../plugins/roleforward/tools/zip.mjs';
import { buildWorkspace, makeZip } from './fixture.mjs';

const dir = mkdtempSync(join(tmpdir(), 'roleforward-zip-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const zipFile = (name, entries) => { const f = join(dir, name); writeFileSync(f, makeZip(entries)); return f; };

test('reads a deflated entry and a stored one', () => {
  const f = zipFile('both.zip', [{ name: 'a/One.csv', text: 'deflated text '.repeat(50) }, { name: 'Two.txt', text: 'stored text', deflate: false }]);
  assert.equal(readZipEntry(f, (n) => n.endsWith('One.csv')), 'deflated text '.repeat(50));
  assert.equal(readZipEntry(f, (n) => n === 'Two.txt'), 'stored text');
});

test('returns null when no entry matches', () => {
  assert.equal(readZipEntry(zipFile('none.zip', [{ name: 'Other.csv', text: 'x' }]), (n) => n.endsWith('Connections.csv')), null);
});

test("a file that isn't a zip fails clearly", () => {
  const f = join(dir, 'not.zip');
  writeFileSync(f, 'plain text');
  assert.throws(() => readZipEntry(f, () => true), /isn't a zip archive/);
});

// LinkedIn's Connections.csv starts with a short notes preamble above the header row.
const CONNECTIONS = `Notes:
"Placeholder preamble, as LinkedIn writes one."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Test,Contact One,https://example.invalid/in/one,,Employer A,Senior Data Engineer,01 Jan 2024
Test,Contact Two,,,Employer A Brand,Technical Recruiter,15 Mar 2023
Test,Contact Three,,,"Employer A, Inc.",Product Manager,02 Feb 2022
Test,Contact Four,,,Employer A Labs,Data Analyst,03 Mar 2021
Test,Contact Five,,,Employer B,Staff Data Engineer,04 Apr 2020
`;

test('import from the export zip keeps only the five fields, and match ranks by field, then recruiting', () => {
  const ws = buildWorkspace({ connections: true });
  try {
    const zip = zipFile('export.zip', [{ name: 'Messages.csv', text: 'never read' }, { name: 'Connections.csv', text: CONNECTIONS }]);
    const out = ws.run('connections', ['import', zip]);
    assert.match(out, /^Imported 5 connections \(5 list a company\)/);
    assert.match(out, /Only Connections\.csv was read from the archive/);
    assert.equal(ws.read('contacts/connections.csv').split('\n')[0], 'name,company,title,url,connected_on');
    assert.doesNotMatch(ws.read('contacts/connections.csv'), /never read/);

    const m = ws.run('connections', ['match', 'Employer A']);
    assert.match(m, /^3 connection\(s\) at Employer A:\n  Test Contact One, Senior Data Engineer \(same field, connected 2024-01-01\) https:\/\/example\.invalid\/in\/one\n  Test Contact Two, Technical Recruiter \(recruiting, connected 2023-03-15\)\n  Test Contact Three, Product Manager \(other, connected 2022-02-02\)\n/);
    assert.match(m, /Similar company names, not counted .*\n  Employer A Labs \(1\)/);
  } finally { ws.cleanup(); }
});

test('the sheet shows connections in the Contacts column once imported', () => {
  const ws = buildWorkspace({ connections: true });
  try {
    const csv = join(dir, 'Connections.csv');
    writeFileSync(csv, CONNECTIONS);
    ws.run('connections', ['import', csv]);
    ws.run('tracker');
    const rows = JSON.parse(ws.run('sheet', ['rows', 'shortlist']));
    assert.equal(rows.find((r) => r[0] === 'Employer A')[12], '3: Test Contact One (Senior Data Engineer); Test Contact Two (Technical Recruiter); Test Contact Three (Product Manager)');
    assert.equal(rows.find((r) => r[0] === 'Employer B')[12], '1: Test Contact Five (Staff Data Engineer)');
  } finally { ws.cleanup(); }
});

test('status and forget', () => {
  const ws = buildWorkspace({ connections: true });
  try {
    const csv = join(dir, 'Connections2.csv');
    writeFileSync(csv, CONNECTIONS);
    ws.run('connections', ['import', csv]);
    assert.match(ws.run('connections', ['status']), /^Connections: on\. 5 imported/);
    ws.run('connections', ['forget']);
    assert.equal(existsSync(join(ws.root, 'contacts', 'connections.csv')), false);
    assert.match(ws.run('connections', ['status']), /nothing imported/);
  } finally { ws.cleanup(); }
});

test('a file without the First Name header is refused', () => {
  const ws = buildWorkspace({ connections: true });
  try {
    const csv = join(dir, 'wrong.csv');
    writeFileSync(csv, 'a,b\n1,2\n');
    assert.match(ws.fails('connections', ['import', csv]).out, /doesn't look like LinkedIn's Connections\.csv/);
  } finally { ws.cleanup(); }
});

test('an abbreviation surfaces as a similar name', () => {
  const ws = buildWorkspace({ connections: true });
  try {
    const csv = join(dir, 'abbrev.csv');
    writeFileSync(csv, 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nTest,Contact Six,,,EB Group,Data Engineer,01 Jan 2024\n');
    ws.run('connections', ['import', csv]);
    assert.match(ws.run('connections', ['match', 'Employer B Group']), /Similar company names.*\n  EB Group/);
  } finally { ws.cleanup(); }
});

test('abbreviates: capitals that are initials, or spread letters of one word, after the shared words', async () => {
  const ws = buildWorkspace();
  process.env.ROLEFORWARD_WORKSPACE_DIR = ws.root;
  try {
    const { abbreviates } = await import('../plugins/roleforward/tools/connections.mjs');
    for (const [a, b] of [['EB Group', 'Employer B Group'], ['ET', 'Exampletech'], ['Test and ET Labs', 'Test and Exampletech Labs'], ['TCE', 'Test Cloud Example']])
      assert.equal(abbreviates(a, b), true, `${a} | ${b}`);
    for (const [a, b] of [['EX', 'Example'], ['et', 'Exampletech'], ['ET', 'ET'], ['EB Group', 'Other Group'], ['Example Labs', 'Exampletech Labs']])
      assert.equal(abbreviates(a, b), false, `${a} | ${b}`);
  } finally { ws.cleanup(); }
});
