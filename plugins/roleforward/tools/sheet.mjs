#!/usr/bin/env node
// Builds what the sheet skill writes to the user's Google Sheet, so every workspace's sheet looks and sorts the same.
// It never talks to Google itself: the skill passes this output to the Google Sheets connector.
//
// Usage (run from inside the workspace, after tracker.mjs):
//   node <plugin>/tools/sheet.mjs rows shortlist      JSON rows for Shortlist!A2 (live postings, best fit first)
//   node <plugin>/tools/sheet.mjs rows scoutlog       JSON rows for 'Scout Log'!A2 (postings that passed the first screen
//                                                     in the last sheet.scout_log_days days, newest first)
//   node <plugin>/tools/sheet.mjs rows history        JSON rows for History!A2 (postings that ended in the last
//                                                     sheet.history_days days, plus every one that reached an application)
//   node <plugin>/tools/sheet.mjs rows stats          JSON rows for Stats!A2 (the tracker's summary, funnel, and breakdowns)
//   node <plugin>/tools/sheet.mjs rows employers      JSON rows for Employers!A2: one per watchlist employer, plus any company
//                                                     with research (company.md) that isn't on the watchlist, with its scout
//                                                     counts and research scores (by domain, then company)
//   node <plugin>/tools/sheet.mjs add-tab <tab> [index]   batchUpdate requests that add one formatted tab to an existing sheet
//   node <plugin>/tools/sheet.mjs headers <tab>       the header row for a tab (shortlist, scoutlog, history, employers, career)
//   node <plugin>/tools/sheet.mjs ranges [--full]    the ranges each pull reads: only the columns it needs (the header row,
//                                                     the columns that identify a row, and the ones the user may edit).
//                                                     --full: whole tabs, for checking the sheet for other hand edits
//   node <plugin>/tools/sheet.mjs pull <values.json>... [--apply]
//                                                     reads the Shortlist's values (each file a get_values response for one
//                                                     of the ranges above, with its range, or the whole tab from A1, header
//                                                     row included), and logs each Status the user changed with the dropdown
//                                                     as an event in that posting.md. Without --apply it only prints what it
//                                                     would do. It refuses a header row that isn't this version's layout
//   node <plugin>/tools/sheet.mjs upgrade <header.json> [--rules <n>]
//                                                     batchUpdate requests that bring an existing sheet's Shortlist to this
//                                                     version's layout, from its header row (Shortlist!A1:P1): the Next column
//                                                     after Last event, its header and format, and the tab's conditional
//                                                     formats and filter reset (--rules: how many conditional format rules the
//                                                     Shortlist has now, from get_spreadsheet). [] when it's already current
//   node <plugin>/tools/sheet.mjs pull-employers <values.json>... [--apply] [--force]
//                                                     reads the Employers tab's values (its ranges above, or the whole tab from
//                                                     A2) and brings the user's edits (new rows, Domain, Status, deleted rows)
//                                                     into applications/watchlist.md
//   node <plugin>/tools/sheet.mjs pull-history <values.json>... [--apply]
//                                                     reads the History tab's values (its ranges above, or the whole tab from
//                                                     A2) and saves each Reason the user typed as the note on that posting's
//                                                     ending event
//   node <plugin>/tools/sheet.mjs changed [--all] [tab...]
//                                                     which tabs differ from what the last sync wrote, and for each one whether
//                                                     to patch only its changed cells or clear, write, and read back the whole
//                                                     tab. --all, or naming tabs, counts them as changed and rewrites them
//   node <plugin>/tools/sheet.mjs patch <values.json>...
//                                                     the cells to write for each tab changed planned to patch, as JSON (clear,
//                                                     write, readback with the values to expect, dropdown, and rewrite), from
//                                                     the sheet's check columns: the files the pulls read, plus a read of the
//                                                     check range changed names for each other tab. A tab whose rows aren't in
//                                                     the order the last sync wrote them is listed to rewrite instead
//   node <plugin>/tools/sheet.mjs synced              records what this sync wrote (data/sheet-sync.json), after the read-back.
//                                                     The pulls count a cell as the user's edit only when it differs from that
//                                                     record, so a change made in the workspace since the last sync isn't undone
//   node <plugin>/tools/sheet.mjs setup               batchUpdate requests that add and format every tab on a new sheet
//   node <plugin>/tools/sheet.mjs prune [--apply]     archives postings that ended more than sheet.history_days ago without an
//                                                     application: one line in data/archive.csv, and the folder is deleted
//   node <plugin>/tools/sheet.mjs dropdown [tab...]  batchUpdate requests that put the dropdowns on filled rows only (the
//                                                     Shortlist's Status, and the Employers tab's Domain and Status), for the
//                                                     named tabs (shortlist, employers), or both
//   node <plugin>/tools/sheet.mjs filters [tab...]   batchUpdate requests that put a sort-and-filter header over every column of
//                                                     the named tabs (all tabs if none). Resets any filter choices on them
//   node <plugin>/tools/sheet.mjs career-formula <row>   the Duration formula for a Career row
//
// Rows are written with update_values. Dates carry a leading apostrophe so Sheets keeps them as text, fit scores
// are numbers, and posting links are HYPERLINK formulas.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readCsv, writeCsv } from './csv.mjs';
import { readFrontmatter, appendEvent, setLastEventNote, parseEvent } from './frontmatter.mjs';
import { LIVE, ENDED, nextCell } from './records.mjs';
import { loadWorkspace, palette } from './workspace.mjs';
import { cell as contactsCell, freshness, norm } from './connections.mjs';
import { readWatchlist, writeWatchlist, find, statusOf } from './watchlist.mjs';
import { rankCompare } from './fit.mjs';

const { root, get } = loadWorkspace();
const PALETTE = palette(get);
const MATURITY = get('tracker.maturity_field', 'function_maturity');
const maturityLabel = MATURITY.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
// Every stage the Shortlist's Status dropdown offers, in the order a posting moves through them.
const STAGES = [...LIVE, 'accepted', 'passed', 'withdrawn', 'rejected', 'no-response', 'declined-offer', 'expired'];
const LOG_DAYS = +get('sheet.scout_log_days', 14) || 14;
const HISTORY_DAYS = +get('sheet.history_days', 30) || 30;
// Notes for changes made in the sheet name the person, for example "Passed by Sam in the sheet".
const NAME = String(get('person.name', '') || '').split(/\s+/)[0] || 'the user';
const sheetNote = (stage) => (stage === 'passed' ? `Passed by ${NAME} in the sheet` : `Set to ${stage} by ${NAME} in the sheet`);
const daysAgo = (n) => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
const today = new Date().toLocaleDateString('en-CA');

