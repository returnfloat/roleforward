#!/usr/bin/env node
// The practice log for mock interviews and drills (the prep skill runs the rounds). One row per scored attempt, in
// practice/practice.csv, and spaced review: a weak topic comes back in a day or two, a strong one in weeks.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/practice.mjs log <format> "<topic>" <score 1-4> ["<what to fix>"] [--prompt "<the question>"] [--date YYYY-MM-DD]
//   node <plugin>/tools/practice.mjs due [<format>]     topics due for another round, most overdue first
//   node <plugin>/tools/practice.mjs stats              rounds, average scores, and the trend per format
//
// Formats are free text, but these names keep the stats grouped: coding, system-design, ml-design, sql, analytics,
// product-sense, execution, behavioral, leadership, scenario, case, portfolio-review, take-home, domain.
// Scores use the rubric scale: 1 no hire, 2 lean no, 3 lean hire, 4 strong hire.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, writeCsv } from './csv.mjs';
import { loadWorkspace } from './workspace.mjs';

const { root } = loadWorkspace();
const FILE = join(root, 'practice', 'practice.csv');
const COLS = ['date', 'format', 'topic', 'score', 'next_due', 'fix', 'prompt'];
const FORMATS = ['coding', 'system-design', 'ml-design', 'sql', 'analytics', 'product-sense', 'execution', 'behavioral', 'leadership', 'scenario', 'case', 'portfolio-review', 'take-home', 'domain'];
const today = new Date().toLocaleDateString('en-CA');
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const fail = (msg) => { console.error(msg); process.exit(1); };

// Days until the next round of a topic: by score, and a strong score after a strong score doubles the last gap (up to 60).
const BASE = { 1: 1, 2: 3, 3: 7, 4: 21 };
function interval(score, prev) {
  if (score === 4 && prev && +prev.score === 4) return Math.min(60, 2 * Math.max(21, (Date.parse(prev.next_due) - Date.parse(prev.date)) / 864e5));
  return BASE[score];
}

const rows = () => readCsv(FILE);
const key = (r) => `${r.format}|${r.topic.toLowerCase()}`;
// The latest attempt at each topic.
function latest() {
  const by = new Map();
  for (const r of rows().sort((a, b) => a.date.localeCompare(b.date))) by.set(key(r), r);
  return [...by.values()];
}

function log(args) {
  const opts = {}, pos = [];
  for (let i = 0; i < args.length; i++) args[i].startsWith('--') ? (opts[args[i].slice(2)] = args[++i] ?? '') : pos.push(args[i]);
  const [format, topic, scoreArg, fix = ''] = pos;
  const score = +scoreArg;
  if (!format || !topic || ![1, 2, 3, 4].includes(score)) fail('Usage: practice.mjs log <format> "<topic>" <score 1-4> ["<what to fix>"] [--prompt "<question>"] [--date YYYY-MM-DD]');
  const date = opts.date || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got ${date}`);
  const all = rows(), prev = all.filter((r) => key(r) === `${format}|${topic.toLowerCase()}`).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const row = { date, format, topic, score, next_due: addDays(date, interval(score, prev)), fix, prompt: opts.prompt || '' };
  mkdirSync(join(root, 'practice'), { recursive: true });
  writeCsv(FILE, COLS, [...all, row]);
  console.log(`Logged ${format}: ${topic}, ${score}/4. Next round due ${row.next_due}.${FORMATS.includes(format) ? '' : ` (New format name "${format}". The usual ones are ${FORMATS.join(', ')}.)`}`);
}

function due(format) {
  const list = latest().filter((r) => r.next_due <= today && (!format || r.format === format)).sort((a, b) => a.next_due.localeCompare(b.next_due));
  if (!list.length) return console.log(`Nothing due${format ? ` in ${format}` : ''}. ${rows().length ? 'Pick a new topic, or the format of an upcoming interview.' : 'No rounds logged yet.'}`);
  console.log(`Due for another round (${list.length}):`);
  for (const r of list) console.log(`  ${r.format}: ${r.topic} (last ${r.score}/4 on ${r.date}, due ${r.next_due})${r.fix ? ` Fix: ${r.fix}` : ''}`);
}

function stats() {
  const all = rows();
  if (!all.length) return console.log('No rounds logged yet.');
  const avg = (xs) => (xs.length ? (xs.reduce((s, x) => s + +x.score, 0) / xs.length).toFixed(1) : '-');
  console.log('Format | Rounds | Topics | Average (latest per topic) | Last 5 rounds | Previous 5');
  for (const f of [...new Set(all.map((r) => r.format))].sort()) {
    const fr = all.filter((r) => r.format === f).sort((a, b) => a.date.localeCompare(b.date));
    console.log(`${f} | ${fr.length} | ${latest().filter((r) => r.format === f).length} | ${avg(latest().filter((r) => r.format === f))} | ${avg(fr.slice(-5))} | ${avg(fr.slice(-10, -5))}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'log') log(args);
else if (cmd === 'due') due(args[0]);
else if (cmd === 'stats') stats();
else console.error('Usage: node <plugin>/tools/practice.mjs log <format> "<topic>" <score 1-4> ["<fix>"] | due [<format>] | stats');
