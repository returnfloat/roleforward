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
//   node <plugin>/tools/sheet.mjs pull <values.json> [--apply]
//                                                     reads Shortlist!A2:O values (as returned by get_values) and logs each
//                                                     Status the user changed with the dropdown as an event in that posting.md.
//                                                     Without --apply it only prints what it would do.
//   node <plugin>/tools/sheet.mjs pull-employers <values.json> [--apply] [--force]
//                                                     reads Employers!A2:O values and brings the user's edits (new rows, Domain,
//                                                     Status, deleted rows) into applications/watchlist.md
//   node <plugin>/tools/sheet.mjs pull-history <values.json> [--apply]
//                                                     reads History!A2:M values and saves each Reason the user typed as the
//                                                     note on that posting's ending event
//   node <plugin>/tools/sheet.mjs setup               batchUpdate requests that add and format every tab on a new sheet
//   node <plugin>/tools/sheet.mjs prune [--apply]     archives postings that ended more than sheet.history_days ago without an
//                                                     application: one line in data/archive.csv, and the folder is deleted
//   node <plugin>/tools/sheet.mjs dropdown          batchUpdate requests that put the dropdowns on filled rows only (the
//                                                     Shortlist's Status, and the Employers tab's Domain and Status)
//   node <plugin>/tools/sheet.mjs filters [tab...]   batchUpdate requests that put a sort-and-filter header over every column of
//                                                     the named tabs (all tabs if none). Resets any filter choices on them
//   node <plugin>/tools/sheet.mjs career-formula <row>   the Duration formula for a Career row
//
// Rows are written with update_values. Dates carry a leading apostrophe so Sheets keeps them as text, fit scores
// are numbers, and posting links are HYPERLINK formulas.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, writeCsv } from './csv.mjs';
import { readFrontmatter, appendEvent, setLastEventNote, parseEvent } from './frontmatter.mjs';
import { loadWorkspace, palette } from './workspace.mjs';
import { cell as contactsCell, freshness, norm } from './connections.mjs';
import { readWatchlist, writeWatchlist, find, statusOf } from './watchlist.mjs';
import { rankCompare } from './fit.mjs';

const { root, get } = loadWorkspace();
const PALETTE = palette(get);
const MATURITY = get('tracker.maturity_field', 'function_maturity');
const maturityLabel = MATURITY.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const LIVE = ['shortlisted', 'interested', 'applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final', 'offer'];
const ENDED = ['expired', 'passed', 'rejected', 'withdrawn', 'no-response', 'declined-offer', 'accepted'];
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
  shortlist: { id: 0, title: 'Shortlist', headers: ['Company', 'Role', 'Status', 'Role fit', 'Preference fit', 'Last event', 'Applied', 'Track', 'Resume', 'Source', 'Referral', "Why it's here", 'Contacts', 'Posting', 'Record ID'],
    widths: [240, 220, 140, 80, 100, 100, 100, 100, 120, 150, 80, 420, 300, 120, 200], center: [2, 3, 4, 5, 6, 10], wrap: [1, 11, 12], status: 2, scores: [3, 4], muted: [14] },
  scoutlog: { id: 4, title: 'Scout Log', headers: ['Company', 'Role', 'Location', 'Posted', 'First seen', 'Last seen', 'Scout call', 'Reason', 'Posting'],
    widths: [200, 280, 200, 100, 100, 100, 110, 420, 120], center: [3, 4, 5, 6], wrap: [1, 2, 7], call: 6 },
  history: { id: 2, title: 'History', headers: ['Company', 'Role', 'Outcome', 'Ended', 'Reason', 'Role fit', 'Preference fit', 'Applied', 'Source', 'Resume', 'Why it was here', 'Contacts', 'Posting', 'Record ID'],
    widths: [240, 220, 120, 100, 300, 80, 100, 100, 140, 120, 380, 300, 120, 200], center: [2, 3, 5, 6, 7], wrap: [1, 4, 10, 11], outcome: 2, scores: [5, 6], muted: [13] },
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
const ALIAS = { 'scout-log': 'scoutlog', watchlist: 'employers' };
export const EMPLOYER_STATUSES = ['watching', 'manual', 'paused', 'not watched'];
const tabKey = (t) => ALIAS[t] ?? t;

