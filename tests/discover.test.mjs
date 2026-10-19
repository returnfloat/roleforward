// Finding employers that aren't on the watchlist yet (discover.mjs), offline against the synthetic Hacker News thread
// and careers page in feed-responses.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../plugins/roleforward/tools/csv.mjs';
import { buildWorkspace } from './fixture.mjs';

// --import takes a file URL (a Windows path such as D:\... isn't one).
const node = ['--import', new URL('./mock-fetch.mjs', import.meta.url).href];
const discover = (ws, args) => ws.run('discover', args, { node });

test('hn proposes new employers that pass the title and place screens, with their board', () => {
  const ws = buildWorkspace();
  try {
    const out = discover(ws, ['hn']);
    assert.match(out, /^Ask HN: Who is hiring\? \(Example Month 2026\): 6 posts \(https:\/\/news\.ycombinator\.com\/item\?id=9100000\)\n/);
    assert.match(out, /New employers that passed the title and place screens: 2\n/);
    assert.match(out, /- Employer R: Senior Data Engineer\n  Remote \(US\) \| greenhouse test-employer-r \(2 open postings\) \| https:\/\/news\.ycombinator\.com\/item\?id=9100001/);
    assert.match(out, /- Employer U: Staff Data Engineer\n  Example City, ST \| no supported job board linked: run discover\.mjs board/);
    assert.doesNotMatch(out, /Employer [AST]\b/, 'on the watchlist, a non-matching title, or abroad');
    const rows = parseCsv(ws.read('applications/data/discovered.csv'));
    assert.deepEqual(rows.map((r) => [r.company, r.source, r.board, r.open_postings, r.decision]), [['Employer R', 'greenhouse', 'test-employer-r', '2', 'proposed'], ['Employer U', '', '', '', 'proposed']]);
  } finally { ws.cleanup(); }
});

test('an employer proposed once is never proposed again, and mark and list record the call', () => {
  const ws = buildWorkspace();
  try {
    discover(ws, ['hn']);
    assert.match(discover(ws, ['hn']), /No new employers passed the screen\./);
    assert.equal(discover(ws, ['mark', 'Employer U', 'skipped', 'Example reason']).trim(), 'Employer U: skipped (Example reason)');
    assert.match(discover(ws, ['list']), /^- Employer R \(HN Example Month 2026, \d{4}-\d{2}-\d{2}\): Senior Data Engineer \| greenhouse test-employer-r/);
    assert.doesNotMatch(discover(ws, ['list']), /Employer U/);
    discover(ws, ['mark', 'Employer W', 'added']);
    assert.match(ws.read('applications/data/discovered.csv'), /^Employer W,,,,,,other,,\d{4}-\d{2}-\d{2},added,$/m, 'an employer found another way gets a line too');
    assert.match(ws.fails('discover', ['mark', 'Employer R', 'maybe'], { node }).out, /^Usage: discover\.mjs mark/);
  } finally { ws.cleanup(); }
});

test('board finds a job board from the careers page, and names hosts it can only point to', () => {
  const ws = buildWorkspace();
  try {
    const out = discover(ws, ['board', 'Employer V', 'https://page.example.invalid/careers']);
    assert.match(out, /^Job boards for Employer V:\n  greenhouse \| test-employer-r \| 2 open postings\n  eightfold \| \(see the scout skill's source table\) \| \? open postings\n/);
    assert.match(out, /Add it: node <plugin>\/tools\/watchlist\.mjs add "Employer V" --domain "<Domain>" --source greenhouse --board test-employer-r/);
    assert.match(discover(ws, ['board', 'Employer V']), /^No Greenhouse, Ashby, or Lever board found for Employer V\./);
  } finally { ws.cleanup(); }
});
