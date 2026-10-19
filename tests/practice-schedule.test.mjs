// The practice log and its spaced review (practice.mjs), and the scheduled-task fields (schedule.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../plugins/roleforward/tools/csv.mjs';
import { buildWorkspace, daysAgo } from './fixture.mjs';

const inDays = (n) => daysAgo(-n);

test('a logged round comes back sooner the lower it scored', () => {
  const ws = buildWorkspace();
  try {
    assert.equal(ws.run('practice', ['log', 'sql', 'Window functions', '1', 'Example fix']).trim(), `Logged sql: Window functions, 1/4. Next round due ${inDays(1)}.`);
    ws.run('practice', ['log', 'coding', 'Two pointers', '2']);
    ws.run('practice', ['log', 'system-design', 'Example pipeline', '3']);
    ws.run('practice', ['log', 'behavioral', 'Example story', '4', '--prompt', 'Tell me about a time']);
    const rows = parseCsv(ws.read('practice/practice.csv'));
    assert.deepEqual(rows.map((r) => [r.format, r.score, r.next_due]), [['sql', '1', inDays(1)], ['coding', '2', inDays(3)], ['system-design', '3', inDays(7)], ['behavioral', '4', inDays(21)]]);
    assert.equal(rows[3].prompt, 'Tell me about a time');
  } finally { ws.cleanup(); }
});

test('a strong score after a strong score doubles the gap, up to 60 days', () => {
  const ws = buildWorkspace();
  try {
    ws.run('practice', ['log', 'coding', 'Graphs', '4', '--date', daysAgo(30)]);
    ws.run('practice', ['log', 'coding', 'graphs', '4', '--date', daysAgo(9)]);
    ws.run('practice', ['log', 'coding', 'Graphs', '4']);
    assert.deepEqual(parseCsv(ws.read('practice/practice.csv')).map((r) => r.next_due), [daysAgo(9), inDays(33), inDays(60)]);
  } finally { ws.cleanup(); }
});

test('due lists the latest attempt at each overdue topic, most overdue first, by format', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.run('practice', ['due']), /Nothing due\. No rounds logged yet\./);
    ws.run('practice', ['log', 'sql', 'Joins', '1', 'Example fix', '--date', daysAgo(5)]);
    ws.run('practice', ['log', 'coding', 'Heaps', '2', '--date', daysAgo(10)]);
    ws.run('practice', ['log', 'coding', 'Tries', '4']);
    assert.equal(ws.run('practice', ['due']), `Due for another round (2):\n  coding: Heaps (last 2/4 on ${daysAgo(10)}, due ${daysAgo(7)})\n  sql: Joins (last 1/4 on ${daysAgo(5)}, due ${daysAgo(4)}) Fix: Example fix\n`);
    assert.match(ws.run('practice', ['due', 'sql']), /^Due for another round \(1\):\n  sql: Joins/);
    ws.run('practice', ['log', 'sql', 'joins', '3']);
    assert.doesNotMatch(ws.run('practice', ['due']), /Joins/, 'a newer attempt replaces the old one');
  } finally { ws.cleanup(); }
});

test('stats averages the latest score per topic and shows the trend', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.run('practice', ['stats']), /No rounds logged yet\./);
    for (const [topic, score, d] of [['A', '1', 9], ['B', '2', 8], ['A', '3', 2]]) ws.run('practice', ['log', 'coding', topic, score, '--date', daysAgo(d)]);
    assert.match(ws.run('practice', ['stats']), /^coding \| 3 \| 2 \| 2\.5 \| 2\.0 \| -$/m);
  } finally { ws.cleanup(); }
});

test('practice checks its input and notes a new format name', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.fails('practice', ['log', 'coding', 'Example', '5']).out, /^Usage: practice\.mjs log/);
    assert.match(ws.fails('practice', ['log', 'coding', 'Example', '3', '--date', 'May 1']).out, /--date must be YYYY-MM-DD/);
    assert.match(ws.run('practice', ['log', 'whiteboard', 'Example', '3']), /New format name "whiteboard"\. The usual ones are coding, system-design/);
  } finally { ws.cleanup(); }
});

test('schedule prints each job with its defaults, and changes nothing', () => {
  const ws = buildWorkspace();
  try {
    const specs = JSON.parse(ws.run('schedule', ['--json']));
    assert.deepEqual(specs.map((s) => [s.name, s.schedule, s.preset, s.enabled]), [
      ['roleforward-scout', 'Weekly on Monday at 07:00', true, false], ['roleforward-sheet', 'Daily at 12:30', true, false], ['roleforward-discover', 'Monthly on day 3 at 08:00', false, false]]);
    assert.equal(specs[0].folder, ws.root);
    assert.match(specs[0].instructions, /^\/roleforward:scout This is a scheduled run with no one watching/);
    assert.match(ws.run('schedule', ['sheet']), /^roleforward-sheet \(off\)\n  Description: +Sheet sync/);
  } finally { ws.cleanup(); }
});

test("schedule reads workspace.yaml's schedule settings and rejects bad ones", () => {
  const ws = buildWorkspace();
  try {
    const base = ws.read('workspace.yaml');
    ws.write('workspace.yaml', `${base}\nschedule:\n  scout:\n    enabled: true\n    every: weekly\n    day: thu\n    at: "6:30"\n  sheet:\n    every: weekdays\n    at: "18:00"\n`);
    const [scout, sheet] = JSON.parse(ws.run('schedule', ['--json']));
    assert.deepEqual([scout.schedule, scout.enabled, sheet.schedule], ['Weekly on Thursday at 06:30', true, 'Weekdays at 18:00']);
    ws.write('workspace.yaml', `${base}\nschedule:\n  discover:\n    every: monthly\n    day: 31\n`);
    assert.match(ws.fails('schedule', ['discover']).out, /schedule\.discover\.day must be 1 to 28 for a monthly job\./);
    ws.write('workspace.yaml', `${base}\nschedule:\n  scout:\n    every: hourly\n`);
    assert.match(ws.fails('schedule', ['scout']).out, /schedule\.scout\.every must be daily, weekdays, weekly, or monthly\./);
    assert.match(ws.fails('schedule', ['backup']).out, /Unknown job "backup" \(scout, sheet, discover\)\./);
  } finally { ws.cleanup(); }
});

test('scenario is a known practice format', () => {
  const ws = buildWorkspace();
  try {
    assert.equal(ws.run('practice', ['log', 'scenario', 'Short staffing', '3']).trim(), `Logged scenario: Short staffing, 3/4. Next round due ${inDays(7)}.`);
  } finally { ws.cleanup(); }
});
