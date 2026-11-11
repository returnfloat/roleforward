// The Google Sheet's rows and the pulls that bring the user's sheet edits back (sheet.mjs). sheet.mjs never talks to
// Google itself, so everything here is local. It runs its command as it loads, so it's tested through the command line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWorkspace, daysAgo } from './fixture.mjs';

const fresh = () => { const ws = buildWorkspace(); ws.run('tracker'); return ws; };
const rows = (ws, tab) => JSON.parse(ws.run('sheet', ['rows', tab]));
const values = (ws, name, grid) => { ws.write(name, JSON.stringify({ values: grid })); return join(ws.root, name); };
// The Shortlist as pull reads it: the header row, then the rows.
const shortlistValues = (ws, name, grid) => values(ws, name, [...JSON.parse(ws.run('sheet', ['headers', 'shortlist'])), ...grid]);

test('Shortlist: live postings, the higher lower-score first, with the record ID last', () => {
  const ws = fresh();
  try {
    const r = rows(ws, 'shortlist');
    assert.deepEqual(r.map((x) => [x[0], x[2], x[3], x[4]]), [
      ['Employer A', 'shortlisted', 4, 5], ['Employer C', 'recruiter-screen', 5, 3.4], ['Employer B', 'interested', 3, 3.6]]);
    assert.equal(r[0][5], `'${daysAgo(3)}`, 'dates are text');
    assert.equal(r[0][6], '', 'no next action');
    assert.equal(r[0][11], '', 'referral stays blank while only shortlisted');
    assert.equal(r[1][11], 'yes');
    assert.match(r[0][14], /^=HYPERLINK\("https:\/\/example\.invalid\/jobs\/1001","View posting"\)$/);
    assert.equal(r[0][15], ws.folder('employer-a').replace('applications/', ''));
    assert.ok(r.every((x) => x.length === 16), 'one cell per column, A to P');
  } finally { ws.cleanup(); }
});

test('History: postings that ended, with their reason', () => {
  const ws = fresh();
  try {
    const r = rows(ws, 'history');
    assert.deepEqual(r.map((x) => [x[0], x[2], x[3], x[4]]), [['Employer D', 'passed', `'${daysAgo(11)}`, 'Example pass reason']]);
  } finally { ws.cleanup(); }
});

test('Employers: every watchlist employer with its status, plus scout counts', () => {
  const ws = fresh();
  try {
    const r = Object.fromEntries(rows(ws, 'employers').map((x) => [x[0], x]));
    assert.deepEqual(Object.keys(r).sort(), ['Employer A', 'Employer B', 'Employer C', 'Employer D', 'Employer E', 'Employer F']);
    assert.deepEqual([r['Employer A'][2], r['Employer E'][2], r['Employer F'][2]], ['watching', 'manual', 'paused']);
    assert.equal(r['Employer E'][4], '', 'a manual employer has no feed');
    assert.deepEqual(r['Employer C'].slice(5, 8), [3, 1, 1], 'screened, shortlisted, applied');
  } finally { ws.cleanup(); }
});

test('Stats: the tracker summary as rows', () => {
  const ws = fresh();
  try {
    const r = rows(ws, 'stats');
    assert.ok(r.some((x) => x[0] === 'Summary' && x[1] === 'Postings tracked' && x[2] === 4));
  } finally { ws.cleanup(); }
});

test('pull: a status changed in the sheet is logged only with --apply, and a pass drops jd.md', () => {
  const ws = fresh();
  try {
    const grid = rows(ws, 'shortlist').map((x) => (x[0] === 'Employer A' ? [x[0], x[1], 'passed', ...x.slice(3)] : x));
    const file = shortlistValues(ws, 'values.json', grid);
    assert.match(ws.run('sheet', ['pull', file]), /Would log 1 status change\(s\) from the sheet:\n  Employer A, Senior Data Engineer: shortlisted -> passed\n/);
    assert.doesNotMatch(ws.read(`${ws.folder('employer-a')}/posting.md`), /passed/);
    ws.run('sheet', ['pull', file, '--apply']);
    assert.match(ws.read(`${ws.folder('employer-a')}/posting.md`), /  - \d{4}-\d{2}-\d{2} \| passed \| Passed by Test in the sheet\n/);
    assert.equal(existsSync(join(ws.root, ws.folder('employer-a'), 'jd.md')), false);
  } finally { ws.cleanup(); }
});