export const TABS = {
  // Shortlist and History end with each posting's folder (its id), in muted text, so a Status picked or a Reason typed
  // in the sheet finds its record. Their Contacts column lists the user's LinkedIn connections at the company (the
  // optional connections module), and stays empty when the module is off.
  // Referral stays blank while a posting is only shortlisted: it's asked when the user marks it interested.
  // Role fit and Preference fit are the two scores from fit.mjs, never blended. Rows sort by the lower of the two first.
  // Next is the posting's next action (date and what happens), for display: it's set in the workspace with next.mjs.
  // A posting with none set shows the usual next step for its stage, marked (suggested).
  shortlist: { id: 0, title: 'Shortlist', headers: ['Company', 'Role', 'Status', 'Role fit', 'Preference fit', 'Last event', 'Next', 'Applied', 'Track', 'Resume', 'Source', 'Referral', "Why it's here", 'Contacts', 'Posting', 'Record ID'],
    widths: [240, 220, 140, 80, 100, 100, 260, 100, 100, 120, 150, 80, 420, 300, 120, 200], center: [2, 3, 4, 5, 7, 11], wrap: [1, 6, 12, 13], status: 2, scores: [3, 4], muted: [15], next: 6 },
  scoutlog: { id: 4, title: 'Scout Log', headers: ['Company', 'Role', 'Location', 'Posted', 'First seen', 'Last seen', 'Scout call', 'Reason', 'Posting'],
    widths: [200, 280, 200, 100, 100, 100, 110, 420, 120], center: [3, 4, 5, 6], wrap: [1, 2, 7], call: 6 },
  history: { id: 2, title: 'History', headers: ['Company', 'Role', 'Outcome', 'Ended', 'Reason', 'Role fit', 'Preference fit', 'Applied', 'Source', 'Resume', 'Why it was here', 'Contacts', 'Posting', 'Record ID'],
    widths: [240, 220, 120, 100, 300, 80, 100, 100, 140, 120, 380, 300, 120, 200], center: [2, 3, 5, 6, 7], wrap: [1, 4, 10, 11], outcome: 2, reason: 4, scores: [5, 6], muted: [13] },
  // The tracker's numbers as one table: Summary, Funnel, then one block per breakdown. Section names repeat on every row so
  // the tab can be filtered. Columns C to G hold whatever the section measures.
  stats: { id: 5, title: 'Stats', headers: ['Section', 'Item', 'Count or applied', 'Got a response', 'Reached interviews', 'Median days to response', 'Share'],
    widths: [170, 280, 130, 130, 130, 170, 90], center: [2, 3, 4, 5, 6], wrap: [] },
  // Every employer the user knows: the watchlist (the scout's settings) joined with company.md (research), one row each.
  // Domain and Status are the user's to edit, and a new row adds an employer (see pullEmployers). Status is watching (has
  // a feed), manual (checked by hand), paused (skipped by the scout), or not watched (research only, not on the watchlist).
  // Research columns hold company facts only. Whether those facts suit the user is a preference, rated per posting.
  employers: { id: 1, title: 'Employers', headers: ['Company', 'Domain', 'Status', 'Why', 'Feed', 'Screened', 'Shortlisted', 'Applied', 'Ownership', 'Stability', 'Growth', maturityLabel, 'Quick check', 'Researched', 'Verdict'],
    widths: [200, 170, 115, 300, 110, 85, 95, 75, 120, 85, 80, 115, 100, 100, 480], center: [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], wrap: [3, 14], scores: [9, 10, 11], wstatus: 2 },
  career: { id: 3, title: 'Career', headers: ['Employer', 'Title', 'Start', 'End', 'Duration', 'Location', 'Work mode', 'Track', 'Type', 'Scope'],
    widths: [220, 260, 95, 95, 85, 130, 95, 100, 95, 520], center: [2, 3, 4, 6, 7, 8], wrap: [1, 9], dates: [2, 3] },
};
// The Shortlist's header row before the Next column, so an existing sheet can be recognized and brought up to date.
const SHORTLIST_BEFORE_NEXT = TABS.shortlist.headers.filter((h) => h !== 'Next');
const ALIAS = { 'scout-log': 'scoutlog', watchlist: 'employers' };
export const EMPLOYER_STATUSES = ['watching', 'manual', 'paused', 'not watched'];
const tabKey = (t) => ALIAS[t] ?? t;
// The tabs the sync writes from the workspace. Career is kept by hand, from the resume.
const GENERATED = ['shortlist', 'scoutlog', 'history', 'stats', 'employers'];

// ---- Ranges ----
// Column letters, and A1 ranges, with the tab's name quoted when it has a space ('Scout Log'!A2:I1000).
const R = 1000;
const col = (i) => (i >= 26 ? col(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const a1 = (t, c0, c1, r0, r1) => `${/\s/.test(t.title) ? `'${t.title}'` : t.title}!${col(c0)}${r0}:${col(c1)}${r1}`;
const dataRange = (t, n = R - 1) => a1(t, 0, t.headers.length - 1, 2, 1 + Math.max(n, 1));
// The columns each pull reads: the ones that identify a row (company and role, checked against the Record ID, or the
// company name on the Employers tab) and the ones the user may edit (Status, Reason, Domain). History's Outcome is read
// too, since a reason is saved only on the record's latest stage. The Shortlist's header row is read whole, so a sheet
// in another layout is refused before any of its columns are trusted.
const PULLS = {
  shortlist: { cols: [0, 1, TABS.shortlist.status, TABS.shortlist.headers.length - 1], header: true },
  history: { cols: [0, 1, TABS.history.outcome, TABS.history.reason, TABS.history.headers.length - 1] },
  employers: { cols: [0, 1, TABS.employers.wstatus] },
};
function pullRanges(key, full) {
  const t = TABS[key], p = PULLS[key], out = [];
  if (full) return [a1(t, 0, t.headers.length - 1, p.header ? 1 : 2, R)];
  if (p.header) out.push(a1(t, 0, t.headers.length - 1, 1, 1));
  const cols = [...new Set(p.cols)].sort((a, b) => a - b);
  for (let i = 0; i < cols.length; ) {
    let j = i;
    while (cols[j + 1] === cols[j] + 1) j++;
    out.push(a1(t, cols[i], cols[j], 2, R));
    i = j + 1;
  }
  return out;
}

const text = (d) => (d ? `'${d}` : '');
const link = (url) => (url ? `=HYPERLINK("${url}","View posting")` : '');
const num = (v) => (v === '' || v === undefined ? '' : +v);

// With the Drive folder on, a posting's role links to its packet Doc, when the user has asked for one (docs.mjs).
// The cell still reads as the role, so the pulls match it as before.
function roleCell(r) {
  const f = join(root, 'applications', 'data', 'drive.json');
  const doc = get('drive.enabled', false) === true && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).docs?.[r.id]?.doc : null;
  return doc ? `=HYPERLINK("https://docs.google.com/document/d/${doc}/edit","${r.role.replace(/"/g, '""')}")` : r.role;
}

function rows(tab) {
  const apps = readCsv(join(root, 'applications', 'data', 'applications.csv'));
  if (tab === 'shortlist') {
    return apps.filter((r) => LIVE.includes(r.status))
      .sort(rankCompare)
      .map((r) => [r.company, roleCell(r), r.status, num(r.role_fit), num(r.preference_fit), text(r.last_event), nextCell(r, ' · '), text(r.applied), r.track, r.resume, r.source, r.status === 'shortlisted' ? '' : r.referral, r.why, contactsCell(r.company), link(r.posting), r.id]);
  }
  if (tab === 'scoutlog') {
    // A rolling window: postings first seen in the last LOG_DAYS days. Older ones drop off at the next sync.
    const cutoff = daysAgo(LOG_DAYS);
    return readCsv(join(root, 'applications', 'data', 'seen.csv')).filter((r) => r.first_seen >= cutoff)
      .sort((a, b) => b.first_seen.localeCompare(a.first_seen) || a.company.localeCompare(b.company) || a.title.localeCompare(b.title))
      .map((r) => [r.company, r.title, r.location, text(r.posted), text(r.first_seen), text(r.last_seen), r.decision, r.reason, link(r.url)]);
  }
  if (tab === 'history') {
    const events = readCsv(join(root, 'applications', 'data', 'events.csv'));
    const lastNote = (id) => events.filter((e) => e.id === id).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.note ?? '';
    // A rolling window: postings that ended in the last HISTORY_DAYS days, plus every posting that reached an application,
    // which stays for good. Older ones are archived by prune (see below).
    const cutoff = daysAgo(HISTORY_DAYS);
    return apps.filter((r) => ENDED.includes(r.status) && !r.archived && (r.applied || r.last_event >= cutoff)).sort((a, b) => b.last_event.localeCompare(a.last_event))
      .map((r) => [r.company, roleCell(r), r.status, text(r.last_event), lastNote(r.id), num(r.role_fit), num(r.preference_fit), text(r.applied), r.source, r.resume, r.why, contactsCell(r.company), link(r.posting), r.id]);
  }
  if (tab === 'stats') {
    const f = join(root, 'applications', 'data', 'stats.json');
    if (!existsSync(f)) return [];
    const st = JSON.parse(readFileSync(f, 'utf8'));
    const label = (k) => `By ${k.replace(/_/g, ' ')}`;
    return [['Summary', 'Updated', text(st.updated), '', '', '', ''],
      ...st.summary.map(([k, v]) => ['Summary', k, v, '', '', '', '']),
      ...st.funnel.map(([stage, n, share]) => ['Funnel', stage, n, '', '', '', share]),
      ...Object.entries(st.breakdowns).flatMap(([k, rs]) => rs.map(([g, n, resp, iv, med]) => [label(k), g, n, resp, iv, med, ''])),
      ...(st.drops || []).map(([name, n]) => ['Drops by dealbreaker or setting', name, n, '', '', '', ''])];
  }
  if (tab === 'employers') {
    const data = (f) => readCsv(join(root, 'applications', 'data', f));
    const seen = data('seen.csv'), archived = data('archive.csv');
    const count = (list, name, ok = () => true) => list.filter((r) => norm(r.company) === norm(name) && ok(r)).length;
    const research = new Map(), dir = join(root, 'applications');
    for (const c of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      const f = join(dir, c.name, 'company.md');
      if (c.isDirectory() && existsSync(f)) { const d = readFrontmatter(f).data; if (d.company) research.set(norm(d.company), d); }
    }
    const row = (name, domain, status, why, feed) => {
      const d = research.get(norm(name)) ?? {}, score = (k) => (+d[k] ? +d[k] : '');
      return [name, domain, status, why, feed, count(seen, name), count(apps, name) + count(archived, name), count(apps, name, (r) => r.applied),
        d.ownership ?? '', score('stability'), score('growth'), score(MATURITY), text(d.quick_checked), text(d.researched), d.verdict ?? ''];
    };
    const { rows: wl } = readWatchlist();
    const out = wl.map((w) => row(w.company, w.domain, statusOf(w), w.why, w.source === 'manual' ? '' : w.source));
    for (const d of research.values()) if (!wl.some((w) => norm(w.company) === norm(d.company))) out.push(row(d.company, '', 'not watched', '', ''));
    // By domain (employers with none last), then company.
    return out.sort((a, b) => (!a[1]) - (!b[1]) || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  }
  throw new Error(`rows: unknown tab "${tab}" (shortlist, scoutlog, history, stats, or employers). Career rows come from the resume, via the sheet skill.`);
}

// ---- Status changes made in the sheet ----
// The Shortlist's Status column is the one place the user writes to the sheet. Each changed row becomes a dated event in
// that posting's posting.md, so the workspace stays the source of truth. A row is applied only when its Record ID points
// at a record with the same company and role, so a partial sort in the sheet can never move a status onto the wrong posting.
const readGrid = (file) => { const v = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(v) ? v : v.values ?? []; };
// A tab's values from one or more files, each a get_values response ({ range, values }), a list of them, or a bare grid
// (the whole tab: from A1 on the Shortlist, header row included, and from A2 on the others). Each cell lands in its own
// column, so the pulls read the narrow ranges and a whole tab alike. A column a pull needs that no file covers stops it,
// so a missing range can never pass for empty cells, and values from another tab are refused.
const flatParts = (v) => (Array.isArray(v) ? (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x)) ? v.flatMap(flatParts) : [{ values: v }])
  : v?.valueRanges ? v.valueRanges.flatMap(flatParts) : [v ?? {}]);
