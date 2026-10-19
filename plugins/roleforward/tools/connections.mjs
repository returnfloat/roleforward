#!/usr/bin/env node
// The optional connections module: finds the user's 1st-degree LinkedIn connections who work at a posting's company,
// as possible referral paths. Its only input is the Connections.csv file from LinkedIn's data export. It never signs in
// to LinkedIn, never reads any other file in the export (messages, invitations, profile), and never contacts anyone.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/connections.mjs import <Connections.csv | LinkedIn export .zip>
//                                         keeps each connection's full name, company, title, profile link, and connected-on date in
//                                         contacts/connections.csv. From a zip, only Connections.csv is read.
//   node <plugin>/tools/connections.mjs status          when the connections were exported, how many, and whether to refresh
//   node <plugin>/tools/connections.mjs match <company>  connections at that company, best referral prospects first, plus
//                                         near-miss company names for the user to confirm (and add as aliases)
//   node <plugin>/tools/connections.mjs forget           deletes the imported connections
//
// Settings in workspace.yaml (connections.*): enabled, refresh_days (30), function_words (regex fragments for the
// user's own function, defaulting to the scout's first title pattern), and aliases (company: [other names it goes by]).

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, readCsv, writeCsv } from './csv.mjs';
import { loadWorkspace, regex } from './workspace.mjs';
import { readZipEntry } from './zip.mjs';