test('pull skips a row whose record ID points at another posting, and a status that is not a stage', () => {
  const ws = fresh();
  try {
    const [a, c] = rows(ws, 'shortlist');
    const file = shortlistValues(ws, 'values.json', [[a[0], a[1], 'applied', ...a.slice(3, 15), c[15]], [c[0], c[1], 'maybe', ...c.slice(3)]]);
    const out = ws.run('sheet', ['pull', file, '--apply']);
    assert.match(out, /No status changes in the sheet\./);
    assert.match(out, /\[skipped\] row 2 \(Employer A, Senior Data Engineer\): its Record ID points at Employer C/);
    assert.match(out, /\[skipped\] row 3 \(Employer C, Lead Data Engineer\): "maybe" isn't a stage/);
  } finally { ws.cleanup(); }
});

test('pull-history: a typed reason replaces the ending note', () => {
  const ws = fresh();
  try {
    const grid = rows(ws, 'history').map((x) => [x[0], x[1], x[2], x[3], 'A clearer reason', ...x.slice(5)]);
    ws.run('sheet', ['pull-history', values(ws, 'history.json', grid), '--apply']);
    assert.match(ws.read(`${ws.folder('employer-d')}/posting.md`), /\| passed \| A clearer reason\n/);
  } finally { ws.cleanup(); }
});

test('pull-employers: a new row, a domain change, and a pause reach the watchlist', () => {
  const ws = fresh();
  try {
    const grid = rows(ws, 'employers').map((x) => (x[0] === 'Employer A' ? [x[0], 'Test Domain Three', ...x.slice(2)]
      : x[0] === 'Employer B' ? [x[0], x[1], 'paused', ...x.slice(3)] : x));
    grid.push(['Employer G', 'Test Domain One', 'watching']);
    const file = values(ws, 'employers.json', grid);
    const preview = ws.run('sheet', ['pull-employers', file]);
    assert.match(preview, /Would apply 3 change\(s\)/);
    ws.run('sheet', ['pull-employers', file, '--apply']);
    const wl = ws.read('applications/watchlist.md');
    assert.match(wl, /^\| Employer A \| greenhouse \| test-employer-a \| Example reason \| Test Domain Three \|$/m);
    assert.match(wl, /^\| ~Employer B \| ashby \| test-employer-b \| Example reason \(paused by Test in the sheet \d{4}-\d{2}-\d{2}\) \| Test Domain One \|$/m);
    assert.match(wl, /^\| Employer G \| manual \|  \| Added by Test in the sheet \d{4}-\d{2}-\d{2} \| Test Domain One \|$/m);
    assert.match(wl, /^\| Employer C \| lever \| test-employer-c \| Example reason \| Test Domain Two \|$/m, 'untouched rows stay');
  } finally { ws.cleanup(); }
});

test('pull-employers refuses an empty read and a large removal without --force', () => {
  const ws = fresh();
  try {
    const before = ws.read('applications/watchlist.md');
    assert.match(ws.run('sheet', ['pull-employers', values(ws, 'empty.json', []), '--apply']), /read back empty, so nothing was changed/);
    const out = ws.run('sheet', ['pull-employers', values(ws, 'one.json', [['Employer A', 'Test Domain One', 'watching']]), '--apply']);
    assert.match(out, /more than the 3 a sync allows without --force\. Nothing was written/);
    assert.equal(ws.read('applications/watchlist.md'), before);
  } finally { ws.cleanup(); }
});

test('prune archives postings that ended long ago without an application, and keeps applied ones', () => {
  const ws = fresh();
  try {
    const d = `${ws.folder('employer-d')}/posting.md`;
    ws.write(d, ws.read(d).replace(/  - \d{4}-\d{2}-\d{2} \| shortlisted/, `  - ${daysAgo(46)} | shortlisted`).replace(/  - \d{4}-\d{2}-\d{2} \| passed/, `  - ${daysAgo(45)} | passed`));
    assert.match(ws.run('sheet', ['prune']), /Employer D/);
    assert.ok(existsSync(join(ws.root, d)), 'nothing removed without --apply');
    ws.run('sheet', ['prune', '--apply']);
    assert.equal(existsSync(join(ws.root, d)), false);
    assert.match(ws.read('applications/data/archive.csv'), /Employer D,Principal Data Engineer,scout,2,3\.8,/);
    assert.ok(existsSync(join(ws.root, ws.folder('employer-c'), 'posting.md')));
    assert.match(ws.run('tracker'), /\(4 postings, 1 applied\)/, 'the archived posting still counts');
  } finally { ws.cleanup(); }
});

test('synced: a change made in the workspace since the last sync is never undone by the older sheet', async () => {
  const { appendEvent, setLastEventNote } = await import('../plugins/roleforward/tools/frontmatter.mjs');
  const ws = fresh();
  try {
    // The sheet as this sync wrote it.
    const shortlist = rows(ws, 'shortlist'), history = rows(ws, 'history'), employers = rows(ws, 'employers');
    assert.match(ws.run('sheet', ['synced']), /^Recorded this sync: \d+ Shortlist, \d+ History, and \d+ Employers rows\.$/m);
    // Then, in the workspace: a stage moves on, a reason is rewritten, an employer is paused, and one is added.
    appendEvent(join(ws.root, ws.folder('employer-a'), 'posting.md'), `${daysAgo(0)} | interested`, daysAgo(0));
    setLastEventNote(join(ws.root, ws.folder('employer-d'), 'posting.md'), 'A newer reason', daysAgo(0));
    ws.run('watchlist', ['pause', 'Employer C']);
    ws.run('watchlist', ['add', 'Employer H', '--domain', 'Test Domain One', '--source', 'greenhouse', '--board', 'test-employer-h', '--why', 'Example reason']);
    ws.run('tracker');
    // The sheet hasn't changed, so none of that is an edit.
    assert.match(ws.run('sheet', ['pull', shortlistValues(ws, 's.json', shortlist), '--apply']), /^No status changes in the sheet\.$/m);
    assert.match(ws.read(`${ws.folder('employer-a')}/posting.md`), /\| interested\n/);
    assert.match(ws.run('sheet', ['pull-history', values(ws, 'h.json', history), '--apply']), /^No reason changes in the History tab\.$/m);
    assert.match(ws.read(`${ws.folder('employer-d')}/posting.md`), /\| A newer reason\n/);
    assert.match(ws.run('sheet', ['pull-employers', values(ws, 'e.json', employers), '--apply']), /^No changes in the Employers tab\.$/m);
    const wl = ws.read('applications/watchlist.md');
    assert.match(wl, /^\| ~Employer C \|/m, 'still paused');
    assert.match(wl, /^\| Employer H \| greenhouse \|/m, 'not paused as a deleted row');
    // A cell the user did change still counts.
    const edited = shortlist.map((x) => (x[0] === 'Employer A' ? [x[0], x[1], 'passed', ...x.slice(3)] : x));
    assert.match(ws.run('sheet', ['pull', shortlistValues(ws, 's2.json', edited)]), /Employer A, Senior Data Engineer: interested -> passed/);
  } finally { ws.cleanup(); }
});

test('Shortlist header: Next sits right after Last event, A to P', () => {
  const ws = fresh();
  try {
    assert.deepEqual(JSON.parse(ws.run('sheet', ['headers', 'shortlist']))[0], ['Company', 'Role', 'Status', 'Role fit', 'Preference fit', 'Last event', 'Next',
      'Applied', 'Track', 'Resume', 'Source', 'Referral', "Why it's here", 'Contacts', 'Posting', 'Record ID']);
  } finally { ws.cleanup(); }
});

// The Shortlist's header row from before the Next column.
const OLD_HEADER = [['Company', 'Role', 'Status', 'Role fit', 'Preference fit', 'Last event', 'Applied', 'Track', 'Resume', 'Source', 'Referral', "Why it's here", 'Contacts', 'Posting', 'Record ID']];

test('pull refuses a Shortlist in the old layout, or values without the header row, and logs nothing', () => {
  const ws = fresh();
  try {
    const before = ws.read(`${ws.folder('employer-a')}/posting.md`);
    // Old rows: no Next cell, so the Record ID is one column to the left.
    const old = rows(ws, 'shortlist').map((x) => [x[0], x[1], 'passed', ...x.slice(3, 6), ...x.slice(7)]);
    const r = ws.fails('sheet', ['pull', values(ws, 'old.json', [...OLD_HEADER, ...old]), '--apply']);
    assert.equal(r.status, 1);
    assert.match(r.out, /The Shortlist has the layout from before the Next column.*sheet\.mjs upgrade.*Nothing was logged\./s);
    const bare = ws.fails('sheet', ['pull', values(ws, 'bare.json', rows(ws, 'shortlist')), '--apply']);
    assert.match(bare.out, /don't start with the Shortlist's header row\. Read the ranges sheet\.mjs ranges shortlist prints \(Shortlist!A1:P1, Shortlist!A2:C1000, Shortlist!P2:P1000\)/);
    const odd = ws.fails('sheet', ['pull', values(ws, 'odd.json', [['Company', 'Role', 'Something else']]), '--apply']);
    assert.match(odd.out, /header row isn't the layout this version writes/);
    assert.equal(ws.read(`${ws.folder('employer-a')}/posting.md`), before);
  } finally { ws.cleanup(); }
});

test('upgrade: inserts Next after Last event and resets what the insert disturbs, and sends nothing to a current sheet', () => {
  const ws = fresh();
  try {
    const q = JSON.parse(ws.run('sheet', ['upgrade', values(ws, 'h.json', OLD_HEADER), '--rules', '7']));
    assert.deepEqual(q[0], { insertDimension: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 6, endIndex: 7 }, inheritFromBefore: true } });
    assert.equal(q[1].updateCells.rows[0].values[0].userEnteredValue.stringValue, 'Next');
    assert.deepEqual([q[1].updateCells.range.startColumnIndex, q[2].repeatCell.range.startColumnIndex, q[3].updateDimensionProperties.range.startIndex], [6, 6, 6]);
    assert.equal(q[2].repeatCell.cell.userEnteredFormat.horizontalAlignment, 'LEFT', "not Last event's centering");
    assert.equal(q.filter((x) => x.deleteConditionalFormatRule).length, 7);
    const rules = q.filter((x) => x.addConditionalFormatRule).map((x) => x.addConditionalFormatRule.rule);
    assert.equal(rules.length, 7, 'the same rules setup makes');
    assert.deepEqual(rules.filter((x) => x.gradientRule).map((x) => x.ranges[0].startColumnIndex), [3, 4], 'the scores');
    assert.ok(rules.filter((x) => x.booleanRule).every((x) => x.ranges[0].startColumnIndex === 2), 'the status pills on C');
    assert.ok(q.indexOf(q.find((x) => x.deleteConditionalFormatRule)) < q.indexOf(q.find((x) => x.addConditionalFormatRule)), 'delete, then add');
    assert.equal(q.at(-1).setBasicFilter.filter.range.endColumnIndex, 16, 'the filter covers A to P');
    assert.match(ws.fails('sheet', ['upgrade', values(ws, 'h.json', OLD_HEADER)]).out, /Pass --rules <n>/);
    assert.equal(ws.run('sheet', ['upgrade', values(ws, 'now.json', JSON.parse(ws.run('sheet', ['headers', 'shortlist'])))]).trim(), '[]', 'already up to date');
    assert.notEqual(ws.fails('sheet', ['upgrade', values(ws, 'x.json', [['Something']]), '--rules', '0']).status, 0);
  } finally { ws.cleanup(); }
});

