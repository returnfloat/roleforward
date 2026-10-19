#!/usr/bin/env node
// Checks that RoleForward can run here: Node, Chrome, and, inside a workspace, workspace.yaml against the settings
// schema below, the files it names, the career direction file, the watchlist, and the feed validation. It changes
// nothing. Problems stop something from working; warnings are worth a look. Lines marked "claude" are checks only
// Claude can make, such as the Google Sheets connector.
//
// Usage: node <plugin>/tools/doctor.mjs            (from inside the workspace, or anywhere for the system checks)
//        node <plugin>/tools/doctor.mjs --feeds    also runs scout.mjs validate, which opens one real posting per source type

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, findWorkspace, get as dig, parseYaml, CHROME_HELP, PLUGIN } from './workspace.mjs';
import { MAX_PLACES, PLACES } from './places.mjs';

export const MIN_NODE = 18;
// The scout's source types, kept in step with FEEDS in scout.mjs, plus manual reminders.
export const SOURCES = ['greenhouse', 'ashby', 'lever', 'workday', 'eightfold', 'smartrecruiters', 'amazon', 'google', 'apple',
  'talentbrew', 'oracle', 'successfactors', 'icims', 'page', 'manual'];

// ---- The settings schema ----
// Every setting the scripts and skills read. A leaf is a type: string, number, boolean, list, regex (a pattern string),
// patterns (a list of patterns, or one), date (YYYY-MM-DD), time (HH:MM), color (#rrggbb), or a list of allowed values.
// 'map' allows any keys below it (names chosen by the user, such as company aliases or sheet tab names).
const JOB = { enabled: 'boolean', every: ['daily', 'weekdays', 'weekly', 'monthly'], day: 'string', at: 'time' };
export const SCHEMA = {
  workspace_version: 'string',
  person: { name: 'string', file_stem: 'string', pronouns: 'string' },
  files: { resume: 'string', portfolio: 'string', guide: 'string', direction: 'string', linkedin: 'string', memory: 'string', interview_prep: 'string' },
  targets: {
    field: 'string', titles: 'list', level_baseline: 'string', level_track: 'string',
    country: 'string', remote: 'boolean', places: 'map',
    visa: { needs_sponsorship: 'boolean', status: 'string', deadline: 'date', aliases: 'map' },
    pay: { min: 'number', max: 'number', drop_below: 'number', unlisted: ['keep', 'drop'] },
  },
  scout: {
    search_terms: 'list', max_shortlist: 'number', cadence: ['daily', 'twice-weekly', 'weekly'], stale_days: 'number',
    discover: 'list', title_all: 'patterns', title_none: 'regex', remote_words: 'regex',
    google_levels: 'list',
  },
  apply: { depth: ['light', 'full'] },
  tracker: { maturity_field: 'string' },
  theme: { primary: 'color', accent: 'color' },
  render: { chrome: 'string', max_pages: 'number' },
  website: {
    enabled: 'boolean', domain: 'string', url: 'string', template: 'string', themes: 'string', site_role: 'string', description: 'string',
    job_title: 'string', location: 'string', linkedin: 'string', github: 'string', works_for: 'string', alumni_of: 'list', knows_about: 'list',
    address_locality: 'string', address_region: 'string', address_country: 'string', initials: 'string', location_line: 'string',
  },
  linkedin: { enabled: 'boolean' },
  connections: { enabled: 'boolean', refresh_days: 'number', function_words: 'patterns', aliases: 'map' },
  sheet: { spreadsheet_id: 'string', title: 'string', tabs: 'map', scout_log_days: 'number', history_days: 'number' },
  schedule: { scout: JOB, sheet: JOB, discover: JOB },
  index: { title: 'string', core: 'map', files: 'list' },
};

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
const compiles = (p) => { try { new RegExp(p, 'i'); return true; } catch { return false; } };
// Edit distance, for "did you mean" on unknown keys.
const distance = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

