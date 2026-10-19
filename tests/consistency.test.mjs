// Things that must agree across files, so a change in one place can't silently leave another behind: the source lists,
// the settings schema, the docs' references to tools and settings, the test coverage of every tool, and the two READMEs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA, SOURCES } from '../plugins/roleforward/tools/doctor.mjs';
import { PLUGIN } from './fixture.mjs';
import { WATCHLIST } from './feed-responses.mjs';

const REPO = join(PLUGIN, '..', '..');
const read = (...p) => readFileSync(join(...p), 'utf8');
const TOOLS = join(PLUGIN, 'tools'), TESTS = join(REPO, 'tests');
const tools = readdirSync(TOOLS).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort();
const skills = readdirSync(join(PLUGIN, 'skills')).filter((d) => existsSync(join(PLUGIN, 'skills', d, 'SKILL.md'))).sort();
const docs = () => [
  ...skills.flatMap((s) => readdirSync(join(PLUGIN, 'skills', s)).filter((f) => f.endsWith('.md')).map((f) => [`skills/${s}/${f}`, read(PLUGIN, 'skills', s, f)])),
  ...readdirSync(join(PLUGIN, 'templates'), { recursive: true }).filter((f) => /\.(md|yaml)$/.test(f)).map((f) => [`templates/${f}`, read(PLUGIN, 'templates', f)]),
  ['README.md', read(REPO, 'README.md')],
];
const scout = read(TOOLS, 'scout.mjs');
const FEEDS = [...scout.slice(scout.indexOf('const FEEDS = {'), scout.indexOf('\n};', scout.indexOf('const FEEDS = {'))).matchAll(/^ {2}async (\w+)\(/gm)].map((m) => m[1]);

// ---- Job sources ----

test("the doctor's source list is the scout's feeds plus manual", () => {
  assert.ok(FEEDS.length >= 14, `read ${FEEDS.length} feeds from scout.mjs`);
  assert.deepEqual([...SOURCES].sort(), [...FEEDS, 'manual'].sort());
});

test('every feed has a detail reader for show, capture, and validate', () => {
  const detail = scout.slice(scout.indexOf('async function detail('), scout.indexOf('async function pageDetail('));
  const viaPage = JSON.parse((detail.match(/if \((\[[^\]]+\])\.includes\(source\)\) return pageDetail/)?.[1] ?? '[]').replace(/'/g, '"'));
  for (const s of FEEDS) assert.ok(detail.includes(`source === '${s}'`) || viaPage.includes(s), `no detail reader for ${s}`);
});

test('every source type has a feed test', () => {
  const covered = new Set(WATCHLIST.map((w) => w[1]));
  for (const s of SOURCES) assert.ok(covered.has(s), `tests/feed-responses.mjs has no employer for ${s}`);
});

test('the docs name every source type', () => {
  const label = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever', workday: 'Workday', eightfold: 'Eightfold', smartrecruiters: 'SmartRecruiters',
    amazon: 'Amazon', google: 'Google', apple: 'Apple', talentbrew: 'TalentBrew', oracle: 'Oracle', successfactors: 'SuccessFactors', icims: 'iCIMS', page: 'fallback' };
  const readme = read(REPO, 'README.md'), template = read(PLUGIN, 'templates', 'applications', 'watchlist.md');
  const header = scout.slice(0, scout.indexOf('import '));
  for (const s of FEEDS) {
    assert.ok(label[s], `add a README label for the new source ${s} to this test`);
    assert.ok(readme.includes(label[s]), `README.md doesn't mention ${label[s]} (${s})`);
    assert.ok(template.includes(`\`${s}\``), `templates/applications/watchlist.md doesn't list \`${s}\``);
    assert.ok(new RegExp(`\\b${s}\\b`).test(header), `scout.mjs's header comment doesn't list ${s}`);
  }
});

// ---- Settings ----

// Whether a dotted path is in the schema. A 'map' setting takes any keys below it.
const inSchema = (path) => {
  let node = SCHEMA;
  for (const k of path.split('.')) {
    if (node === 'map') return true;
    if (!node || typeof node !== 'object' || Array.isArray(node) || !(k in node)) return false;
    node = node[k];
  }
  return true;
};
const leaves = (node, path = '') => Object.entries(node).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${path}${k}.`) : [`${path}${k}`]));
const TOP = Object.keys(SCHEMA).join('|');

test('every setting the tools read is in the settings schema', () => {
  const reads = new Set();
  for (const t of tools) for (const m of read(TOOLS, `${t}.mjs`).matchAll(/\b(?:get|cfg)\(\s*'([a-z_]+(?:\.[a-z_]+)+)'/g)) reads.add(`${t}: ${m[1]}`);
  assert.ok(reads.size > 40, `found ${reads.size} reads`);
  for (const r of reads) assert.ok(inSchema(r.split(': ')[1]), `${r} isn't in doctor.mjs SCHEMA`);
});