test('the conversation stage: in the Status dropdown in pipeline order, colored like interested', () => {
  const ws = fresh();
  try {
    const list = JSON.parse(ws.run('sheet', ['dropdown'])).find((x) => x.setDataValidation?.rule && x.setDataValidation.range.sheetId === 0)
      .setDataValidation.rule.condition.values.map((v) => v.userEnteredValue);
    assert.deepEqual(list.slice(0, 4), ['shortlisted', 'interested', 'conversation', 'applied']);
    const setup = JSON.parse(ws.run('sheet', ['setup']));
    const teal = setup.find((x) => x.addConditionalFormatRule?.rule.booleanRule?.format.backgroundColor.red === 0.875 && x.addConditionalFormatRule.rule.ranges[0].sheetId === 0);
    assert.match(teal.addConditionalFormatRule.rule.booleanRule.condition.values[0].userEnteredValue, /\$C2="interested",\$C2="conversation"/);
  } finally { ws.cleanup(); }
});

// ---- The routine sync: narrow reads, and writing only the tabs that changed ----

// The narrow reads as get_values returns them: one response per range, each with its range.
const response = (ws, name, range, grid) => { ws.write(name, JSON.stringify({ range, majorDimension: 'ROWS', values: grid })); return join(ws.root, name); };
const narrowShortlist = (ws, grid, header = JSON.parse(ws.run('sheet', ['headers', 'shortlist']))) => [
  response(ws, 'sh.json', 'Shortlist!A1:P1', header), response(ws, 'sa.json', 'Shortlist!A2:C1000', grid.map((r) => r.slice(0, 3))),
  response(ws, 'sp.json', 'Shortlist!P2:P1000', grid.map((r) => [r.at(-1)]))];
