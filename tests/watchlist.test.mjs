// Watchlist edits (watchlist.mjs): each command changes only its own row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspace } from './fixture.mjs';

const tableRows = (md) => md.split('\n').filter((l) => /^\| (?!Company|---)/.test(l) && !/^\|---/.test(l));

test('list groups employers by domain, marks manual ones, and counts paused ones', () => {
  const ws = buildWorkspace();
  try {
    assert.equal(ws.run('watchlist', ['list']), 'Test Domain One (2): Employer A, Employer B\nTest Domain Two (3): Employer C, Employer D, Employer E*\n'
      + 'Paused (1): Employer F\n5 active (4 with a feed, * = manual), 1 paused.\n');
  } finally { ws.cleanup(); }
});

test('add, set, pause, resume, and remove change only their row', () => {
  const ws = buildWorkspace();
  try {
    const before = ws.read('applications/watchlist.md');
    const others = tableRows(before).filter((l) => !/Employer [AF] /.test(l));
    ws.run('watchlist', ['add', 'Employer G', '--domain', 'Test Domain Three', '--source', 'greenhouse', '--board', 'test-employer-g', '--why', 'Example reason']);
    ws.run('watchlist', ['set', 'Employer A', '--board', 'test-employer-a2']);
    ws.run('watchlist', ['pause', 'Employer A']);
    ws.run('watchlist', ['resume', 'Employer F']);
    ws.run('watchlist', ['remove', 'Employer G']);
    ws.run('watchlist', ['add', 'Employer H']);
    const after = ws.read('applications/watchlist.md');
    for (const l of others) assert.ok(after.includes(`${l}\n`), `unchanged: ${l}`);
    assert.match(after, /^\| ~Employer A \| greenhouse \| test-employer-a2 \| Example reason \| Test Domain One \|$/m);
    assert.match(after, /^\| Employer F \| greenhouse \| test-employer-f \|/m);
    assert.match(after, /^\| Employer H \| manual \|  \|  \|  \|$/m);
    assert.doesNotMatch(after, /Employer G/);
    assert.equal(after.split('## Watchlist')[0].replace(/updated: .*/, ''), before.split('## Watchlist')[0].replace(/updated: .*/, ''), 'text above the table is kept');
  } finally { ws.cleanup(); }
});

test('company names match loosely, and adding a listed employer fails', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.run('watchlist', ['pause', 'employer c, inc.']), /^~Employer C \|/);
    assert.match(ws.fails('watchlist', ['add', 'Employer A']).out, /Employer A is already on the watchlist/);
    assert.match(ws.fails('watchlist', ['remove', 'Employer Z']).out, /Employer Z isn't on the watchlist/);
  } finally { ws.cleanup(); }
});

test('adding a paused employer resumes it', () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.run('watchlist', ['add', 'Employer F']), /^Employer F \| greenhouse \| test-employer-f \|/);
  } finally { ws.cleanup(); }
});
