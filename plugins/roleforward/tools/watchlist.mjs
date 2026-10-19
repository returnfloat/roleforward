#!/usr/bin/env node
// The watchlist: the employers /scout checks, kept in applications/watchlist.md as one table under "## Watchlist":
//   | Company | Source | Board | Why | Domain |
// Domain groups employers by field (for example Fintech or Health). A row whose Company starts with ~ is paused: the
// scout skips it but keeps its feed. This script edits that table without touching any other line.
//
// The sheet's Employers tab shows every watchlist employer next to its research scores, and the user's edits there come
// back through `sheet.mjs pull-employers`, which uses the functions exported here.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/watchlist.mjs list                  employers by domain, with paused and manual counts
//   node <plugin>/tools/watchlist.mjs add "<Company>" [--domain d] [--source s --board b] [--why "<reason>"]
//                                                          adds a row (manual until a source and board are given),
//                                                          or resumes a paused one
//   node <plugin>/tools/watchlist.mjs set "<Company>" [--domain d] [--source s] [--board b] [--why w]
//   node <plugin>/tools/watchlist.mjs pause|resume|remove "<Company>"

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from './connections.mjs';
import { loadWorkspace } from './workspace.mjs';

const { root } = loadWorkspace();
const FILE = join(root, 'applications', 'watchlist.md');
const today = new Date().toLocaleDateString('en-CA');
const fail = (msg) => { console.error(msg); process.exit(1); };

// ---- Reading and writing ----
// Returns the file split around the table, so a write changes only the rows that changed and keeps every other line.
export function readWatchlist() {
  if (!existsSync(FILE)) return { lines: [], a: 0, b: 0, rows: [], missing: true };
  const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
  const h = lines.findIndex((l) => /^##\s+Watchlist\s*$/.test(l));
  if (h < 0) fail('applications/watchlist.md has no "## Watchlist" section.');
  const a = lines.findIndex((l, i) => i > h && /^\|/.test(l));
  if (a < 0) fail('applications/watchlist.md has no table under "## Watchlist".');
  let b = a;
  while (b < lines.length && /^\|/.test(lines[b])) b++;
  const rows = lines.slice(a + 2, b).filter((l) => readRow(l).company).map((line) => ({ ...readRow(line), line }));
  return { lines, a, b, rows };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/').trim();
const render = (r) => `| ${[(r.paused ? '~' : '') + r.company, r.source, r.board, r.why, r.domain].map(cell).join(' | ')} |`;

export function writeWatchlist(w) {
  if (w.missing) fail('No applications/watchlist.md in this workspace.');
  // An unchanged row keeps its original line, spacing and all, so a sync never reformats the file.
  const body = w.rows.map((r) => {
    const fresh = render(r);
    return r.line && render(readRow(r.line)) === fresh ? r.line : fresh;
  });
  const head = w.lines.slice(w.a, w.a + 2);
  const lines = [...w.lines.slice(0, w.a), ...head, ...body, ...w.lines.slice(w.b)];
  const fm = lines.findIndex((l, i) => i < 10 && /^updated:/.test(l));
  if (fm >= 0) lines[fm] = `updated: ${today}`;
  writeFileSync(FILE, lines.join('\n'));
}
function readRow(line) {
  const [company = '', source = '', board = '', why = '', domain = ''] = line.split('|').slice(1, -1).map((x) => x.trim());
  return { company: company.replace(/^~\s*/, ''), paused: company.startsWith('~'), source, board, why, domain };
}

export const find = (w, name) => w.rows.find((r) => norm(r.company) === norm(name));
// The status the sheet shows for a watchlist row.
export const statusOf = (r) => (r.paused ? 'paused' : r.source === 'manual' ? 'manual' : 'watching');

// ---- Command line ----
function flags(args) {
  const o = {}, pos = [];
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) o[args[i].slice(2)] = args[++i] ?? ''; else pos.push(args[i]);
  return [pos, o];
}

function list() {
  const { rows } = readWatchlist();
  const active = rows.filter((r) => !r.paused);
  const domains = [...new Set(active.map((r) => r.domain || 'Unsorted'))].sort((x, y) => (x === 'Unsorted') - (y === 'Unsorted') || x.localeCompare(y));
  for (const d of domains) {
    const xs = active.filter((r) => (r.domain || 'Unsorted') === d);
    console.log(`${d} (${xs.length}): ${xs.map((r) => r.company + (r.source === 'manual' ? '*' : '')).join(', ')}`);
  }
  const p = rows.filter((r) => r.paused);
  if (p.length) console.log(`Paused (${p.length}): ${p.map((r) => r.company).join(', ')}`);
  console.log(`${active.length} active (${active.filter((r) => r.source !== 'manual').length} with a feed, * = manual), ${p.length} paused.`);
}

// Run as a script (sheet.mjs imports the functions above without running this).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const [pos, opt] = flags(rest);
  if (cmd === 'list') list();
  else if (['add', 'set', 'pause', 'resume', 'remove'].includes(cmd)) {
    const name = pos[0];
    if (!name) fail(`Usage: watchlist.mjs ${cmd} "<Company>"`);
    const w = readWatchlist(), r = find(w, name);
    if (cmd === 'add') {
      if (r && !r.paused) fail(`${r.company} is already on the watchlist.`);
      if (r) Object.assign(r, { paused: false, ...(opt.domain !== undefined ? { domain: opt.domain } : {}) });
      else w.rows.push({ company: name, paused: false, source: opt.source || 'manual', board: opt.board || '', why: opt.why || '', domain: opt.domain || '' });
    } else {
      if (!r) fail(`${name} isn't on the watchlist.`);
      if (cmd === 'set') for (const k of ['domain', 'source', 'board', 'why']) if (opt[k] !== undefined) r[k] = opt[k];
      if (cmd === 'pause') r.paused = true;
      if (cmd === 'resume') r.paused = false;
      if (cmd === 'remove') w.rows.splice(w.rows.indexOf(r), 1);
    }
    writeWatchlist(w);
    const now = find(w, name);
    console.log(now ? `${now.paused ? '~' : ''}${now.company} | ${now.source} | ${now.board} | ${now.why} | ${now.domain || '(no domain)'}` : `${name} removed from the watchlist.`);
  }
  else console.error('Usage: node <plugin>/tools/watchlist.mjs list | add "<Company>" [--domain d] [--source s --board b --why w] | set "<Company>" [--domain d] [--source s] [--board b] [--why w] | pause|resume|remove "<Company>"');
}