const tabsOf = (out) => Object.fromEntries(out.split('\n').filter((l) => /^[A-Z][A-Za-z ]{9} (changed|unchanged) /.test(l)).map((l) => [l.slice(0, 10).trim(), l.includes(' changed ')]));
const changedTabs = (ws, args = []) => Object.entries(tabsOf(ws.run('sheet', ['changed', ...args]))).filter(([, c]) => c).map(([t]) => t);
// A sync whose writes and read-back went through.
const syncAll = (ws) => { ws.run('sheet', ['changed']); ws.run('sheet', ['synced']); };

test('ranges: each pull reads only the columns that identify a row and the ones the user may edit', () => {
  const ws = fresh();
  try {
    assert.equal(ws.run('sheet', ['ranges']), 'shortlist (pull): Shortlist!A1:P1 Shortlist!A2:C1000 Shortlist!P2:P1000\n'
      + 'history (pull-history): History!A2:C1000 History!E2:E1000 History!N2:N1000\nemployers (pull-employers): Employers!A2:C1000\n');
    assert.equal(ws.run('sheet', ['ranges', '--full']), 'shortlist (pull): Shortlist!A1:P1000\nhistory (pull-history): History!A2:N1000\nemployers (pull-employers): Employers!A2:O1000\n');
    assert.equal(ws.run('sheet', ['ranges', 'history']), 'history (pull-history): History!A2:C1000 History!E2:E1000 History!N2:N1000\n');
  } finally { ws.cleanup(); }
});