const { root, get } = loadWorkspace();
const DIR = join(root, 'contacts');
const FILE = join(DIR, 'connections.csv');
const META = join(DIR, 'import.json');
const COLS = ['name', 'company', 'title', 'url', 'connected_on'];
const today = new Date().toLocaleDateString('en-CA');
const ageDays = (d) => Math.round((Date.parse(today) - Date.parse(d)) / 864e5);
const iso = (d) => { const t = Date.parse(d); return Number.isNaN(t) ? '' : new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

export const enabled = () => get('connections.enabled', false) === true;
const meta = () => (existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : null);

// One gentle line when the export is older than refresh_days, or '' when it's fresh (or the module is off).
export function freshness() {
  if (!enabled()) return '';
  const m = meta();
  if (!m) return 'Connections are turned on but not imported yet. Download your LinkedIn data archive and run the connections import.';
  const days = ageDays(m.exported), limit = +get('connections.refresh_days', 30) || 30;
  return days > limit ? `Your LinkedIn connections are from ${m.exported} (${days} days ago). A fresh export from LinkedIn would catch anyone who changed jobs since.` : '';
}

// ---- company names ----
// Lowercase, "&" as "and", punctuation and legal endings dropped: "Example.com, Inc." and "example" match.
const ENDINGS = /\b(the|inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|lp|llp|pbc|com)\b/g;
export const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(ENDINGS, ' ').replace(/\s+/g, ' ').trim();

// Whether one company name abbreviates the other: "VW" and "Volkswagen", or "Rivian and VW Group Technologies" and
// "Rivian and Volkswagen Group Technologies". The short form is written in capitals (2 to 5 letters). Once the words
// both names share at the start and end are set aside, it's the initials of the other name's first words ("EB" for
// "Employer B"), or letters of its first word in order with gaps between them (Volks-Wagen), so "GE" doesn't match
// "Gemini". Used only for similar names the user confirms, never to count a match.
export function abbreviates(short, long) {
  const caps = String(short ?? '').split(/[^A-Za-z0-9]+/).filter((t) => /^[A-Z]{2,5}$/.test(t)).map((t) => t.toLowerCase());
  if (!caps.length) return false;
  const a = norm(short).split(' '), b = norm(long).split(' ');
  while (a.length > 1 && b.length > 1 && a.at(-1) === b.at(-1)) { a.pop(); b.pop(); }
  while (a.length > 1 && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  const t = a.length === 1 ? a[0] : '';
  if (!caps.includes(t) || !b[0] || b.join(' ') === t) return false;
  if (b.length >= t.length && b.slice(0, t.length).map((w) => w[0]).join('') === t) return true;
  let at = 0;
  if (b[0][0] !== t[0] || b[0].length < 2 * t.length) return false;
  for (const ch of t.slice(1)) { at = b[0].indexOf(ch, at + 2); if (at < 0) return false; }
  return true;
}

// Every name a company goes by: connections.aliases groups (a parent and its brands match each other both ways).
function names(company) {
  const out = new Set([norm(company)]);
  for (const [k, v] of Object.entries(get('connections.aliases', {}) || {})) {
    const group = [k, ...(Array.isArray(v) ? v : [v])].map(norm);
    if (group.some((n) => out.has(n))) group.forEach((n) => out.add(n));
  }
  out.delete('');
  return out;
}

// ---- ranking ----
const RECRUITING = /\b(recruit\w*|talent|sourc(er|ing)|hiring|staffing|people partner|hr business partner)\b/i;
const functionWords = () => regex(get('connections.function_words', '') || get('scout.title_all', [])[0] || '', null);
function tier(title, fn) {
  if (fn && fn.test(title)) return [0, 'same field'];
  if (RECRUITING.test(title)) return [1, 'recruiting'];
  return [2, 'other'];
}

let cache;
const all = () => (cache ??= readCsv(FILE));

// Connections at a company, best referral prospects first: the user's own field, then recruiting, then everyone else,
// and the longest-standing connection first within each.
export function contactsAt(company) {
  if (!enabled() || !company) return [];
  const want = names(company), fn = functionWords();
  return all().filter((c) => want.has(norm(c.company)))
    .map((c) => { const [rank, why] = tier(c.title, fn); return { ...c, rank, why }; })
    .sort((a, b) => a.rank - b.rank || (a.connected_on || '9').localeCompare(b.connected_on || '9') || a.name.localeCompare(b.name));
}

// The sheet's Contacts cell: a count and the top three, for example "3: Jane Doe (Senior Manager, Security); ...".
export function cell(company, top = 3) {
  const cs = contactsAt(company);
  if (!cs.length) return '';
  const shown = cs.slice(0, top).map((c) => (c.title ? `${c.name} (${c.title})` : c.name));
  return `${cs.length}: ${shown.join('; ')}${cs.length > top ? `; +${cs.length - top} more` : ''}`;
}

// Company names that contain the posting's company as a whole word, or the reverse, or abbreviate it, without matching it. Shown only by
// `match`, for the user to confirm, so a "Meta" posting never picks up "Metadata Inc" on its own.
function nearMisses(company) {
  const want = names(company), out = new Map();
  for (const c of all()) {
    const n = norm(c.company);
    if (!n || want.has(n)) continue;
    for (const w of want) {
      if (w.length < 3) continue;
      const word = (a, b) => new RegExp(`(^| )${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(a);
      if (word(n, w) || word(w, n) || abbreviates(c.company, company) || abbreviates(company, c.company)) { out.set(c.company, (out.get(c.company) ?? 0) + 1); break; }
    }
  }
  return [...out].sort((a, b) => b[1] - a[1]);
}

// ---- import ----
function readExport(file) {
  if (!/\.zip$/i.test(file)) return readFileSync(file, 'utf8');
  // Reads Connections.csv alone from the archive, in memory. Nothing else in it is opened or written to disk.
  const text = readZipEntry(file, (name) => /(^|\/)Connections\.csv$/i.test(name.trim()));
  if (text === null) throw new Error(`No Connections.csv in ${file}. Request LinkedIn's larger data archive, which includes connections.`);
  return text;
}

function importFile(file) {
  if (!file || !existsSync(file)) throw new Error(`File not found: ${file ?? '(none given)'}`);
  const text = readExport(file).replace(/^﻿/, '');
  // LinkedIn puts a short "Notes:" preamble above the header row.
  const start = text.search(/^"?First Name"?,/m);
  if (start < 0) throw new Error("This doesn't look like LinkedIn's Connections.csv (no First Name column).");
  const rows = parseCsv(text.slice(start)).map((r) => ({
    name: [r['First Name'], r['Last Name']].map((s) => (s ?? '').trim()).filter(Boolean).join(' '),
    company: (r.Company ?? '').trim(), title: (r.Position ?? '').trim(), url: (r.URL ?? '').trim(), connected_on: iso(r['Connected On']),
  })).filter((r) => r.name);
  mkdirSync(DIR, { recursive: true });
  writeCsv(FILE, COLS, rows.sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name)));
  // The export's date is the downloaded file's date, which is when LinkedIn built it (close enough for the refresh nudge).
  const exported = new Date(statSync(file).mtimeMs).toLocaleDateString('en-CA');
  writeFileSync(META, JSON.stringify({ exported: exported > today ? today : exported, imported: today, count: rows.length }, null, 2) + '\n');
  const withCompany = rows.filter((r) => r.company).length;
  console.log(`Imported ${rows.length} connections (${withCompany} list a company) into contacts/connections.csv. Kept: full name, company, title, profile link, and connected-on date. Email addresses were not kept.`);
  if (/\.zip$/i.test(file)) console.log(`Only Connections.csv was read from the archive. The archive also holds your messages and other account data, so consider deleting it: ${file}`);
  if (!enabled()) console.log('The module is off in workspace.yaml (connections.enabled), so matches stay hidden until it is turned on.');
}

function status() {
  const m = meta();
  if (!m) { console.log(`Connections: ${enabled() ? 'on' : 'off'}, nothing imported.`); return; }
  console.log(`Connections: ${enabled() ? 'on' : 'off'}. ${m.count} imported ${m.imported}, exported ${m.exported} (${ageDays(m.exported)} days ago).`);
  const f = freshness();
  if (f) console.log(f);
}

function match(company) {
  if (!company) throw new Error('Usage: connections.mjs match <company>');
  if (!enabled()) { console.log('The connections module is off (connections.enabled in workspace.yaml).'); return; }
  const cs = contactsAt(company);
  console.log(cs.length ? `${cs.length} connection(s) at ${company}:\n${cs.map((c) => `  ${c.name}, ${c.title || 'no title'} (${c.why}${c.connected_on ? `, connected ${c.connected_on}` : ''})${c.url ? ` ${c.url}` : ''}`).join('\n')}`
    : `No connections at ${company}.`);
  const near = nearMisses(company);
  if (near.length) console.log(`Similar company names, not counted (add one under connections.aliases if it's the same employer):\n${near.map(([n, k]) => `  ${n} (${k})`).join('\n')}`);
  const f = freshness();
  if (f) console.log(f);
}

function forget() {
  for (const f of [FILE, META]) rmSync(f, { force: true });
  if (existsSync(DIR)) try { rmSync(DIR); } catch { /* the folder holds other files; leave it */ }
  console.log('Deleted the imported connections. Set connections.enabled to false in workspace.yaml to turn the module off.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === 'import') importFile(args[0]);
    else if (cmd === 'status') status();
    else if (cmd === 'match') match(args.join(' '));
    else if (cmd === 'forget') forget();
    else console.error('Usage: node <plugin>/tools/connections.mjs import <file> | status | match <company> | forget');
  } catch (e) { console.error(e.message); process.exit(1); }
}