const text = (d) => (d ? `'${d}` : '');
const link = (url) => (url ? `=HYPERLINK("${url}","View posting")` : '');
const num = (v) => (v === '' || v === undefined ? '' : +v);

function rows(tab) {
  const apps = readCsv(join(root, 'applications', 'data', 'applications.csv'));
  if (tab === 'shortlist') {
    return apps.filter((r) => LIVE.includes(r.status))
      .sort(rankCompare)
      .map((r) => [r.company, r.role, r.status, num(r.role_fit), num(r.preference_fit), text(r.last_event), text(r.applied), r.track, r.resume, r.source, r.status === 'shortlisted' ? '' : r.referral, r.why, contactsCell(r.company), link(r.posting), r.id]);
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
      .map((r) => [r.company, r.role, r.status, text(r.last_event), lastNote(r.id), num(r.role_fit), num(r.preference_fit), text(r.applied), r.source, r.resume, r.why, contactsCell(r.company), link(r.posting), r.id]);
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

function pull(file, apply) {
  const changes = [], problems = [];
  for (const [i, r] of readGrid(file).entries()) {
    const [company = '', role = '', status = ''] = r;
    if (!company && !role && !status) continue;
    const rec = record(r, i, TABS.shortlist.headers.length - 1, problems);
    if (!rec) continue;
    const { id, path, data } = rec;
    const where = `row ${i + 2} (${company}, ${role})`;
    const current = (data.events || []).map(parseEvent).at(-1)?.stage ?? 'shortlisted';
    const next = String(status).trim();
    if (next === current) continue;
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
  if (changes.length && !apply) console.log('Run again with --apply to write them, then run tracker.mjs and sync.');
}

// History's Reason column is the user's to edit: a typed reason replaces the note on the posting's last event, which is
// the ending that put it in History. Optional, for tuning the scout's screen.
function pullHistory(file, apply) {
  const changes = [], problems = [];
  for (const [i, r] of readGrid(file).entries()) {
    const [company = '', role = '', outcome = '', , reason = ''] = r;
    if (!company && !role) continue;
    const rec = record(r, i, TABS.history.headers.length - 1, problems);
    if (!rec) continue;
    const last = (rec.data.events || []).map(parseEvent).at(-1);
    if (!last || last.stage !== String(outcome).trim()) { problems.push(`row ${i + 2} (${company}, ${role}): its outcome isn't the record's latest stage. Skipped.`); continue; }
    const next = String(reason).trim();
    if (next === last.note) continue;
    changes.push(`${company}, ${role}: "${last.note}" -> "${next}"`);
    if (apply) setLastEventNote(rec.path, next, today);
  }
  console.log(changes.length ? `${apply ? 'Saved' : 'Would save'} ${changes.length} reason(s) from the History tab:\n${changes.map((c) => `  ${c}`).join('\n')}`
    : 'No reason changes in the History tab.');
  for (const p of problems) console.log(`  [skipped] ${p}`);
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
function pullEmployers(file, apply, force) {
  const w = readWatchlist(), problems = [], sheet = new Map();
  if (w.missing) { console.log('No applications/watchlist.md in this workspace. Nothing to pull.'); return; }
  for (const [i, r] of readGrid(file).entries()) {
    const [name = '', domain = '', status = ''] = r.map((x) => String(x ?? '').trim());
    if (!name) continue;
    if (sheet.has(norm(name))) { problems.push(`row ${i + 2} (${name}): listed twice. Kept the first.`); continue; }
    // A row with a status that isn't one of the four is left exactly as it is (not treated as deleted).
    if (status && !EMPLOYER_STATUSES.includes(status)) { problems.push(`row ${i + 2} (${name}): "${status}" isn't a status. Left as it was.`); sheet.set(norm(name), { name, keep: true }); continue; }
    sheet.set(norm(name), { name, domain, status: status || 'watching', row: i + 2 });
  }
  if (!sheet.size) { console.log('The Employers tab read back empty, so nothing was changed. Check the range and try again.'); return; }

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
  for (const r of w.rows) if (!sheet.has(norm(r.company))) (r.paused ? removes : pauses).push(r);

  const out = [
    ...adds.map((r) => `  add     ${r.company}${r.domain ? ` (${r.domain})` : ''}${r.paused ? ', paused' : ''}: manual until its feed is found`),
    ...moves.map(([r, d]) => `  domain  ${r.company}: ${r.domain || '(none)'} -> ${d || '(none)'}`),
    ...resumes.map((r) => `  resume  ${r.company}`),
    ...pauses.map((r) => `  pause   ${r.company}${sheet.has(norm(r.company)) ? '' : ' (row deleted)'}`),
    ...removes.map((r) => `  remove  ${r.company}${sheet.has(norm(r.company)) ? ' (set to not watched)' : ' (paused row deleted)'}`)];
  console.log(out.length ? `${apply ? 'Applied' : 'Would apply'} ${out.length} change(s) from the Employers tab:\n${out.join('\n')}` : 'No changes in the Employers tab.');
  for (const p of problems) console.log(`  [skipped] ${p}`);
  const dropped = pauses.length + removes.length, limit = Math.max(3, Math.floor(w.rows.length / 4));
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
const R = 1000;
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
function dropdown() {
  const e = rows('employers'), domains = [...new Set(e.map((r) => r[1]).filter(Boolean))].sort();
  return [...dropdownOn(TABS.shortlist, TABS.shortlist.status, rows('shortlist').length, STAGES, true),
    ...dropdownOn(TABS.employers, TABS.employers.wstatus, e.length, EMPLOYER_STATUSES, true),
    // Domain isn't strict: typing a new domain makes one.
    ...dropdownOn(TABS.employers, 1, e.length, domains, false)];
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
    q.push(pill(s, t.status, anyOf(t.status, ['interested']), '#dff3f1', '#0f6b62'));
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

// Adds one tab, formatted, to an existing sheet, for example one the user deleted by mistake.
function addTab(key, index) {
  const t = TABS[key];
  return [{ addSheet: { properties: { sheetId: t.id, title: t.title, ...(index !== undefined ? { index: +index } : {}) } } }, ...format(t, COLORS[key])];
}

const careerFormula = (r) => `=LET(m, DATEDIF(C${r}, IF(D${r}="Present", TODAY(), D${r}), "M"), IF(INT(m/12)=0, "", INT(m/12)&"Y ")&MOD(m,12)&"M")`;

const [cmd, arg, flag, extra] = process.argv.slice(2);
if (cmd === 'rows') {
  console.log(JSON.stringify(rows(tabKey(arg))));
  // The connections module's refresh nudge, on stderr so the JSON stays clean.
  if (['shortlist', 'history'].includes(tabKey(arg)) && freshness()) console.error(`[connections] ${freshness()}`);
}
else if (cmd === 'headers') console.log(JSON.stringify([TABS[tabKey(arg)]?.headers ?? (() => { throw new Error(`unknown tab ${arg}`); })()]));
else if (cmd === 'pull') pull(arg, flag === '--apply');
else if (cmd === 'pull-employers') pullEmployers(arg, process.argv.includes('--apply'), process.argv.includes('--force'));
else if (cmd === 'pull-history') pullHistory(arg, flag === '--apply');
else if (cmd === 'setup') console.log(JSON.stringify(setup()));
else if (cmd === 'prune') prune(arg === '--apply');
else if (cmd === 'add-tab') console.log(JSON.stringify(addTab(tabKey(arg), flag)));
else if (cmd === 'dropdown') console.log(JSON.stringify(dropdown()));
else if (cmd === 'filters') console.log(JSON.stringify(filters(process.argv.slice(3))));
else if (cmd === 'career-formula') console.log(careerFormula(+arg || 2));
else console.error('Usage: node <plugin>/tools/sheet.mjs rows <shortlist|scoutlog|history|stats|employers> | headers <tab> | pull <values.json> [--apply] | pull-employers <values.json> [--apply] [--force] | pull-history <values.json> [--apply] | prune [--apply] | dropdown | filters [tab...] | setup | add-tab <tab> [index] | career-formula <row>');