test('the pulls work from the narrow reads, the same as from whole tabs', () => {
  const ws = fresh();
  try {
    const sl = rows(ws, 'shortlist').map((x) => (x[0] === 'Employer A' ? [x[0], x[1], 'passed', ...x.slice(3)] : x));
    assert.match(ws.run('sheet', ['pull', ...narrowShortlist(ws, sl), '--apply']), /Logged 1 status change\(s\) from the sheet:\n  Employer A, Senior Data Engineer: shortlisted -> passed\n/);
    const h = rows(ws, 'history');
    ws.run('sheet', ['pull-history', response(ws, 'ha.json', 'History!A2:C1000', h.map((r) => r.slice(0, 3))),
      response(ws, 'he.json', 'History!E2:E1000', h.map(() => ['A clearer reason'])), response(ws, 'hn.json', 'History!N2:N1000', h.map((r) => [r[13]])), '--apply']);
    assert.match(ws.read(`${ws.folder('employer-d')}/posting.md`), /\| passed \| A clearer reason\n/);
    // A list of responses in one file works too, and so does a batchGet response.
    const e = rows(ws, 'employers').map((r) => (r[0] === 'Employer B' ? [r[0], r[1], 'paused'] : r.slice(0, 3)));
    ws.write('e.json', JSON.stringify({ valueRanges: [{ range: 'Employers!A2:C1000', values: e }] }));
    ws.run('sheet', ['pull-employers', join(ws.root, 'e.json'), '--apply']);
    assert.match(ws.read('applications/watchlist.md'), /^\| ~Employer B \| ashby \|/m);
  } finally { ws.cleanup(); }
});

