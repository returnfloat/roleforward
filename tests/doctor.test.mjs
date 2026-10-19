// The doctor's settings schema (doctor.mjs checkSettings) and its report on a workspace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSettings } from '../plugins/roleforward/tools/doctor.mjs';
import { parseYaml } from '../plugins/roleforward/tools/workspace.mjs';
import { PLUGIN, buildWorkspace } from './fixture.mjs';

test('an unknown key is a warning, with "did you mean" when it is close', () => {
  const { problems, warnings } = checkSettings({ scout: { max_shortlst: 5 }, colour: 'x' });
  assert.deepEqual(problems, []);
  assert.match(warnings[0], /^scout\.max_shortlst: not a RoleForward setting.*did you mean scout\.max_shortlist\?/);
  assert.doesNotMatch(warnings[1], /did you mean/);
});

test('wrong types are problems', () => {
  const { problems } = checkSettings({
    scout: { max_shortlist: 'ten', cadence: 'hourly', title_none: '(', title_all: ['ok', '['] },
    theme: { primary: 'navy' }, schedule: { scout: { at: 'seven', enabled: 'yes' } },
    targets: { titles: 'one title', visa: { deadline: 'soon' } },
  });
  for (const p of ['scout.max_shortlist: should be a number', 'scout.cadence: should be one of', "scout.title_none: isn't a valid pattern",
    "scout.title_all: has a pattern that isn't valid", "theme.primary: should be a color", 'schedule.scout.at: should be a time',
    'schedule.scout.enabled: should be true or false', 'targets.titles: should be a list', 'targets.visa.deadline: should be a date'])
    assert.ok(problems.some((x) => x.startsWith(p)), `expected a problem starting "${p}" in:\n${problems.join('\n')}`);
});

test('a setting that should hold settings below it, given a value, is a problem', () => {
  assert.match(checkSettings({ scout: 'weekly' }).problems[0], /^scout: should hold settings below it/);
});

test('empty values are fine, and enum values ignore case', () => {
  assert.deepEqual(checkSettings({ scout: { max_shortlist: '', cadence: 'Weekly' }, apply: { depth: 'LIGHT' } }), { problems: [], warnings: [] });
});

test('map settings take any keys below them', () => {
  assert.deepEqual(checkSettings({ connections: { aliases: { 'Any Name': ['Other'] } }, sheet: { tabs: { Shortlist: 0 } } }), { problems: [], warnings: [] });
});

test('template placeholders are warnings, but a pattern only counts when it is all placeholder', () => {
  const { warnings } = checkSettings({ person: { name: '<Full Name>' }, scout: { title_none: '(?<!x)foo', remote_words: '<remote words>' } });
  assert.ok(warnings.some((w) => w.startsWith('person.name: still has a <placeholder>')));
  assert.ok(warnings.some((w) => w.startsWith('scout.remote_words: still has a <placeholder>')));
  assert.ok(!warnings.some((w) => w.startsWith('scout.title_none')));
});

test("the plugin's template has placeholders but no problems", () => {
  const { problems, warnings } = checkSettings(parseYaml(readFileSync(join(PLUGIN, 'templates', 'workspace.yaml'), 'utf8')));
  assert.deepEqual(problems, []);
  assert.ok(warnings.length > 0 && warnings.every((w) => /placeholder/.test(w)), warnings.join('\n'));
});

// The browser line depends on the machine, so these look at the workspace lines only.
const workspaceLines = (out) => out.split('\n').filter((l) => /^\s+(ok|warn|problem|claude)\s/.test(l) && !/Browser for PDFs|Chrome/.test(l));

test('the doctor finds nothing wrong with the test workspace', () => {
  const ws = buildWorkspace();
  try {
    const lines = workspaceLines(ws.run('doctor'));
    assert.ok(lines.every((l) => /^\s+ok\s/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /Career direction: 3 dealbreakers, 2 preferences/.test(l)));
    assert.ok(lines.some((l) => /Watchlist: 6 employers \(4 with feeds, 1 manual, 1 paused\)/.test(l)));
  } finally { ws.cleanup(); }
});

test('the doctor reports a broken workspace and exits with an error', () => {
  const ws = buildWorkspace();
  try {
    ws.write('workspace.yaml', ws.read('workspace.yaml').replace('max_shortlist: 10', 'max_shortlist: ten'));
    ws.write('applications/watchlist.md', ws.read('applications/watchlist.md').replace('| lever |', '| leverr |'));
    const r = ws.fails('doctor');
    assert.equal(r.status, 1);
    assert.match(r.out, /problem\s+workspace\.yaml scout\.max_shortlist: should be a number/);
    assert.match(r.out, /problem\s+Watchlist: Employer C has source "leverr"/);
  } finally { ws.cleanup(); }
});

test('an empty watchlist table is named as empty, not missing', () => {
  const ws = buildWorkspace();
  try {
    const md = ws.read('applications/watchlist.md');
    ws.write('applications/watchlist.md', md.slice(0, md.indexOf('| Employer A')));
    assert.match(ws.run('doctor'), /warn\s+applications\/watchlist\.md has no employers yet, so the scout has nothing to search/);
  } finally { ws.cleanup(); }
});
