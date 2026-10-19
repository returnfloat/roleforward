#!/usr/bin/env node
// Finds employers that aren't on the watchlist yet, for the user to approve. It never adds one by itself, never applies,
// and never contacts anyone (posts often say "email us": that's the user's call, never the scout's).
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/discover.mjs hn [<thread id>]         the latest Hacker News "Who is hiring?" thread (or a given one):
//                                                            posts that pass the scout's title and place screens, from
//                                                            employers not on the watchlist, with their job board when linked
//   node <plugin>/tools/discover.mjs board "<Company>" [<careers page URL>]
//                                                            finds an employer's job board: tries Greenhouse, Ashby, and Lever
//                                                            names, and reads the careers page for a supported host
//   node <plugin>/tools/discover.mjs mark "<Company>" added|skipped ["<reason>"]
//   node <plugin>/tools/discover.mjs list                    proposals still waiting for the user's call
//
// Every proposal is kept once in applications/data/discovered.csv, so a skipped employer isn't proposed again.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, writeCsv } from './csv.mjs';
import { norm } from './connections.mjs';
import { screens } from './screen.mjs';
import { loadWorkspace } from './workspace.mjs';

const { root, get } = loadWorkspace();
const apps = join(root, 'applications');
const FILE = join(apps, 'data', 'discovered.csv');
const COLS = ['company', 'source', 'board', 'open_postings', 'roles', 'location', 'found_via', 'link', 'first_seen', 'decision', 'reason'];
const today = new Date().toLocaleDateString('en-CA');
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh) roleforward-scout' };
const { titleOk, placeOk } = screens(get);
const fail = (msg) => { console.error(msg); process.exit(1); };

const json = async (url) => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s ?? '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const plain = (html) => decode(String(html ?? '').replace(/<p>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

// Every company on the watchlist, including skipped (~) and manual rows, so they're never proposed.
function watchlistNames() {
  const f = join(apps, 'watchlist.md');
  if (!existsSync(f)) return new Set();
  const md = readFileSync(f, 'utf8');
  return new Set(md.slice(md.indexOf('## Watchlist')).split(/\r?\n/).filter((l) => /^\|/.test(l)).slice(2)
    .map((l) => norm(l.split('|')[1]?.trim().replace(/^~/, ''))).filter(Boolean));
}