test('the pulls stay as safe from the narrow reads: a missing column, another tab, the old layout, and the quarter guard', () => {
  const ws = fresh();
  try {
    const before = ws.read(`${ws.folder('employer-a')}/posting.md`), wl = ws.read('applications/watchlist.md');
    const sl = rows(ws, 'shortlist').map((x) => [x[0], x[1], 'passed', ...x.slice(3)]);
    const [h, a] = narrowShortlist(ws, sl);
    const r = ws.fails('sheet', ['pull', h, a, '--apply']);
    assert.equal(r.status, 1);
    assert.match(r.out, /No values for column P \(Record ID\) of the Shortlist tab\. Read every range sheet\.mjs ranges shortlist prints\./);
    assert.match(ws.fails('sheet', ['pull', h, a, response(ws, 'x.json', 'History!N2:N1000', [['x']])]).out, /holds values from the History tab, not Shortlist/);
    // An old sheet: its header row (read on its own) is the layout before Next, so nothing else is trusted.
    const old = ws.fails('sheet', ['pull', ...narrowShortlist(ws, sl, OLD_HEADER), '--apply']);
    assert.match(old.out, /The Shortlist has the layout from before the Next column.*Nothing was logged\./s);
    // Without the header row at all.
    assert.match(ws.fails('sheet', ['pull', a, response(ws, 'p.json', 'Shortlist!P2:P1000', sl.map((x) => [x[15]]))]).out, /don't start with the Shortlist's header row/);
    assert.equal(ws.read(`${ws.folder('employer-a')}/posting.md`), before);
    // Most of the Employers tab missing from a narrow read is refused, as from a whole one.
    assert.match(ws.run('sheet', ['pull-employers', response(ws, 'e.json', 'Employers!A2:C1000', [['Employer A', 'Test Domain One', 'watching']]), '--apply']),
      /more than the 3 a sync allows without --force\. Nothing was written/);
    assert.equal(ws.read('applications/watchlist.md'), wl);
  } finally { ws.cleanup(); }
});