function typeProblem(type, v) {
  if (v === '') return ''; // left empty means unset, which every setting allows
  if (Array.isArray(type)) return type.includes(String(v).toLowerCase()) ? '' : `should be one of ${type.join(', ')}`;
  switch (type) {
    case 'string': return typeof v === 'string' || typeof v === 'number' ? '' : 'should be text';
    case 'number': return typeof v === 'number' ? '' : 'should be a number';
    case 'boolean': return typeof v === 'boolean' ? '' : 'should be true or false';
    case 'list': return Array.isArray(v) ? '' : 'should be a list ([a, b] or "- item" lines)';
    case 'regex': return typeof v !== 'string' ? 'should be a pattern in quotes' : compiles(v) ? '' : "isn't a valid pattern";
    case 'patterns': return (Array.isArray(v) ? v : [v]).every((p) => typeof p === 'string' && compiles(p)) ? '' : 'has a pattern that isn\'t valid';
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? '' : 'should be a date, YYYY-MM-DD';
    case 'time': return /^\d{1,2}:\d{2}$/.test(String(v)) ? '' : 'should be a time in quotes, "HH:MM"';
    case 'color': return /^#[0-9a-f]{6}$/i.test(String(v)) ? '' : "should be a color in quotes, '#rrggbb'";
    case 'map': return isMap(v) ? '' : 'should hold keys below it';
    default: return '';
  }
}

// Checks a parsed workspace.yaml against the schema: { problems, warnings }, each a list of "path: message" lines.
export function checkSettings(cfg, schema = SCHEMA, path = '') {
  const out = { problems: [], warnings: [] };
  for (const [k, v] of Object.entries(cfg)) {
    const p = path ? `${path}.${k}` : k, type = schema[k];
    if (type === undefined) {
      const near = Object.keys(schema).map((s) => [s, distance(s, k)]).sort((a, b) => a[1] - b[1])[0];
      out.warnings.push(`${p}: not a RoleForward setting, so nothing reads it${near && near[1] <= 2 ? ` (did you mean ${path ? `${path}.` : ''}${near[0]}?)` : ''}`);
      continue;
    }
    if (isMap(type)) {
      if (v === '') continue;
      if (!isMap(v)) { out.problems.push(`${p}: should hold settings below it`); continue; }
      const sub = checkSettings(v, type, p);
      out.problems.push(...sub.problems); out.warnings.push(...sub.warnings);
      continue;
    }
    const why = typeProblem(type, v);
    if (why) out.problems.push(`${p}: ${why} (now ${JSON.stringify(v)})`);
    // A template placeholder looks like <Full Name>. Patterns can hold "<" legitimately, so for them only a whole-value one counts.
    const placeholder = type === 'regex' || type === 'patterns' ? /^<[^<>]+>$/ : /<[^<>]+>/;
    if ((Array.isArray(v) ? v : [v]).some((t) => typeof t === 'string' && placeholder.test(t))) out.warnings.push(`${p}: still has a <placeholder> from the template`);
  }
  return out;
}

// Where the user can work (places.mjs): at most MAX_PLACES places, each with a list of nearby names, in a country the
// place list knows. The job feeds search the US only today.
export function placeProblems(get) {
  const out = [], places = get('targets.places', ''), country = String(get('targets.country', '') || '');
  const say = (level, text) => out.push({ level, text });
  if (!country) say('warn', 'workspace.yaml targets.country isn\'t set, so the place screen assumes US');
  else if (!PLACES.countries[country.toUpperCase()]) say('problem', `workspace.yaml targets.country: "${country}" isn't a two-letter country code the place list knows (for example US or GB)`);
  else if (country.toUpperCase() !== 'US') say('warn', `workspace.yaml targets.country is ${country.toUpperCase()}, but the job feeds search the US only today, so most postings will be from there`);
  const entries = places && typeof places === 'object' && !Array.isArray(places) ? Object.entries(places) : [];
  if (entries.length > MAX_PLACES) say('problem', `workspace.yaml targets.places lists ${entries.length} places. RoleForward uses at most ${MAX_PLACES}: merge some into another place's nearby names.`);
  for (const [place, nearby] of entries) if (nearby !== '' && !Array.isArray(nearby)) say('problem', `workspace.yaml targets.places "${place}": its nearby names should be a list, for example [Town One, Town Two]`);
  if (!entries.length && get('targets.remote', true) === false) say('problem', 'workspace.yaml has no targets.places and targets.remote is false, so no posting can pass the place screen');
  else if (!entries.length) say('warn', 'workspace.yaml targets.places is empty, so only remote postings pass the place screen');
  return out;
}