// A range's tab name, or null for a bare grid.
const tabOfRange = (range) => { const m = String(range ?? '').match(/^(?:'((?:[^']|'')+)'|([^!']+))!/); return m ? (m[1] ?? m[2]).replace(/''/g, "'") : null; };
// parts: [file, part] pairs already read (patch hands each tab its own), in place of files.
function readTab(files, key, p = PULLS[key], parts = null) {
  const t = TABS[key], width = t.headers.length, covered = new Set(), grid = [];
  let header = null;
  const stop = (msg) => { console.error(`${msg} Nothing was written.`); process.exit(1); };
  if (!parts && !files.length) stop(`Name the file(s) holding the ${t.title} tab's values (sheet.mjs ranges lists what to read).`);
  const all = parts ?? files.flatMap((file) => flatParts(JSON.parse(readFileSync(file, 'utf8'))).map((part) => [file, part]));
  for (const [file, part] of all) {
    let c0 = 0, c1 = width - 1, r0 = p.header ? 1 : 2, r1 = R;
    if (part.range) {
      const m = String(part.range).match(/^(?:'((?:[^']|'')+)'|([^!']+))!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/i);
      if (!m) stop(`${file}: "${part.range}" isn't a range this can read.`);
      const tab = (m[1] ?? m[2]).replace(/''/g, "'");
      if (tab !== t.title) stop(`${file} holds values from the ${tab} tab, not ${t.title}.`);
      c0 = colIndex(m[3]); r0 = +(m[4] || 1); c1 = m[5] ? colIndex(m[5]) : c0; r1 = m[6] ? +m[6] : R;
    }
    if (r1 >= 2) for (let c = c0; c <= c1; c++) covered.add(c);
    for (const [i, row] of (part.values ?? []).entries()) {
      const r = r0 + i, cells = (row || []).slice(0, c1 - c0 + 1);
      const target = r === 1 ? (header ??= []) : (grid[r - 2] ??= []);
      cells.forEach((v, j) => { target[c0 + j] = v; });
    }
    if (r0 === 1 && !(part.values ?? []).length) header ??= [];
  }
  const missing = p.cols.filter((c) => !covered.has(c));
  if (missing.length) stop(`No values for ${missing.map((c) => `column ${col(c)} (${t.headers[c]})`).join(', ')} of the ${t.title} tab. Read every range ${p.hint ?? `sheet.mjs ranges ${key} prints`}.`);
  const fill = (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? '');
  return { header: header && fill(header), rows: Array.from({ length: grid.length }, (_, i) => fill(grid[i])) };
}
// The record a sheet row belongs to, or a problem line when its Record ID is missing or points at another posting.
function record(r, i, idCol, problems) {
  const [company = '', role = ''] = r, id = r[idCol] ?? '';
  const where = `row ${i + 2} (${company}, ${role})`;
  if (!id) { problems.push(`${where}: no Record ID, so it isn't a workspace record. Skipped.`); return null; }
  const path = join(root, 'applications', id, 'posting.md');
  if (!existsSync(path)) { problems.push(`${where}: no record at applications/${id}. Skipped.`); return null; }
  const { data } = readFrontmatter(path);
  if (data.company !== company || data.role !== role) {
    problems.push(`${where}: its Record ID points at ${data.company}, ${data.role}. The rows may have been sorted without the Record ID column. Skipped.`);
    return null;
  }
  return { id, path, data };
}

// What the last sync wrote, by Record ID (and employer name). A sheet cell that still holds it isn't an edit, even
// when the workspace has moved on since. With no record yet, the pulls compare with the workspace as it is.
// The record also holds a fingerprint of each generated tab's rows as the sheet last confirmed them, so a sync writes
// only the tabs whose rows have changed since (changed), and the tabs a sync set out to rewrite until its read-back
// confirms them (pending).
const SNAPSHOT = join(root, 'applications', 'data', 'sheet-sync.json');
const snapshot = () => (existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : null);
const saveSnapshot = (snap) => { mkdirSync(dirname(SNAPSHOT), { recursive: true }); writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 1) + '\n'); };
// The generated tabs' headers. A record made for other headers says nothing about this layout's rows.
const LAYOUT = createHash('sha256').update(JSON.stringify(GENERATED.map((k) => TABS[k].headers))).digest('hex').slice(0, 12);
// Stats' Updated row holds the tracker's date, which moves every day, so it's left out of the comparison: the tab is
// rewritten when its numbers change, and its Updated date shows the day they last did.
const comparable = (key, rs) => (key === 'stats' ? rs.filter((r) => !(r[0] === 'Summary' && r[1] === 'Updated')) : rs);
const digest = (key, rs) => createHash('sha256').update(JSON.stringify(comparable(key, rs))).digest('hex').slice(0, 16);
// A tab the next sync rewrites whatever its rows: a pull that skipped rows or was refused, a sheet holding a different
// number of rows than the last sync wrote, or a tab just added or brought up to date. Rewriting puts the sheet back in
// step with the workspace. With no record yet, every tab is rewritten anyway.
function markPending(keys) {
  const snap = snapshot();
  if (!snap) return;
  snap.pending = { ...snap.pending };
  for (const k of keys) snap.pending[k] ??= 'rewrite';
  saveSnapshot(snap);
}
// After a pull: the rows it read against the count the last sync wrote, and whether it skipped any.
function checkRead(key, n, problems) {
  const wrote = snapshot()?.tabs?.[key]?.rows;
  if (wrote !== undefined && wrote !== n) console.log(`  The ${TABS[key].title} tab has ${n} rows, and the last sync wrote ${wrote}, so the next sync rewrites it.`);
  if (problems.length || (wrote !== undefined && wrote !== n)) markPending([key]);
}