test('changed: every tab with no sync recorded yet, then only the tabs whose rows changed', () => {
  const ws = fresh();
  try {
    const first = ws.run('sheet', ['changed']);
    assert.deepEqual(changedTabs(ws), ['Shortlist', 'Scout Log', 'History', 'Stats', 'Employers'], 'still unconfirmed');
    assert.match(first, /^Shortlist  changed \(no sync recorded yet\): clear Shortlist!A2:P1000, write 3 rows at Shortlist!A2, read back Shortlist!A2:P4$/m);
    assert.match(first, /^Scout Log  changed \(no sync recorded yet\): clear 'Scout Log'!A2:I1000, /m);
    assert.match(first, /Then send sheet\.mjs dropdown shortlist employers\./);
    ws.run('sheet', ['synced']);
    const quiet = ws.run('sheet', ['changed']);
    assert.match(quiet, /^Shortlist  unchanged \(3 rows\)$/m);
    assert.match(quiet, /Nothing changed since the last sync: nothing to clear, write, or read back\.\n$/);
    // A change in the workspace: a new stage moves Employer A's row, and the Stats numbers follow.
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(-3), 'Decide on it']);
    const out = ws.run('sheet', ['changed']);
    assert.deepEqual(Object.entries(tabsOf(out)).filter(([, c]) => c).map(([t]) => t), ['Shortlist']);
    assert.match(out, /^Shortlist  changed \(rows changed\)/m);
    assert.match(out, /Then send sheet\.mjs dropdown shortlist\./);
  } finally { ws.cleanup(); }
});

test('changed: the user\'s edits just pulled change their tabs, and the new rows are recorded once synced', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    const sl = rows(ws, 'shortlist').map((x) => (x[0] === 'Employer A' ? [x[0], x[1], 'passed', ...x.slice(3)] : x));
    ws.run('sheet', ['pull', ...narrowShortlist(ws, sl), '--apply']);
    ws.run('tracker');
    const out = ws.run('sheet', ['changed']);
    assert.deepEqual(Object.entries(tabsOf(out)).filter(([, c]) => c).map(([t]) => t), ['Shortlist', 'History', 'Stats']);
    assert.match(out, /^Shortlist  changed \(3 rows then, 2 now\)/m);
    ws.run('sheet', ['synced']);
    assert.deepEqual(changedTabs(ws), []);
  } finally { ws.cleanup(); }
});

test('changed: a sync that never confirmed its writes, a record from an earlier layout, and another sheet', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(-3), 'Decide on it']);
    ws.run('sheet', ['changed']);
    // The read-back didn't match, so synced was skipped: the Shortlist is still to be written, even if nothing moves.
    assert.match(ws.run('sheet', ['changed']), /^Shortlist  changed \(the last sync that set out to rewrite it didn't confirm it\)/m);
    ws.run('sheet', ['synced']);
    assert.deepEqual(changedTabs(ws), []);
    // A record made before tabs were tracked (or for other headers) says nothing about these rows.
    const rec = JSON.parse(ws.read('applications/data/sheet-sync.json'));
    ws.write('applications/data/sheet-sync.json', JSON.stringify({ at: rec.at, shortlist: rec.shortlist, history: rec.history, employers: rec.employers }));
    assert.match(ws.run('sheet', ['changed']), /^History    changed \(the last sync was recorded for an earlier layout\)/m);
    ws.write('applications/data/sheet-sync.json', JSON.stringify({ ...rec, layout: 'abcdef012345' }));
    assert.equal(changedTabs(ws).length, 5);
    ws.write('applications/data/sheet-sync.json', JSON.stringify({ ...rec, sheet: 'example-sheet-one' }));
    ws.write('workspace.yaml', ws.read('workspace.yaml').replace('sheet:\n', 'sheet:\n  spreadsheet_id: example-sheet-two\n'));
    assert.match(ws.run('sheet', ['changed']), /^Stats      changed \(the last sync was recorded for another sheet\)/m);
    // --all, or a named tab, counts as changed on request.
    syncAll(ws);
    assert.deepEqual(changedTabs(ws, ['history']), ['History']);
    syncAll(ws);
    assert.equal(changedTabs(ws, ['--all']).length, 5);
  } finally { ws.cleanup(); }
});