// ---- Report ----
const lines = [];
const say = (level, text) => lines.push({ level, text });
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim(); } catch { return ''; } };

function system(get) {
  const major = +process.versions.node.split('.')[0];
  say(major >= MIN_NODE ? 'ok' : 'problem', `Node ${process.versions.node}${major >= MIN_NODE ? '' : `: RoleForward needs Node ${MIN_NODE} or later`}`);
  const chrome = findChrome(get);
  if (!chrome || !existsSync(chrome)) say('problem', `${chrome ? `Chrome not found at ${chrome}. ` : 'No Chrome found. '}${CHROME_HELP} It prints the resume PDFs.`);
  else {
    // Chrome on Windows prints no version, so the path alone says it's there.
    const version = process.platform === 'win32' ? '' : run(chrome, ['--version']);
    say('ok', `Browser for PDFs: ${chrome}${version ? ` (${version})` : ''}`);
  }
}

async function workspace(root) {
  let cfg;
  try { cfg = parseYaml(readFileSync(join(root, 'workspace.yaml'), 'utf8')); }
  catch (e) { say('problem', `workspace.yaml: ${e.message}`); return null; }
  const get = (p, f) => dig(cfg, p, f);
  say('ok', `Workspace: ${root}`);

  const { problems, warnings } = checkSettings(cfg);
  for (const p of problems) say('problem', `workspace.yaml ${p}`);
  for (const w of warnings) say('warn', `workspace.yaml ${w}`);
  if (!problems.length && !warnings.length) say('ok', 'workspace.yaml: every setting is known and well formed');
  for (const req of ['person.name', 'person.file_stem', 'files.resume', 'files.portfolio'])
    if (!get(req)) say('problem', `workspace.yaml ${req} is missing`);
  const titleAll = get('scout.title_all', []);
  if (!(Array.isArray(titleAll) ? titleAll.length : titleAll)) say('warn', 'workspace.yaml scout.title_all is empty, so the scout matches no titles');
  for (const p of placeProblems(get)) say(p.level, p.text);

  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const stamp = String(get('workspace_version', ''));
  if (!stamp) say('warn', `workspace_version isn't set. Set it to ${plugin} once the workspace is up to date with this plugin.`);
  else if (stamp !== plugin) say('warn', `The workspace was last brought up to date with RoleForward ${stamp}, and the plugin is ${plugin}. Check the plugin README for what changed.`);
  else say('ok', `Workspace is up to date with RoleForward ${plugin}`);

  // Files the workspace names. The resume, portfolio, and career direction file are needed for any real work.
  for (const [key, needed] of [['resume', true], ['portfolio', true], ['direction', true], ['guide', false], ['linkedin', false], ['memory', false], ['interview_prep', false]]) {
    const f = get(`files.${key}`);
    if (f && !existsSync(join(root, f))) say(needed ? 'problem' : 'warn', `files.${key}: ${f} doesn't exist`);
  }

  if (existsSync(join(root, get('files.direction', 'career-direction.md')))) {
    const { readDirection } = await import('./fit.mjs');
    const d = readDirection();
    for (const p of d.problems) say('warn', `Career direction: ${p}`);
    if (!d.problems.length) say('ok', `Career direction: ${d.dealbreakers.length} dealbreakers, ${d.preferences.length} preferences`);
  }

  // The watchlist: unknown source types make the scout fail for those employers.
  const wl = join(root, 'applications', 'watchlist.md');
  if (existsSync(wl)) {
    const md = readFileSync(wl, 'utf8'), at = md.search(/^##\s+Watchlist\s*$/m);
    const rows = at < 0 ? [] : md.slice(at).split(/\r?\n/).filter((l) => /^\|/.test(l)).slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((r) => r[0]);
    if (at < 0) say('warn', 'applications/watchlist.md has no table under "## Watchlist", so the scout has no employers');
    else if (!rows.length) say('warn', 'applications/watchlist.md has no employers yet, so the scout has nothing to search');
    else {
      const bad = rows.filter((r) => !SOURCES.includes(r[1]));
      for (const r of bad) say('problem', `Watchlist: ${r[0]} has source "${r[1]}", which isn't one of ${SOURCES.join(', ')}`);
      const paused = rows.filter((r) => r[0].startsWith('~')).length, manual = rows.filter((r) => r[1] === 'manual').length;
      say('ok', `Watchlist: ${rows.length} employers (${rows.length - paused - manual} with feeds, ${manual} manual, ${paused} paused)`);
    }
  }
  const vf = join(root, 'applications', 'data', 'feed-validation.json');
  if (existsSync(vf)) {
    const v = JSON.parse(readFileSync(vf, 'utf8')), days = Math.round((Date.now() - Date.parse(v.date)) / 864e5);
    const res = Object.entries(v.results ?? {}), fail = res.filter(([, r]) => r.startsWith('fail')), down = res.filter(([, r]) => r.startsWith('down'));
    for (const [s, r] of fail) say('problem', `Feed validation (${v.date}): ${s} failed: ${r.replace(/^fail: /, '')}`);
    for (const [s] of down) say('warn', `Feed validation (${v.date}): ${s} was under maintenance. Run scout.mjs validate again.`);
    if (days > 30) say('warn', `Feed validation last ran ${days} days ago. Run scout.mjs validate.`);
    else if (!fail.length && !down.length) say('ok', `Feed validation (${v.date}): all ${res.length} source types passed`);
  }

  // Optional modules: only what's turned on.
  if (get('website.enabled', false) === true) {
    const t = get('website.template');
    if (t && !existsSync(join(root, t))) say('problem', `website.template: ${t} doesn't exist`);
    for (const k of ['url', 'domain', 'initials']) if (!get(`website.${k}`)) say('warn', `website.${k} isn't set, so the site leaves it out`);
  }
  if (get('connections.enabled', false) === true && !existsSync(join(root, 'contacts', 'connections.csv')))
    say('warn', 'The connections module is on, but no connections are imported yet (connections.mjs import <file>)');
  if (get('targets.visa.needs_sponsorship', false) === true && !existsSync(join(root, 'applications', 'data', 'sponsors.csv')))
    say('warn', 'The visa module is on, but no H-1B data is loaded yet (visa.mjs fetch)');
  if (get('sheet.spreadsheet_id')) say('claude', `Google Sheet ${get('sheet.spreadsheet_id')}: confirm the Google Sheets connector can read it (get_spreadsheet)`);
  return get;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = findWorkspace();
  let get = () => '';
  if (root) get = (await workspace(root)) ?? get;
  else say('warn', 'No workspace.yaml here or in any parent folder. Run /onboard to create a workspace, or run this from inside one.');
  system(get);
  if (root && process.argv.includes('--feeds')) {
    console.log('Running scout.mjs validate (opens one real posting per source type)...');
    try { execFileSync(process.execPath, [join(PLUGIN, 'tools', 'scout.mjs'), 'validate'], { stdio: 'inherit', cwd: root }); }
    catch { say('problem', 'scout.mjs validate stopped with an error'); }
  }
  const order = ['problem', 'warn', 'claude', 'ok'];
  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  console.log(`RoleForward doctor (plugin ${plugin}, ${process.platform})`);
  for (const l of [...lines].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level))) console.log(`  ${l.level.padEnd(7)} ${l.text}`);
  const n = (lvl) => lines.filter((l) => l.level === lvl).length;
  console.log(`${n('problem')} problem${n('problem') === 1 ? '' : 's'}, ${n('warn')} warning${n('warn') === 1 ? '' : 's'}${n('claude') ? `, ${n('claude')} for Claude to check` : ''}.`);
  process.exitCode = n('problem') ? 1 : 0;
}