// ---- Patching only the cells that changed ----
// The record keeps each tab's rows as the sheet last confirmed them (written), so a sync can send only the cells that
// differ instead of the whole tab. A patch writes by position, so it goes ahead only when the sheet's rows are still in
// the order the last sync wrote them: each tab's check columns (the Record ID, the company, or the row's labels) are
// read first and compared. A sort in the sheet, or rows added or removed by hand, falls back to a rewrite.
const CHECK = { shortlist: [TABS.shortlist.headers.length - 1], history: [TABS.history.headers.length - 1], employers: [0], scoutlog: [0, 1, 2], stats: [0, 1] };
// The tabs whose check columns the pulls already read, so a patch reuses those files and costs no extra read.
const PULLED = ['shortlist', 'history', 'employers'];
const checkRanges = (key) => { const cs = CHECK[key], t = TABS[key]; return [a1(t, cs[0], cs.at(-1), 2, R)]; };
// A cell as the sheet shows it: dates without their apostrophe, a link as its label, numbers as text.
const shown = (v) => { if (typeof v === 'number') return String(v); const s = String(v ?? ''); const m = s.match(/^=HYPERLINK\(".*","(.*)"\)$/); return m ? m[1].replace(/""/g, '"') : s.replace(/^'/, ''); };
// What a cell costs to move through the connector, in characters: its text, quoting, and a comma. Each call (a write or
// a read, with its reply) costs about OVERHEAD more. A rewrite prints the rows, sends them, and reads them back; so does a
// patch, for its cells only.
const OVERHEAD = 300;
const cost = (v) => String(v ?? '').length + 3;
const boxCost = (rs, b) => { let s = 0; for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) s += cost(rs[r]?.[c]); return 3 * s + 2 * OVERHEAD; };
// The blocks of cells to write: runs of rows with a change, each spanning the columns that changed in it, merged with the
// next block when one write is cheaper than two. Rows past the new end are cleared, not written.
function diffBlocks(old, cur) {
  const groups = [];
  let count = 0;
  for (let r = 0; r < cur.length; r++) {
    const cs = cur[r].map((v, c) => (JSON.stringify(v) === JSON.stringify(old[r]?.[c] ?? '') ? -1 : c)).filter((c) => c >= 0);
    if (!cs.length) continue;
    count += cs.length;
    const last = groups.at(-1), b = { r0: r, r1: r, c0: Math.min(...cs), c1: Math.max(...cs) };
    if (last && last.r1 === r - 1) Object.assign(last, { r1: r, c0: Math.min(last.c0, b.c0), c1: Math.max(last.c1, b.c1) });
    else groups.push(b);
  }
  const blocks = [];
  for (const g of groups) {
    const last = blocks.at(-1), m = last && { r0: last.r0, r1: g.r1, c0: Math.min(last.c0, g.c0), c1: Math.max(last.c1, g.c1) };
    if (m && boxCost(cur, m) < boxCost(cur, last) + boxCost(cur, g)) blocks[blocks.length - 1] = m;
    else blocks.push(g);
  }
  return { blocks, cells: count, tail: old.length > cur.length ? { r0: cur.length, r1: old.length - 1 } : null };
}
// Patch or rewrite: a patch only when the record holds the rows the sheet shows, there's something left to write, and the
// patch costs less than rewriting the tab (a moved row near the top changes every row below it).
function planTab(key, rec, rs, why) {
  if (!rec?.written || !rs.length || !rec.written.length || !['rows changed', 'count'].includes(why)) return { mode: 'rewrite' };
  const d = diffBlocks(rec.written, rs), t = TABS[key];
  let patch = d.blocks.reduce((s, b) => s + boxCost(rs, b), 0) + (d.tail ? OVERHEAD : 0);
  if (!PULLED.includes(key)) patch += OVERHEAD + rec.written.reduce((s, r) => s + CHECK[key].reduce((x, c) => x + cost(r[c]), 0), 0);
  const all = { r0: 0, r1: rs.length - 1, c0: 0, c1: t.headers.length - 1 };
  return patch < boxCost(rs, all) + OVERHEAD ? { mode: 'patch', ...d } : { mode: 'rewrite' };
}

// Which tabs to patch, or clear, write, and read back. A tab counts as changed when there's no record yet, when the record
// was made for an earlier layout or another sheet, when the last sync set out to write it and never confirmed it, when
// it's named (or --all), or when its rows differ from the record. Rows are compared as written, so a rolling window that
// drops a row because the date moved counts too. Only a tab whose rows simply differ can be patched: the others are
// rewritten. The changed tabs are recorded as pending until synced confirms them, and the plan for patch to follow.
function changed(all, named) {
  const snap = snapshot(), id = String(get('sheet.spreadsheet_id', '') || '');
  for (const k of named) if (!GENERATED.includes(tabKey(k))) throw new Error(`changed: unknown tab "${k}" (${GENERATED.join(', ')})`);
  const whyAll = !snap || (!snap.tabs && !snap.at) ? 'no sync recorded yet' : !snap.tabs || snap.layout !== LAYOUT ? 'the last sync was recorded for an earlier layout'
    : snap.sheet && id && snap.sheet !== id ? 'the last sync was recorded for another sheet' : '';
  const pending = {}, plan = {}, out = [], dropdowns = [], checks = [], n = (k) => `${k} row${k === 1 ? '' : 's'}`, s = (k) => (k === 1 ? '' : 's');
  for (const key of GENERATED) {
    const t = TABS[key], rs = rows(key), h = digest(key, rs), rec = snap?.tabs?.[key];
    const count = rec && rec.rows !== rs.length;
    const why = whyAll || (all || named.map(tabKey).includes(key) ? 'asked for' : snap.pending?.[key] === 'rewrite' ? 'out of step with the workspace' : snap.pending?.[key] ? "the last sync that set out to write it didn't confirm it"
      : rec?.hash !== h ? (count ? `${n(rec.rows)} then, ${rs.length} now` : 'rows changed') : '');
    if (!why) { out.push(`${t.title.padEnd(10)} unchanged (${n(rs.length)})`); continue; }
    pending[key] = h;
    const p = planTab(key, rec, rs, why === 'rows changed' ? why : count && why.endsWith(' now') ? 'count' : why);
    plan[key] = p.mode;
    if (p.mode === 'patch') {
      const ranges = p.blocks.length;
      if (!PULLED.includes(key)) checks.push(...checkRanges(key));
      out.push(`${t.title.padEnd(10)} changed (${why}): patch ${p.cells} cell${s(p.cells)} in ${ranges} range${s(ranges)}${p.tail ? `, clear ${n(p.tail.r1 - p.tail.r0 + 1)} at the end` : ''}`
        + (PULLED.includes(key) ? '' : `, after checking the row order with ${checkRanges(key)[0]}`));
      continue;
    }
    if (key === 'shortlist' || key === 'employers') dropdowns.push(key);
    out.push(`${t.title.padEnd(10)} changed (${why}): clear ${dataRange(t)}, ${rs.length ? `write ${n(rs.length)} at ${a1(t, 0, 0, 2, 2).replace(/:.*/, '')}` : 'nothing to write'}${rs.length ? `, read back ${dataRange(t, rs.length)}` : ''}`);
  }
  saveSnapshot({ ...(snap ?? {}), pending, plan });
  for (const l of out) console.log(l);
  const rewrites = Object.values(plan).filter((m) => m === 'rewrite').length, patches = Object.values(plan).length - rewrites;
  if (!rewrites && !patches) return console.log('Nothing changed since the last sync: nothing to clear, write, or read back.');
  const lines = [];
  if (patches) lines.push(`${patches} tab${s(patches)} to patch: run sheet.mjs patch with the files the pulls just read${checks.length ? ` and a read of ${checks.join(' and ')}` : ''}, and send what it prints.`);
  if (rewrites) lines.push(`${rewrites} tab${s(rewrites)} to rewrite.${dropdowns.length ? ` Then send sheet.mjs dropdown ${dropdowns.join(' ')}.` : ' No dropdowns to reset.'}`);
  console.log(`${lines.join(' ')} Run sheet.mjs synced once the read-back matches.`);
}

// The patch for each tab changed planned, from the sheet's check columns (the pulls' files, and a read of each other
// patched tab's check range). JSON for the skill to send: clear (ranges for batch_clear_values), write (one update_values
// each), readback (one get_values each, with the values to expect as the sheet shows them; trailing empty cells come back
// missing), dropdown (the tabs to send sheet.mjs dropdown for, because their row count changed), and rewrite (tabs whose
// rows were reordered in the sheet, to clear, write in full, and read back instead).
function patch(files) {
  const snap = snapshot(), plan = snap?.plan ?? {}, out = { clear: [], write: [], readback: [], dropdown: [], rewrite: [] };
  const keys = GENERATED.filter((k) => plan[k] === 'patch');
  if (!keys.length) { console.error('Nothing to patch: run sheet.mjs changed first, and rewrite the tabs it lists.'); process.exit(1); }
  const parts = files.flatMap((file) => flatParts(JSON.parse(readFileSync(file, 'utf8'))).map((part) => [file, part]));
  for (const key of keys) {
    const t = TABS[key], old = snap.tabs[key].written, rs = rows(key);
    const mine = parts.filter(([, part]) => tabOfRange(part.range) === t.title);
    const hint = `${checkRanges(key)[0]}${PULLED.includes(key) ? ` (the ${t.title} pull reads it)` : ''}`;
    // No file for a tab stops here, naming the range to read, so a missing read can never pass for a sheet in order.
    const sheet = readTab([], key, { cols: CHECK[key], hint }, mine).rows;
    const inOrder = sheet.length === old.length && old.every((r, i) => CHECK[key].every((c) => shown(r[c]) === String(sheet[i][c] ?? '')));
    if (!inOrder) {
      out.rewrite.push({ tab: t.title, why: sheet.length === old.length ? "its rows aren't in the order the last sync wrote them (sorted in the sheet?)" : `it has ${sheet.length} rows, and the last sync wrote ${old.length}`,
        clear: dataRange(t), write: `sheet.mjs rows ${key} at ${a1(t, 0, 0, 2, 2).replace(/:.*/, '')}`, readback: dataRange(t, rs.length) });
      if (key === 'shortlist' || key === 'employers') out.dropdown.push(key);
      continue;
    }
    const d = diffBlocks(old, rs);
    for (const b of d.blocks) {
      const range = a1(t, b.c0, b.c1, b.r0 + 2, b.r1 + 2), box = rs.slice(b.r0, b.r1 + 1).map((r) => r.slice(b.c0, b.c1 + 1));
      out.write.push({ range, values: box });
      out.readback.push({ range, expect: box.map((r) => r.map(shown)) });
    }
    if (d.tail) out.clear.push(a1(t, 0, t.headers.length - 1, d.tail.r0 + 2, d.tail.r1 + 2));
    if (old.length !== rs.length && (key === 'shortlist' || key === 'employers')) out.dropdown.push(key);
  }
  console.log(JSON.stringify(out));
}

function synced() {
  const old = snapshot() ?? {}, idOf = (r) => r.at(-1), current = old.layout === LAYOUT;
  // A first sync, or one recorded before tabs were tracked, rewrote every tab. After that, only what changed set pending.
  const full = old.pending === undefined && !(old.tabs && current);
  const tabs = current ? { ...old.tabs } : {}, pending = old.pending ?? {}, still = {}, data = {};
  for (const key of GENERATED) {
    data[key] = rows(key);
    const h = digest(key, data[key]);
    // written: the rows as the sheet now holds them, the base the next patch is worked out from. A tab left unchanged
    // keeps its old copy, since Stats' Updated date can move without the tab being written.
    if (full || (key in pending ? pending[key] === h : tabs[key]?.hash === h)) {
      tabs[key] = { hash: h, rows: data[key].length, written: !full && !(key in pending) && tabs[key]?.written ? tabs[key].written : data[key] };
    }
    // Written from rows that have changed again since: the next sync writes it once more.
    else if (key in pending) still[key] = pending[key];
  }
  const ok = (key) => tabs[key]?.hash === digest(key, data[key]);
  const snap = {
    at: today, sheet: String(get('sheet.spreadsheet_id', '') || ''), layout: LAYOUT, tabs, ...(Object.keys(still).length ? { pending: still } : {}),
    shortlist: ok('shortlist') ? Object.fromEntries(data.shortlist.map((r) => [idOf(r), r[2]])) : old.shortlist,
    history: ok('history') ? Object.fromEntries(data.history.map((r) => [idOf(r), r[4]])) : old.history,
    employers: ok('employers') ? Object.fromEntries(data.employers.map((r) => [norm(r[0]), [r[1], r[2]]])) : old.employers,
  };
  saveSnapshot(snap);
  console.log(`Recorded this sync: ${data.shortlist.length} Shortlist, ${data.history.length} History, and ${data.employers.length} Employers rows.`
    + (Object.keys(still).length ? `\nThe workspace changed after sheet.mjs changed ran, so the next sync rewrites ${Object.keys(still).map((k) => TABS[k].title).join(', ')} again.` : ''));
}

// The Shortlist's header row decides whether its columns can be trusted: a row read from an older layout would put a
// status on the wrong posting, so pull reads nothing until the header row is this version's.
const cells = (row) => { const c = (row || []).map((x) => String(x ?? '').trim()); while (c.length && !c.at(-1)) c.pop(); return c; };
const sameRow = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function shortlistLayout(header) {
  const h = cells(header);
  if (sameRow(h, TABS.shortlist.headers)) return 'current';
  if (sameRow(h, SHORTLIST_BEFORE_NEXT)) return 'before-next';
  return h[0] === 'Company' ? 'unknown' : 'no-header';
}

function pull(files, apply) {
  const changes = [], problems = [], snap = snapshot()?.shortlist;
  const stop = (msg) => { console.error(`${msg} Nothing was logged.`); process.exit(1); };
  // The header row decides before any column is trusted (a bare grid's first row is its header row).
  const { header, rows: sheetRows } = readTab(files, 'shortlist');
  const layout = shortlistLayout(header);
  if (layout === 'no-header') stop(`The values don't start with the Shortlist's header row. Read the ranges sheet.mjs ranges shortlist prints (${pullRanges('shortlist').join(', ')}), header row included, and run pull again.`);
  if (layout === 'before-next') stop('The Shortlist has the layout from before the Next column, so its columns don\'t line up with this version\'s. Bring the sheet up to date first with sheet.mjs upgrade (Bringing an Existing Sheet Up to Date, in the sheet skill\'s layout.md).');
  if (layout === 'unknown') stop(`The Shortlist's header row isn't the layout this version writes (${TABS.shortlist.headers.join(', ')}). Compare it with sheet.mjs headers shortlist and fix the sheet first.`);
  for (const [i, r] of sheetRows.entries()) {
    const [company = '', role = '', status = ''] = r;
    if (!company && !role && !status) continue;
    const rec = record(r, i, TABS.shortlist.headers.length - 1, problems);
    if (!rec) continue;
    const { id, path, data } = rec;
    const where = `row ${i + 2} (${company}, ${role})`;
    const current = (data.events || []).map(parseEvent).at(-1)?.stage ?? 'shortlisted';
    const next = String(status).trim();
    if (next === current || (snap && id in snap && snap[id] === next)) continue;
    if (!STAGES.includes(next)) { problems.push(`${where}: "${next}" isn't a stage. Skipped.`); continue; }
    const back = STAGES.indexOf(next) < STAGES.indexOf(current) && LIVE.includes(next);
    changes.push(`${company}, ${role}: ${current} -> ${next}${back ? ' (moves it back a stage)' : ''}`);
    if (!apply) continue;
    appendEvent(path, `${today} | ${next} | ${sheetNote(next)}`, today);
    // A pass keeps posting.md for the stats and drops the job description copy, as when the user passes in chat.
    if (next === 'passed' && existsSync(join(root, 'applications', id, 'jd.md'))) rmSync(join(root, 'applications', id, 'jd.md'));
  }
  console.log(changes.length ? `${apply ? 'Logged' : 'Would log'} ${changes.length} status change(s) from the sheet:\n${changes.map((c) => `  ${c}`).join('\n')}`
    : 'No status changes in the sheet.');
  for (const p of problems) console.log(`  [skipped] ${p}`);
  checkRead('shortlist', sheetRows.filter((r) => r.some((c) => String(c ?? '').trim())).length, problems);
  if (changes.length && !apply) console.log('Run again with --apply to write them, then run tracker.mjs and sync.');
}

// History's Reason column is the user's to edit: a typed reason replaces the note on the posting's last event, which is
// the ending that put it in History. Optional, for tuning the scout's screen.
function pullHistory(files, apply) {
  const changes = [], problems = [], snap = snapshot()?.history, sheetRows = readTab(files, 'history').rows;
  for (const [i, r] of sheetRows.entries()) {
    const [company = '', role = '', outcome = '', , reason = ''] = r;
    if (!company && !role) continue;
    const rec = record(r, i, TABS.history.headers.length - 1, problems);
    if (!rec) continue;
    const last = (rec.data.events || []).map(parseEvent).at(-1);
    if (!last || last.stage !== String(outcome).trim()) { problems.push(`row ${i + 2} (${company}, ${role}): its outcome isn't the record's latest stage. Skipped.`); continue; }
    const next = String(reason).trim();
    if (next === last.note || (snap && rec.id in snap && snap[rec.id] === next)) continue;
    changes.push(`${company}, ${role}: "${last.note}" -> "${next}"`);
    if (apply) setLastEventNote(rec.path, next, today);
  }
  console.log(changes.length ? `${apply ? 'Saved' : 'Would save'} ${changes.length} reason(s) from the History tab:\n${changes.map((c) => `  ${c}`).join('\n')}`
    : 'No reason changes in the History tab.');
  for (const p of problems) console.log(`  [skipped] ${p}`);
  checkRead('history', sheetRows.filter((r) => r[0] || r[1]).length, problems);
  if (changes.length && !apply) console.log('Run again with --apply to write them, then run tracker.mjs and sync.');
}

// ---- Employer edits made in the sheet ----
// The Employers tab is the watchlist the user can edit. Matched to the watchlist by company name, so sorting is safe:
//   a new row                    added (manual until its feed is found; paused if its Status says so)
//   Domain changed               the employer's domain changes (a new domain is fine)
//   Status paused / watching     paused, or resumed with its feed as it was
//   Status not watched           taken off the watchlist (its research, if any, stays, and so does its row)
//   a row deleted                paused, or taken off the watchlist if it was already paused
// Research-only rows (not watched, and not on the watchlist) need nothing. More than a quarter of the list paused or removed
// at once is refused without --force, and so is an empty read, so a bad read can't wipe the watchlist.
function pullEmployers(files, apply, force) {
  const w = readWatchlist(), problems = [], sheet = new Map(), snap = snapshot()?.employers;
  if (w.missing) { console.log('No applications/watchlist.md in this workspace. Nothing to pull.'); return; }
  const sheetRows = readTab(files, 'employers').rows;
  for (const [i, r] of sheetRows.entries()) {
    const [name = '', domain = '', status = ''] = r.map((x) => String(x ?? '').trim());
    if (!name) continue;
    if (sheet.has(norm(name))) { problems.push(`row ${i + 2} (${name}): listed twice. Kept the first.`); continue; }
    // A row with a status that isn't one of the four is left exactly as it is (not treated as deleted).
    if (status && !EMPLOYER_STATUSES.includes(status)) { problems.push(`row ${i + 2} (${name}): "${status}" isn't a status. Left as it was.`); sheet.set(norm(name), { name, keep: true }); continue; }
    // Unchanged since the last sync: not an edit, even if the watchlist has changed since.
    if (snap?.[norm(name)] && snap[norm(name)][0] === domain && snap[norm(name)][1] === (status || 'watching')) { sheet.set(norm(name), { name, keep: true }); continue; }
    sheet.set(norm(name), { name, domain, status: status || 'watching', row: i + 2 });
  }
  if (!sheet.size) { console.log('The Employers tab read back empty, so nothing was changed. Check the range and try again.'); markPending(['employers']); return; }

  const adds = [], resumes = [], pauses = [], removes = [], moves = [];
  for (const { name, domain, status, row, keep } of sheet.values()) {
    if (keep) continue;
    const r = find(w, name);
    if (!r) {
      if (status !== 'not watched') adds.push({ company: name, paused: status === 'paused', source: 'manual', board: '', why: `Added by ${NAME} in the sheet ${today}`, domain });
      continue;
    }
    if (r.domain !== domain && status !== 'not watched') moves.push([r, domain]);
    if (status === 'not watched') removes.push(r);
    else if (status === 'paused' && !r.paused) pauses.push(r);
    else if (status !== 'paused' && r.paused) resumes.push(r);
    else if (status === 'watching' && r.source === 'manual') problems.push(`row ${row} (${name}): no feed yet, so it stays manual until one is found.`);
    else if (status === 'manual' && r.source !== 'manual' && !r.paused) problems.push(`row ${row} (${name}): it has a ${r.source} feed, so it stays watching. Pause it to stop it.`);
  }
  // A deleted row: only an employer the last sync wrote can have been deleted. One added since isn't in the sheet yet.
  for (const r of w.rows) if (!sheet.has(norm(r.company)) && (!snap || norm(r.company) in snap)) (r.paused ? removes : pauses).push(r);

  const out = [
    ...adds.map((r) => `  add     ${r.company}${r.domain ? ` (${r.domain})` : ''}${r.paused ? ', paused' : ''}: manual until its feed is found`),
    ...moves.map(([r, d]) => `  domain  ${r.company}: ${r.domain || '(none)'} -> ${d || '(none)'}`),
    ...resumes.map((r) => `  resume  ${r.company}`),
    ...pauses.map((r) => `  pause   ${r.company}${sheet.has(norm(r.company)) ? '' : ' (row deleted)'}`),
    ...removes.map((r) => `  remove  ${r.company}${sheet.has(norm(r.company)) ? ' (set to not watched)' : ' (paused row deleted)'}`)];
  console.log(out.length ? `${apply ? 'Applied' : 'Would apply'} ${out.length} change(s) from the Employers tab:\n${out.join('\n')}` : 'No changes in the Employers tab.');
  for (const p of problems) console.log(`  [skipped] ${p}`);
  const dropped = pauses.length + removes.length, limit = Math.max(3, Math.floor(w.rows.length / 4));
  checkRead('employers', sheetRows.filter((r) => String(r[0] ?? '').trim()).length, dropped > limit && !force ? [...problems, 'refused'] : problems);
  if (dropped > limit && !force) return console.log(`That pauses or removes ${dropped} of ${w.rows.length} employers, more than the ${limit} a sync allows without --force. Nothing was written. Confirm with the user first.`);
  if (!out.length) return;
  if (!apply) return console.log('Run again with --apply to write them, then find a feed for each added employer.');
  for (const [r, d] of moves) r.domain = d;
  for (const r of resumes) r.paused = false;
  for (const r of pauses) { r.paused = true; r.why = `${r.why.replace(/\s*\(paused .*\)$/, '')} (paused by ${NAME} in the sheet ${today})`.trim(); }
  w.rows = w.rows.filter((r) => !removes.includes(r)).concat(adds);
  writeWatchlist(w);
  if (adds.length) console.log(`Next: find a feed for ${adds.map((r) => r.company).join(', ')} (discover.mjs board, then watchlist.mjs set).`);
}

// ---- Pruning old records ----
// A posting that ended more than HISTORY_DAYS ago without an application (passed, expired, and the like) leaves the
// workspace with the sheet: its folder is deleted, and one line in applications/data/archive.csv keeps it in the stats.
// Anything that reached an application is never pruned. A company folder left empty is removed too; company.md stays.
export const ARCHIVE_COLS = ['id', 'company', 'role', 'source', 'role_fit', 'preference_fit', 'why', 'posting', 'shortlisted', 'outcome', 'ended', 'reason', 'archived'];
function prune(apply) {
  const dir = join(root, 'applications'), cutoff = daysAgo(HISTORY_DAYS), out = [];
  for (const c of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (!c.isDirectory() || c.name === 'data') continue;
    for (const p of readdirSync(join(dir, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = join(dir, c.name, p.name, 'posting.md');
      if (!existsSync(file)) continue;
      const { data } = readFrontmatter(file);
      const events = (data.events || []).map(parseEvent).sort((a, b) => a.date.localeCompare(b.date));
      const last = events.at(-1);
      if (!last || !ENDED.includes(last.stage) || last.stage === 'accepted' || last.date >= cutoff) continue;
      if (events.some((e) => e.stage === 'applied') || data.frozen) continue;
      out.push({ id: `${c.name}/${p.name}`, company: data.company, role: data.role, source: data.source, role_fit: data.role_fit ?? '', preference_fit: data.preference_fit ?? '', why: data.why,
        posting: data.posting, shortlisted: events.find((e) => e.stage === 'shortlisted')?.date ?? '', outcome: last.stage, ended: last.date, reason: last.note, archived: today });
    }
  }
  console.log(out.length ? `${apply ? 'Archived' : 'Would archive'} ${out.length} posting(s) that ended before ${cutoff} without an application:\n${out.map((r) => `  ${r.company}, ${r.role} (${r.outcome} ${r.ended})`).join('\n')}`
    : `Nothing to archive (no unapplied posting ended before ${cutoff}).`);
  if (!apply || !out.length) { if (out.length) console.log('Run again with --apply to archive them and delete their folders.'); return; }
  const file = join(dir, 'data', 'archive.csv');
  writeCsv(file, ARCHIVE_COLS, [...readCsv(file), ...out]);
  for (const r of out) {
    rmSync(join(dir, r.id), { recursive: true, force: true });
    const co = join(dir, r.id.split('/')[0]);
    if (existsSync(co) && !readdirSync(co).filter((f) => f !== '.DS_Store').length) rmSync(co, { recursive: true, force: true });
  }
}

// ---- formatting for a new sheet ----
const hex = (h) => { h = h.replace('#', ''); return { red: +(parseInt(h.slice(0, 2), 16) / 255).toFixed(3), green: +(parseInt(h.slice(2, 4), 16) / 255).toFixed(3), blue: +(parseInt(h.slice(4, 6), 16) / 255).toFixed(3) }; };
const PRIMARY = PALETTE.primary, ACCENT = PALETTE.accent;
const grid = (s, r0, r1, c0, c1) => ({ sheetId: s, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });
const GRADIENT = { minpoint: { type: 'NUMBER', value: '1', color: hex('#f3d3cf') }, midpoint: { type: 'NUMBER', value: '3', color: hex('#fbf0d4') }, maxpoint: { type: 'NUMBER', value: '5', color: hex('#d5ecdc') } };
const pill = (s, col, formula, bg, fg) => ({ addConditionalFormatRule: { index: 0, rule: { ranges: [grid(s, 1, R, col, col + 1)],
  booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: { backgroundColor: hex(bg), textFormat: { foregroundColor: hex(fg), bold: true } } } } } });
const anyOf = (col, xs) => { const C = String.fromCharCode(65 + col); return `=OR(${xs.map((x) => `$${C}2="${x}"`).join(',')})`; };

// The Shortlist's Status dropdown goes only on filled rows, so empty rows show no arrows. Every sync resets it to the
// current row count: clear it from the whole column, then set it on rows 2 to n+1.
// Dropdowns go on filled rows only, on every tab: the whole column is cleared first, then the list is set on rows 2 to
// n+1, where n is the number of rows this sync writes. Never pad with spare rows. Empty rows show no arrows, and a row the
// user types in gets its dropdown at the next sync (a blank Status on a new employer row means watching).
const dropdownOn = (t, c, n, values, strict) => [{ setDataValidation: { range: grid(t.id, 1, R, c, c + 1) } },
  ...(n && values.length ? [{ setDataValidation: { range: grid(t.id, 1, 1 + n, c, c + 1), rule: { condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) }, strict, showCustomUi: true } } }] : [])];