test('synced: a tab whose rows changed again after changed ran stays to be written', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(-3), 'Decide on it']);
    ws.run('sheet', ['changed']);
    ws.run('next', ['set', ws.folder('employer-a'), daysAgo(-4), 'Decide on it, later']);
    assert.match(ws.run('sheet', ['synced']), /The workspace changed after sheet\.mjs changed ran, so the next sync rewrites Shortlist again\./);
    assert.deepEqual(changedTabs(ws), ['Shortlist']);
  } finally { ws.cleanup(); }
});

test('changed: rolling windows drop rows as the date moves, with no record changed, and Stats ignores its own date', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    // Stats' Updated date moves with every tracker run on a new day. Alone, that isn't a change.
    const stats = JSON.parse(ws.read('applications/data/stats.json'));
    ws.write('applications/data/stats.json', JSON.stringify({ ...stats, updated: daysAgo(-1) }));
    assert.deepEqual(changedTabs(ws), []);
    // Twenty days on: the Scout Log's and History's windows have moved past rows that were in them.
    ws.write('clock.mjs', 'const D = Date, shift = 20 * 864e5;\nglobalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [D.now() + shift])); } static now() { return D.now() + shift; } };\n');
    const later = ws.run('sheet', ['changed'], { node: ['--import', pathToFileURL(join(ws.root, 'clock.mjs')).href] });
    assert.deepEqual(Object.entries(tabsOf(later)).filter(([, c]) => c).map(([t]) => t), ['Scout Log', 'History']);
    assert.match(later, /^History    changed \(1 row then, 0 now\): clear History!A2:N1000, nothing to write$/m);
  } finally { ws.cleanup(); }
});

test('a pull that skipped rows, or a sheet missing rows the last sync wrote, has its tab rewritten', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    const [a, c, b] = rows(ws, 'shortlist');
    // A row sorted without its Record ID: skipped, and the next sync puts the tab back in step.
    ws.run('sheet', ['pull', ...narrowShortlist(ws, [[...a.slice(0, 15), c[15]], c, b])]);
    assert.match(ws.run('sheet', ['changed']), /^Shortlist  changed \(out of step with the workspace\)/m);
    syncAll(ws);
    // A row deleted by hand isn't an edit the pull reads, but the count shows it.
    const out = ws.run('sheet', ['pull', ...narrowShortlist(ws, [a, c])]);
    assert.match(out, /The Shortlist tab has 2 rows, and the last sync wrote 3, so the next sync rewrites it\./);
    assert.deepEqual(changedTabs(ws), ['Shortlist']);
    syncAll(ws);
    // A refused employer pull, as from a bad read.
    ws.run('sheet', ['pull-employers', response(ws, 'e.json', 'Employers!A2:C1000', [['Employer A', 'Test Domain One', 'watching']])]);
    assert.deepEqual(changedTabs(ws), ['Employers']);
  } finally { ws.cleanup(); }
});

test('upgrade and add-tab mark their tab for the next sync, and dropdown covers only the tabs named', () => {
  const ws = fresh();
  try {
    syncAll(ws);
    ws.run('sheet', ['upgrade', values(ws, 'h.json', OLD_HEADER), '--rules', '7']);
    assert.deepEqual(changedTabs(ws), ['Shortlist']);
    syncAll(ws);
    ws.run('sheet', ['add-tab', 'scoutlog', '1']);
    assert.deepEqual(changedTabs(ws), ['Scout Log']);
    const only = JSON.parse(ws.run('sheet', ['dropdown', 'shortlist']));
    assert.ok(only.length === 2 && only.every((q) => q.setDataValidation.range.sheetId === 0));
    assert.ok(JSON.parse(ws.run('sheet', ['dropdown', 'employers'])).every((q) => q.setDataValidation.range.sheetId === 1));
    assert.equal(JSON.parse(ws.run('sheet', ['dropdown'])).length, 6, 'both, with no tab named');
    assert.notEqual(ws.fails('sheet', ['dropdown', 'stats']).status, 0);
  } finally { ws.cleanup(); }
});
