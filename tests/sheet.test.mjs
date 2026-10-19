// The Google Sheet's rows and the pulls that bring the user's sheet edits back (sheet.mjs). sheet.mjs never talks to
// Google itself, so everything here is local. It runs its command as it loads, so it's tested through the command line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorkspace, daysAgo } from './fixture.mjs';

const fresh = () => { const ws = buildWorkspace(); ws.run('tracker'); return ws; };
const rows = (ws, tab) => JSON.parse(ws.run('sheet', ['rows', tab]));
const values = (ws, name, grid) => { ws.write(name, JSON.stringify({ values: grid })); return join(ws.root, name); };

test('Shortlist: live postings, the higher lower-score first, with the record ID last', () => {
  const ws = fresh();
  try {
    const r = rows(ws, 'shortlist');
    assert.deepEqual(r.map((x) => [x[0], x[2], x[3], x[4]]), [
      ['Employer A', 'shortlisted', 4, 5], ['Employer C', 'recruiter-screen', 5, 3.4], ['Employer B', 'interested', 3, 3.6]]);
    assert.equal(r[0][5], `'${daysAgo(3)}`, 'dates are text');
    assert.equal(r[0][10], '', 'referral stays blank while only shortlisted');
    assert.equal(r[1][10], 'yes');
    assert.match(r[0][13], /^=HYPERLINK\("https:\/\/example\.invalid\/jobs\/1001","View posting"\)$/);
    assert.equal(r[0][14], ws.folder('employer-a').replace('applications/', ''));
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
    const file = values(ws, 'values.json', grid);
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
    const file = values(ws, 'values.json', [[a[0], a[1], 'applied', ...a.slice(3, 14), c[14]], [c[0], c[1], 'maybe', ...c.slice(3)]]);
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
    assert.match(ws.run('sheet', ['pull', values(ws, 's.json', shortlist), '--apply']), /^No status changes in the sheet\.$/m);
    assert.match(ws.read(`${ws.folder('employer-a')}/posting.md`), /\| interested\n/);
    assert.match(ws.run('sheet', ['pull-history', values(ws, 'h.json', history), '--apply']), /^No reason changes in the History tab\.$/m);
    assert.match(ws.read(`${ws.folder('employer-d')}/posting.md`), /\| A newer reason\n/);
    assert.match(ws.run('sheet', ['pull-employers', values(ws, 'e.json', employers), '--apply']), /^No changes in the Employers tab\.$/m);
    const wl = ws.read('applications/watchlist.md');
    assert.match(wl, /^\| ~Employer C \|/m, 'still paused');
    assert.match(wl, /^\| Employer H \| greenhouse \|/m, 'not paused as a deleted row');
    // A cell the user did change still counts.
    const edited = shortlist.map((x) => (x[0] === 'Employer A' ? [x[0], x[1], 'passed', ...x.slice(3)] : x));
    assert.match(ws.run('sheet', ['pull', values(ws, 's2.json', edited)]), /Employer A, Senior Data Engineer: interested -> passed/);
  } finally { ws.cleanup(); }
});
