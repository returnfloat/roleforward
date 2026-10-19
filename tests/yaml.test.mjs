// The workspace.yaml reader (workspace.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml, get, regex, relPath } from '../plugins/roleforward/tools/workspace.mjs';
import { PLUGIN, buildWorkspace } from './fixture.mjs';

test('scalars: numbers, booleans, and the empty forms', () => {
  assert.deepEqual(parseYaml('a: 10\nb: -2.5\nc: true\nd: false\ne: ~\nf: null\ng: "07:00"\nh: 2026-10-17'),
    { a: 10, b: -2.5, c: true, d: false, e: '', f: '', g: '07:00', h: '2026-10-17' });
});

test('single quotes keep backslashes literal, and double quotes take JSON escapes', () => {
  const y = parseYaml(String.raw`a: '\bdata\b'
b: "tab\there"
c: 'it''s'`);
  assert.equal(y.a, String.raw`\bdata\b`);
  assert.equal(y.b, 'tab\there');
  assert.equal(y.c, "it's");
});

test('a comment after a quoted value drops the quotes and the comment', () => {
  const y = parseYaml(`theme:\n  primary: '#132a45'                # headers\n  accent: "#d8b66a"   # pills`);
  assert.deepEqual(y.theme, { primary: '#132a45', accent: '#d8b66a' });
});

test('a comment after an unquoted value is dropped, but a # inside a word stays', () => {
  assert.deepEqual(parseYaml('a: hello   # note\nb: c#sharp'), { a: 'hello', b: 'c#sharp' });
});

test('a key followed only by a comment is empty, not a map', () => {
  const y = parseYaml('person:\n  pronouns:                        # optional\n  name: Test\nnext: 1');
  assert.deepEqual(y, { person: { pronouns: '', name: 'Test' }, next: 1 });
});

test('nested maps and lists, by indentation', () => {
  const y = parseYaml('a:\n  b:\n    c: 1\n    d:\n      - x\n      - y\n  e: 2\nf: 3');
  assert.deepEqual(y, { a: { b: { c: 1, d: ['x', 'y'] }, e: 2 }, f: 3 });
});

test('inline lists respect quotes', () => {
  const y = parseYaml(`a: [one, "two, three", 'four', 5]\nb: []`);
  assert.deepEqual(y.a, ['one', 'two, three', 'four', 5]);
  assert.deepEqual(y.b, []);
});

test('full-line comments and blank lines are skipped', () => {
  assert.deepEqual(parseYaml('# top\n\na: 1\n  # indented comment\nb: 2\n'), { a: 1, b: 2 });
});

test('a list item with no key above it, or an unreadable line, fails with its line number', () => {
  assert.throws(() => parseYaml('a: 1\n- loose'), /line 2: a list item needs a "key:" line above it/);
  assert.throws(() => parseYaml('a: 1\njust words'), /line 2: can't read "just words"/);
});

test("the plugin's workspace.yaml template and the test workspace both parse", () => {
  const t = parseYaml(readFileSync(join(PLUGIN, 'templates', 'workspace.yaml'), 'utf8'));
  assert.equal(t.theme.primary, '#132a45');
  assert.equal(t.person.pronouns, '');
  assert.equal(t.schedule.scout.at, '07:00');
  const ws = buildWorkspace();
  try {
    const y = parseYaml(ws.read('workspace.yaml'));
    assert.deepEqual(y.scout.title_all, [String.raw`\bdata\b`, String.raw`\b(senior|staff|lead|principal)\b`]);
    assert.deepEqual(y.targets.places, { 'Example City, ST': ['Nearby Town'] });
    assert.equal(y.targets.remote, true);
  } finally { ws.cleanup(); }
});

test('get reads dotted paths with a fallback', () => {
  const y = { a: { b: { c: 0 } }, d: '' };
  assert.equal(get(y, 'a.b.c'), 0);
  assert.equal(get(y, 'a.x.c', 'none'), 'none');
  assert.equal(get(y, 'd', 'none'), '');
});

test('regex joins fragments case-insensitively, with a fallback when empty', () => {
  assert.ok(regex(['\\bdata\\b', 'etl']).test('ETL Lead'));
  assert.equal(regex('', /fallback/).source, 'fallback');
  assert.equal(regex([], null), null);
});

test('relPath uses forward slashes', () => {
  assert.equal(relPath(join('a', 'b'), join('a', 'b', 'c', 'd.md')), 'c/d.md');
});