// Supported job boards linked from a post or a careers page: [source, board].
const BOARD_LINKS = [
  [/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/gi, 'greenhouse'],
  [/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/gi, 'greenhouse'],
  [/jobs\.ashbyhq\.com\/([\w.%-]+)/gi, 'ashby'],
  [/jobs\.lever\.co\/([\w.-]+)/gi, 'lever'],
  [/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/gi, 'workday'],
  [/jobs\.smartrecruiters\.com\/([\w-]+)/gi, 'smartrecruiters'],
  [/(careers-[\w-]+\.icims\.com)/gi, 'icims'],
];
const IGNORE_BOARD = /^(embed|jobs|job|v1|api|careers|search)$/i;
function boardsIn(text) {
  const found = new Map();
  for (const [re, source] of BOARD_LINKS)
    for (const m of String(text).matchAll(re)) {
      const board = source === 'workday' ? `${m[1]}/${m[2]}/${m[3]}` : decodeURIComponent(m[1]);
      if (IGNORE_BOARD.test(board)) continue;
      const k = `${source}|${board}`;
      found.set(k, (found.get(k) ?? 0) + 1);
    }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split('|'));
}
// How many postings a board lists, which also proves the board name works. null when the source has no quick count.
async function openPostings(source, board) {
  try {
    if (source === 'greenhouse') return (await json(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`)).jobs.length;
    if (source === 'ashby') return (await json(`https://api.ashbyhq.com/posting-api/job-board/${board}`)).jobs.length;
    if (source === 'lever') return (await json(`https://api.lever.co/v0/postings/${board}?mode=json`)).length;
  } catch { return 0; }
  return null;
}

// ---- Hacker News "Who is hiring?" ----
// The first line of a post is usually "Company | Role | Place | ...", with "|" or a dash between parts.
const company = (header) => header.split(/\s+[|—–]\s+|\s+-\s+|\s*\|\s*/)[0].replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*[—–-]\s*$/, '').trim();
async function hn(threadId) {
  if (!threadId) {
    const hits = (await json('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10')).hits;
    const t = hits.find((h) => /^Ask HN: Who is hiring\?/i.test(h.title));
    if (!t) fail('No "Who is hiring?" thread found.');
    threadId = t.objectID;
  }
  const thread = await json(`https://hn.algolia.com/api/v1/items/${threadId}`);
  console.log(`${thread.title}: ${thread.children.length} posts (https://news.ycombinator.com/item?id=${threadId})`);
  const known = watchlistNames(), old = readCsv(FILE), seen = new Set(old.map((r) => norm(r.company)));
  const fresh = [];
  for (const c of thread.children.filter((c) => c.text)) {
    const header = plain(c.text.split(/<p>/i)[0]), body = plain(c.text);
    const name = company(header), k = norm(name);
    if (!k || known.has(k) || seen.has(k)) continue;
    // Role lines: the header's parts, and short lines in the body (role lists), each checked against the title screen.
    // The first header part is the company, and the body's first line repeats the header, so both are left out.
    const headerParts = header.split(/\s+[|—–]\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    const parts = [...headerParts.slice(1), ...body.split('\n').slice(1).filter((l) => l.length < 160)];
    const roles = [...new Set(parts.map((p) => p.replace(/^[-*•\s]+/, '').replace(/\s*https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)).filter((p) => titleOk(p)))];
    if (!roles.length || !placeOk(header)) continue;
    const place = headerParts.slice(1).filter((p) => placeOk(p) && p.length < 80 && !titleOk(p));
    const [source = '', board = ''] = boardsIn(decode(c.text))[0] ?? [];
    seen.add(k);
    fresh.push({ company: name, source, board, open_postings: '', roles: roles.slice(0, 4).join('; '), location: place.slice(0, 2).join('; ') || 'see the post',
      found_via: `HN ${thread.title.replace(/^Ask HN: Who is hiring\? \(|\)$/g, '')}`, link: `https://news.ycombinator.com/item?id=${c.id}`, first_seen: today, decision: 'proposed', reason: '' });
  }
  for (const f of fresh) if (f.source) f.open_postings = (await openPostings(f.source, f.board)) ?? '';
  writeCsv(FILE, COLS, [...old, ...fresh]);
  if (!fresh.length) return console.log('No new employers passed the screen. (Employers already on the watchlist or proposed before are left out.)');
  console.log(`New employers that passed the title and place screens: ${fresh.length}\n`);
  for (const f of fresh)
    console.log(`- ${f.company}: ${f.roles}\n  ${f.location} | ${f.source ? `${f.source} ${f.board}${f.open_postings !== '' ? ` (${f.open_postings} open postings${f.open_postings === 0 ? ', check the board name' : ''})` : ''}` : 'no supported job board linked: run discover.mjs board'} | ${f.link}`);
}

// ---- finding an employer's board ----
async function board(name, url) {
  if (!name) fail('Usage: discover.mjs board "<Company>" [<careers page URL>]');
  const words = norm(name).split(' ');
  const slugs = [...new Set([words.join(''), words.join('-'), words[0], words.join('_')])].filter(Boolean);
  const found = [];
  for (const slug of slugs)
    for (const source of ['greenhouse', 'ashby', 'lever']) {
      const n = await openPostings(source, slug);
      if (n) found.push([source, slug, n]);
    }
  if (url) {
    try {
      const html = await (await fetch(url, { headers: UA, redirect: 'follow' })).text();
      for (const [source, b] of boardsIn(html)) found.push([source, b, (await openPostings(source, b)) ?? '?']);
      for (const [re, source] of [[/rmkcdn|jobs2web/i, 'successfactors (use the careers host)'], [/tbcdn\.talentbrew\.com\/company\/(\d+)/i, 'talentbrew'], [/eightfold\.ai/i, 'eightfold'], [/hcmUI\/CandidateExperience/i, 'oracle']])
        if (re.test(html)) found.push([source, '(see the scout skill\'s source table)', '?']);
    } catch (e) { console.log(`Couldn't read ${url}: ${e.message}`); }
  }
  if (!found.length) return console.log(`No Greenhouse, Ashby, or Lever board found for ${name}${url ? ', and no supported host on its careers page' : ''}. Try its careers page URL, or the page fallback in the scout skill's source table.`);
  const uniq = [...new Map(found.map((f) => [`${f[0]}|${f[1]}`, f])).values()];
  console.log(`Job boards for ${name}:\n${uniq.map(([s, b, n]) => `  ${s} | ${b} | ${n} open postings`).join('\n')}\nAdd it: node <plugin>/tools/watchlist.mjs add "${name}" --domain "<Domain>" --source ${uniq[0][0]} --board ${uniq[0][1]} --why "<why>"`);
}

function mark(name, decision, reason = '') {
  if (!name || !['added', 'skipped'].includes(decision)) fail('Usage: discover.mjs mark "<Company>" added|skipped ["<reason>"]');
  const rows = readCsv(FILE);
  let r = rows.find((x) => norm(x.company) === norm(name));
  // An employer found some other way (a web search, the user's own idea) gets its first line here, so it's never proposed again.
  if (!r) rows.push(r = { company: name, found_via: 'other', first_seen: today });
  Object.assign(r, { decision, reason });
  writeCsv(FILE, COLS, rows);
  console.log(`${r.company}: ${decision}${reason ? ` (${reason})` : ''}`);
}

function list() {
  const rows = readCsv(FILE).filter((r) => r.decision === 'proposed');
  if (!rows.length) return console.log('No proposals waiting.');
  for (const f of rows) console.log(`- ${f.company} (${f.found_via}, ${f.first_seen}): ${f.roles} | ${f.source ? `${f.source} ${f.board}` : 'no board yet'} | ${f.link}`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'hn') await hn(args[0]);
  else if (cmd === 'board') await board(args[0], args[1]);
  else if (cmd === 'mark') mark(...args);
  else if (cmd === 'list') list();
  else console.error('Usage: node <plugin>/tools/discover.mjs hn [<thread id>] | board "<Company>" [<url>] | mark "<Company>" added|skipped ["<reason>"] | list');
} catch (e) { fail(e.message); }