// Only for the tabs named (shortlist, employers), or both: a sync resets the dropdowns of the tabs it rewrote.
function dropdown(keys) {
  const want = keys.length ? keys.map(tabKey) : ['shortlist', 'employers'];
  for (const k of want) if (!['shortlist', 'employers'].includes(k)) throw new Error(`dropdown: "${k}" has no dropdowns (shortlist, employers)`);
  const q = [];
  if (want.includes('shortlist')) q.push(...dropdownOn(TABS.shortlist, TABS.shortlist.status, rows('shortlist').length, STAGES, true));
  if (want.includes('employers')) {
    const e = rows('employers'), domains = [...new Set(e.map((r) => r[1]).filter(Boolean))].sort();
    q.push(...dropdownOn(TABS.employers, TABS.employers.wstatus, e.length, EMPLOYER_STATUSES, true),
      // Domain isn't strict: typing a new domain makes one.
      ...dropdownOn(TABS.employers, 1, e.length, domains, false));
  }
  return q;
}

// The Shortlist's gray for endings, shown until the next sync moves the row to History.
const endingGray = () => { const t = TABS.shortlist; return pill(t.id, t.status, anyOf(t.status, ENDED.filter((x) => x !== 'accepted')), '#ececec', '#6b6b6b'); };
const muted = (s, i) => ({ repeatCell: { range: grid(s, 1, R, i, i + 1), cell: { userEnteredFormat: { textFormat: { foregroundColor: hex('#8a94a3'), fontSize: 9 } } }, fields: 'userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.fontSize' } });