test('every setting the docs name is in the settings schema', () => {
  const bad = [];
  for (const [file, text] of docs())
    for (const m of text.matchAll(new RegExp(`\`((?:${TOP})(?:\\.[a-z_]+)+)\``, 'g')))
      if (!/\.(md|html|mjs|json|csv|yaml|txt|pdf|png|svg|xml)$/.test(m[1]) && !inSchema(m[1])) bad.push(`${file}: \`${m[1]}\``);
  assert.deepEqual(bad, []);
});

test('every setting in the schema is read by a tool or described in the docs', () => {
  const code = tools.map((t) => read(TOOLS, `${t}.mjs`)).join('\n'), text = docs().map(([, t]) => t).join('\n');
  // Settings read as a group (schedule.<job>) or through a parent value (targets.pay, the title patterns).
  const indirect = /^(schedule\.\w+\.\w+|targets\.pay\.\w+|scout\.(title_all|title_none|local_places|remote_words|abroad_words|home_country))$/;
  const unused = leaves(SCHEMA).filter((p) => !indirect.test(p) && !code.includes(`'${p}'`) && !text.includes(p) && !text.includes(p.split('.').at(-1) + ':'));
  assert.deepEqual(unused, []);
});

// ---- Tools, skills, and docs ----

test('every tool the docs name exists', () => {
  const bad = [];
  for (const [file, text] of docs()) for (const m of text.matchAll(/tools\/([\w-]+)\.mjs/g)) if (!tools.includes(m[1])) bad.push(`${file}: tools/${m[1]}.mjs`);
  assert.deepEqual(bad, []);
});

test('every command-line tool is named somewhere in the skills or the README', () => {
  const text = docs().map(([, t]) => t).join('\n');
  // index.mjs runs inside every tracker.mjs run, and the docs describe it through the tracker.
  const runByOthers = new Set(['index']);
  const cli = tools.filter((t) => /process\.argv/.test(read(TOOLS, `${t}.mjs`)) && !runByOthers.has(t));
  for (const t of cli) assert.ok(text.includes(`${t}.mjs`), `no skill or README mentions ${t}.mjs`);
});

test('every tool has tests', () => {
  const suite = readdirSync(TESTS).filter((f) => f.endsWith('.test.mjs')).map((f) => read(TESTS, f)).join('\n');
  for (const t of tools) assert.ok(suite.includes(`${t}.mjs`) || suite.includes(`run('${t}'`) || suite.includes(`ws.${t}(`), `no test exercises tools/${t}.mjs`);
});

test('every skill has a name and description, and the README lists it', () => {
  const readme = read(REPO, 'README.md');
  assert.ok(skills.length >= 8);
  for (const s of skills) {
    const fm = read(PLUGIN, 'skills', s, 'SKILL.md').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    assert.match(fm, new RegExp(`^name: ${s}$`, 'm'), `skills/${s}/SKILL.md name`);
    assert.match(fm, /^description: .{40,}/m, `skills/${s}/SKILL.md description`);
    assert.ok(readme.includes(`/${s}`) || readme.includes(`roleforward:${s}`), `README.md doesn't list /${s}`);
  }
});

// ---- Packaging ----

test('the two README copies are identical', () => {
  assert.equal(read(PLUGIN, 'README.md'), read(REPO, 'README.md'), 'copy the repo README.md to plugins/roleforward/README.md');
});

test('the manifests agree and the version is a release number', () => {
  const plugin = JSON.parse(read(PLUGIN, '.claude-plugin', 'plugin.json')), market = JSON.parse(read(REPO, '.claude-plugin', 'marketplace.json'));
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'marketplace.json lists the plugin');
  assert.ok(existsSync(join(REPO, entry.source, '.claude-plugin', 'plugin.json')), `marketplace source ${entry.source} holds the plugin`);
});

test('the changelog starts with the plugin version', () => {
  const { version } = JSON.parse(read(PLUGIN, '.claude-plugin', 'plugin.json'));
  assert.equal(read(REPO, 'CHANGELOG.md').match(/^## (\S+)/m)?.[1], version, 'add a CHANGELOG.md entry for this version');
});

test('the tests stay out of the plugin folder, so users never get them', () => {
  const inPlugin = readdirSync(PLUGIN, { recursive: true }).filter((f) => /\.test\.mjs$|fixture|mock-fetch|feed-responses/.test(f));
  assert.deepEqual(inPlugin, []);
});
