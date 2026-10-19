// The scout's first screen (screen.mjs) and the two fit scores (fit.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, get } from '../plugins/roleforward/tools/workspace.mjs';
import { screens } from '../plugins/roleforward/tools/screen.mjs';
import { buildWorkspace } from './fixture.mjs';

const ws = buildWorkspace();
process.env.ROLEFORWARD_WORKSPACE_DIR = ws.root;
const fit = await import('../plugins/roleforward/tools/fit.mjs');
test.after(() => ws.cleanup());

const cfg = parseYaml(ws.read('workspace.yaml'));
const { titleOk, placeOk } = screens((p, f) => get(cfg, p, f));

test('a title must match every title_all pattern and no title_none pattern', () => {
  assert.equal(titleOk('Senior Data Engineer'), true);
  assert.equal(titleOk('Staff Engineer, Data Platform'), true);
  assert.equal(titleOk('Data Engineer'), false, 'no level word');
  assert.equal(titleOk('Senior Software Engineer'), false, 'no field word');
  assert.equal(titleOk('Senior Data Engineering Intern'), false, 'title_none');
  assert.equal(titleOk('Senior Database Administrator'), false, 'word boundary on data');
});

test('with no title_all patterns, nothing matches', () => {
  const none = screens((p, f) => get({ scout: {} }, p, f));
  assert.equal(none.titleOk('Senior Data Engineer'), false);
});

test('the place screen: a listed place or nearby name, remote at home, or just the country', () => {
  for (const ok of ['Example City, ST', 'Nearby Town; Hybrid', 'Remote', 'Anywhere', 'Remote, US', 'United States', 'Multiple Locations', '3 Locations', '', 'Elsewhere; Remote - US'])
    assert.equal(placeOk(ok), true, ok);
  for (const no of ['Other City, ST', 'Remote - London', 'Remote, Canada', 'Germany', 'London, United Kingdom; remote', 'Remote - EMEA'])
    assert.equal(placeOk(no), false, no);
});

test('readDirection reads the dealbreakers and preferences', () => {
  const d = fit.readDirection();
  assert.deepEqual(d.dealbreakers.map((x) => x.name), ['Wrong role', 'Wrong level', 'Wrong place']);
  assert.deepEqual(d.preferences.map((p) => [p.key, p.weight]), [['work-location-and-office-days', 'high'], ['team-size', 'medium']]);
  assert.deepEqual(d.problems, []);
});

test('readDirection flags too many entries, a bad weight, and a pay preference', () => {
  const original = ws.read('career-direction.md');
  try {
    const rows = ['| Pay | high | the range |', '| B | huge | x |', '| C | low | x |', '| D | low | x |', '| E | low | x |'].join('\n');
    const extra = ['- **Four:** x', '- **Five:** x', '- **Six:** x'].join('\n');
    ws.write('career-direction.md', original.replace('|---|---|---|\n', `|---|---|---|\n${rows}\n`).replace('- **Wrong place:**', `${extra}\n- **Wrong place:**`));
    const d = fit.readDirection();
    assert.equal(d.dealbreakers.length, 5);
    assert.equal(d.preferences.length, 5);
    const all = d.problems.join('\n');
    assert.match(all, /6 dealbreakers: RoleForward uses at most 5\. Only the first 5 apply \(Wrong place doesn't\)/);
    assert.match(all, /7 preferences: RoleForward uses at most 5/);
    assert.match(all, /Preference "B": weight "huge" should be high, medium, or low/);
    assert.match(all, /A pay preference is listed/);
  } finally { ws.write('career-direction.md', original); }
});

test('Preference fit is the weighted average of the known ratings', () => {
  const prefs = fit.readDirection().preferences;
  assert.equal(fit.preferenceFit({ 'work-location-and-office-days': 5, 'team-size': 2 }, prefs), 3.8);
  assert.equal(fit.preferenceFit({ 'work-location-and-office-days': 5, 'team-size': 'unknown' }, prefs), 5);
  assert.equal(fit.preferenceFit({ 'work-location-and-office-days': 'unknown' }, prefs), '');
  assert.equal(fit.preferenceFit({ 'work-location-and-office-days': 9 }, prefs), '', 'out of range is ignored');
});

test('ranking puts the higher lower-score first, then the higher score, then the newest', () => {
  const rows = [
    { id: 'a', role_fit: 5, preference_fit: 2 },
    { id: 'b', role_fit: 3, preference_fit: 3 },
    { id: 'c', role_fit: 3, preference_fit: 4, last_event: '2026-10-01' },
    { id: 'd', role_fit: 4, preference_fit: 3, last_event: '2026-10-02' },
    { id: 'e', role_fit: 4, preference_fit: '' },
  ];
  assert.deepEqual([...rows].sort(fit.rankCompare).map((r) => r.id), ['e', 'd', 'c', 'b', 'a']);
});

test('a drop reason names its dealbreaker', () => {
  const names = ['Wrong role', 'Wrong level', 'Stale'];
  assert.equal(fit.dealbreakerOf('Wrong level: first-line manager', names), 'Wrong level');
  assert.equal(fit.dealbreakerOf('stale: posted 90 days ago', names), 'Stale');
  assert.equal(fit.dealbreakerOf('Too broad', names), '');
});

test('fit.mjs set rewrites the scores in place and keeps every other key', () => {
  const folder = ws.folder('employer-a');
  const before = ws.read(`${folder}/posting.md`);
  try {
    const out = ws.run('fit', ['set', folder, '--role', '3', 'work=4', 'team=2']);
    assert.match(out, /Role fit: 3\n  Preference fit: 3.2\n/);
    const after = ws.read(`${folder}/posting.md`);
    assert.match(after, /scout_key: .*\nrole_fit: 3\npreference_fit: 3\.2\npreferences:\n  work-location-and-office-days: 4\n  team-size: 2\nwhy:/);
    for (const key of ['company', 'role', 'posting', 'events', 'why']) assert.match(after, new RegExp(`^${key}:`, 'm'));
  } finally { ws.write(`${folder}/posting.md`, before); }
});

test('fit.mjs set refuses unknown or ambiguous keys and bad ratings', () => {
  const folder = ws.folder('employer-a');
  assert.match(ws.fails('fit', ['set', folder, 'salary=3']).out, /"salary" isn't one of the preferences/);
  assert.match(ws.fails('fit', ['set', folder, 'team=7']).out, /team-size takes 1 to 5 or unknown/);
  assert.match(ws.fails('fit', ['set', folder, '--role', '0']).out, /--role takes 1 to 5/);
});

test('fit.mjs check lists live postings not rated for a new preference', () => {
  const original = ws.read('career-direction.md');
  try {
    assert.match(ws.run('fit', ['check']), /Every live posting has both scores/);
    ws.write('career-direction.md', original.replace('| Team size | medium |', '| Team size | medium | x |\n| Commute | low |'));
    const out = ws.run('fit', ['check']);
    assert.match(out, /employer-a\/.*: not rated for commute/);
    assert.match(out, /employer-c\/.*: not rated for commute/);
    assert.doesNotMatch(out, /employer-d/, 'passed postings are not live');
  } finally { ws.write('career-direction.md', original); }
});

test('a preference key leaves out the words in brackets', () => {
  const original = ws.read('career-direction.md');
  try {
    ws.write('career-direction.md', original.replace('| Team size | medium |', '| Unit type (med-surg, step-down) | medium |'));
    assert.deepEqual(fit.readDirection().preferences.map((p) => p.key), ['work-location-and-office-days', 'unit-type']);
  } finally { ws.write('career-direction.md', original); }
});