function format(t, tabColor) {
  const s = t.id, n = t.headers.length, q = [];
  q.push({ repeatCell: { range: grid(s, 0, R, 0, n), cell: { userEnteredFormat: { textFormat: { fontFamily: 'Arial', fontSize: 10 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy' } });
  q.push({ repeatCell: { range: grid(s, 0, 1, 0, n), cell: { userEnteredFormat: { backgroundColor: hex(PRIMARY), textFormat: { foregroundColor: hex('#ffffff'), bold: true, fontFamily: 'Arial', fontSize: 10 }, verticalAlignment: 'MIDDLE', horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment,userEnteredFormat.wrapStrategy' } });
  q.push({ updateBorders: { range: grid(s, 0, 1, 0, n), bottom: { style: 'SOLID_THICK', color: hex(ACCENT) } } });
  for (const c of t.center) q.push({ repeatCell: { range: grid(s, 0, R, c, c + 1), cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
  for (const c of t.wrap) q.push({ repeatCell: { range: grid(s, 1, R, c, c + 1), cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
  q.push({ repeatCell: { range: grid(s, 1, R, 0, 1), cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: hex(PRIMARY) } } }, fields: 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor' } });
  t.widths.forEach((w, i) => q.push({ updateDimensionProperties: { range: { sheetId: s, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } }));
  // Only the header row has a fixed height. Data rows keep automatic height so wrapped text is never cut off.
  q.push({ updateDimensionProperties: { range: { sheetId: s, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  q.push({ addBanding: { bandedRange: { range: grid(s, 0, R, 0, n), rowProperties: { headerColor: hex(PRIMARY), firstBandColor: hex('#ffffff'), secondBandColor: hex('#f3f6fa') } } } });
  q.push({ updateSheetProperties: { properties: { sheetId: s, gridProperties: { frozenRowCount: 1, frozenColumnCount: 0, hideGridlines: true }, tabColorStyle: { rgbColor: hex(tabColor) } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,tabColorStyle' } });
  q.push({ updateBorders: { range: grid(s, 1, R, 0, n), innerHorizontal: { style: 'SOLID', color: hex('#e3e8ef') }, bottom: { style: 'SOLID', color: hex('#e3e8ef') } } });
  for (const c of t.scores || []) q.push({ addConditionalFormatRule: { index: 0, rule: { ranges: [grid(s, 1, R, c, c + 1)], gradientRule: GRADIENT } } });
  if (t.status !== undefined) {
    q.push(pill(s, t.status, anyOf(t.status, ['shortlisted']), '#faf1dc', '#7a5a12'));
    q.push(pill(s, t.status, anyOf(t.status, ['interested', 'conversation']), '#dff3f1', '#0f6b62'));
    q.push(pill(s, t.status, anyOf(t.status, ['applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final']), '#e1ecf8', '#1d5c96'));
    q.push(pill(s, t.status, anyOf(t.status, ['offer', 'accepted']), '#dff1e4', '#1e6b34'));
  }
  if (t.wstatus !== undefined) {
    q.push(pill(s, t.wstatus, anyOf(t.wstatus, ['watching']), '#dff1e4', '#1e6b34'));
    q.push(pill(s, t.wstatus, anyOf(t.wstatus, ['manual']), '#faf1dc', '#7a5a12'));
    q.push(pill(s, t.wstatus, anyOf(t.wstatus, ['paused', 'not watched']), '#ececec', '#6b6b6b'));
  }
  if (t.call !== undefined) {
    q.push(pill(s, t.call, anyOf(t.call, ['shortlisted']), '#faf1dc', '#7a5a12'));
    q.push(pill(s, t.call, anyOf(t.call, ['held']), '#dff3f1', '#0f6b62'));
    q.push(pill(s, t.call, anyOf(t.call, ['new']), '#e1ecf8', '#1d5c96'));
    q.push(pill(s, t.call, anyOf(t.call, ['dropped']), '#ececec', '#6b6b6b'));
  }
  if (t.outcome !== undefined) {
    const C = String.fromCharCode(65 + t.outcome);
    q.push(pill(s, t.outcome, `=AND($${C}2<>"",$${C}2<>"accepted")`, '#ececec', '#6b6b6b'));
    q.push(pill(s, t.outcome, `=$${C}2="accepted"`, '#dff1e4', '#1e6b34'));
  }
  for (const c of t.muted || []) q.push(muted(s, c));
  for (const c of t.dates || []) q.push({ repeatCell: { range: grid(s, 1, R, c, c + 1), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'mmm yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } });
  q.push(filter(t));
  return q;
}

// A filter over every column, Record ID included, so sorting or filtering in the sheet keeps each row's ID with it.
// Setting it again clears the user's filter choices, so the sync sends it only to a tab whose filter is missing or wrong.
const filter = (t) => ({ setBasicFilter: { filter: { range: grid(t.id, 0, R, 0, t.headers.length) } } });
const filters = (keys) => (keys.length ? keys : Object.keys(TABS)).map((k) => filter(TABS[tabKey(k)] ?? (() => { throw new Error(`unknown tab ${k}`); })()));

const COLORS = { shortlist: PRIMARY, scoutlog: '#4f7a9a', history: '#6b7785', stats: '#3d7a5c', employers: ACCENT, career: '#1d5c96' };

function setup() {
  // A new spreadsheet starts with one tab, sheetId 0. Rename it to Shortlist, then add the others in order.
  const q = [{ updateSheetProperties: { properties: { sheetId: 0, title: TABS.shortlist.title }, fields: 'title' } },
    { addSheet: { properties: { sheetId: 4, title: TABS.scoutlog.title, index: 1 } } },
    { addSheet: { properties: { sheetId: 2, title: TABS.history.title, index: 2 } } },
    { addSheet: { properties: { sheetId: 5, title: TABS.stats.title, index: 3 } } },
    { addSheet: { properties: { sheetId: 1, title: TABS.employers.title, index: 4 } } },
    { addSheet: { properties: { sheetId: 3, title: TABS.career.title, index: 5 } } }];
  for (const [k, t] of Object.entries(TABS)) q.push(...format(t, COLORS[k]));
  q.push(endingGray());
  return q;
}

// Brings an existing sheet's Shortlist up to this version's layout, from its header row. Inserting the Next column after
// Last event shifts every later column one to the right. The insert copies Last event's format into the new column and
// stretches neighboring conditional-format ranges, so the new column gets its own format, and the tab's conditional
// formats (the n rules it has now) are deleted and added again as setup makes them. The filter is set again over every
// column, which clears the user's filter choices once. Banding, the muted Record ID, and the Status dropdown move with
// their columns. The sync that follows rewrites every row.
function upgrade(file, rules) {
  const layout = shortlistLayout(readGrid(file)[0]);
  if (layout === 'current') { console.error('The Shortlist is already up to date. Nothing to send.'); return []; }
  if (layout !== 'before-next') throw new Error(`The header row in ${file} isn't a Shortlist layout this version knows how to bring up to date. Compare it with sheet.mjs headers shortlist.`);
  if (rules === undefined || !/^\d+$/.test(String(rules))) throw new Error('Pass --rules <n>: how many conditional format rules the Shortlist has now (get_spreadsheet, fields sheets(properties.sheetId,conditionalFormats)).');
  const t = TABS.shortlist, c = t.next;
  // Every row moves a column, so the next sync rewrites the Shortlist in the new layout.
  markPending(['shortlist']);
  return [
    { insertDimension: { range: { sheetId: t.id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, inheritFromBefore: true } },
    { updateCells: { range: grid(t.id, 0, 1, c, c + 1), rows: [{ values: [{ userEnteredValue: { stringValue: t.headers[c] } }] }], fields: 'userEnteredValue' } },
    { repeatCell: { range: grid(t.id, 1, R, c, c + 1), cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.horizontalAlignment,userEnteredFormat.wrapStrategy' } },
    { updateDimensionProperties: { range: { sheetId: t.id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: t.widths[c] }, fields: 'pixelSize' } },
    ...Array.from({ length: +rules }, () => ({ deleteConditionalFormatRule: { sheetId: t.id, index: 0 } })),
    ...format(t, COLORS.shortlist).filter((q) => q.addConditionalFormatRule), endingGray(),
    filter(t),
  ];
}

// Adds one tab, formatted, to an existing sheet, for example one the user deleted by mistake.
function addTab(key, index) {
  const t = TABS[key];
  if (GENERATED.includes(key)) markPending([key]);
  return [{ addSheet: { properties: { sheetId: t.id, title: t.title, ...(index !== undefined ? { index: +index } : {}) } } }, ...format(t, COLORS[key])];
}

const careerFormula = (r) => `=LET(m, DATEDIF(C${r}, IF(D${r}="Present", TODAY(), D${r}), "M"), IF(INT(m/12)=0, "", INT(m/12)&"Y ")&MOD(m,12)&"M")`;

const [cmd, arg, flag, extra] = process.argv.slice(2);
if (cmd === 'rows') {
  console.log(JSON.stringify(rows(tabKey(arg))));
  // The connections module's refresh nudge, on stderr so the JSON stays clean.
  if (['shortlist', 'history'].includes(tabKey(arg)) && freshness()) console.error(`[connections] ${freshness()}`);
}
else if (cmd === 'ranges') {
  const keys = process.argv.slice(3).filter((a) => !a.startsWith('--')).map(tabKey), full = process.argv.includes('--full');
  for (const k of keys) if (!PULLS[k]) throw new Error(`ranges: "${k}" has no pull (shortlist, history, employers)`);
  const cmdOf = { shortlist: 'pull', history: 'pull-history', employers: 'pull-employers' };
  for (const k of keys.length ? keys : Object.keys(PULLS)) console.log(`${k} (${cmdOf[k]}): ${pullRanges(k, full).join(' ')}`);
}
else if (cmd === 'headers') console.log(JSON.stringify([TABS[tabKey(arg)]?.headers ?? (() => { throw new Error(`unknown tab ${arg}`); })()]));
else if (['pull', 'pull-history', 'pull-employers'].includes(cmd)) {
  const files = process.argv.slice(3).filter((a) => !a.startsWith('--')), apply = process.argv.includes('--apply');
  if (cmd === 'pull') pull(files, apply);
  else if (cmd === 'pull-history') pullHistory(files, apply);
  else pullEmployers(files, apply, process.argv.includes('--force'));
}
else if (cmd === 'changed') changed(process.argv.includes('--all'), process.argv.slice(3).filter((a) => !a.startsWith('--')));
else if (cmd === 'synced') synced();
else if (cmd === 'patch') patch(process.argv.slice(3));
else if (cmd === 'setup') console.log(JSON.stringify(setup()));
else if (cmd === 'upgrade') { const i = process.argv.indexOf('--rules'); console.log(JSON.stringify(upgrade(arg, i < 0 ? undefined : process.argv[i + 1]))); }
else if (cmd === 'prune') prune(arg === '--apply');
else if (cmd === 'add-tab') console.log(JSON.stringify(addTab(tabKey(arg), flag)));
else if (cmd === 'dropdown') console.log(JSON.stringify(dropdown(process.argv.slice(3))));
else if (cmd === 'filters') console.log(JSON.stringify(filters(process.argv.slice(3))));
else if (cmd === 'career-formula') console.log(careerFormula(+arg || 2));
else console.error('Usage: node <plugin>/tools/sheet.mjs rows <shortlist|scoutlog|history|stats|employers> | headers <tab> | ranges [tab...] [--full] | pull <values.json>... [--apply] | pull-employers <values.json>... [--apply] [--force] | pull-history <values.json>... [--apply] | changed [--all] [tab...] | patch <values.json>... | synced | upgrade <header.json> [--rules <n>] | prune [--apply] | dropdown [tab...] | filters [tab...] | setup | add-tab <tab> [index] | career-formula <row>');
