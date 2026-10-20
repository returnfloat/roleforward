#!/usr/bin/env node
// Google Docs in the workspace's Drive folder, made only when the user asks for one, so a browser or phone can show
// them. Like sheet.mjs, it never talks to Google itself: it builds the Markdown, which the Google Drive connector
// uploads as a new Google Doc (Drive converts Markdown on upload), and it remembers which copy is current.
//
// Usage (run from inside the workspace, with drive.enabled true in workspace.yaml):
//   node <plugin>/tools/docs.mjs list               the Docs the user can ask for, and for each one made before: its
//                                                   link, whether the workspace has changed since, and whether its
//                                                   posting has ended (move those to the Archive folder)
//   node <plugin>/tools/docs.mjs markdown <key>     the title (first line) and the Markdown to upload. <key> is "prep"
//                                                   or a posting's Record ID, as list shows them
//   node <plugin>/tools/docs.mjs record <key> --doc <id>
//                                                   saves the new Doc as the current copy, and prints the previous copy's
//                                                   ID, which is trashed next (a fresh copy replaces it)
//   node <plugin>/tools/docs.mjs record <key> --archived
//                                                   notes that the Doc was moved to the Archive folder
// The record is applications/data/drive.json.
//
// The Docs:
//   Interview Prep    the workspace's interview prep file (files.interview_prep)
//   a packet          for a posting the user is interested in or has applied to: the fit analysis, the company's
//                     bottom line and interview questions, the form answers (without voluntary self-identification),
//                     the posting's prep plan, and, once frozen, the text of the resume that was sent

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readFrontmatter, parseEvent } from './frontmatter.mjs';
import { loadWorkspace, resumeFiles } from './workspace.mjs';

const { root, get } = loadWorkspace();
const DATA = join(root, 'applications', 'data', 'drive.json');
const LIVE = ['interested', 'applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final', 'offer'];
const today = new Date().toLocaleDateString('en-CA');

const load = () => (existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : { docs: {} });
const save = (d) => { mkdirSync(dirname(DATA), { recursive: true }); writeFileSync(DATA, JSON.stringify(d, null, 1) + '\n'); };
// What a Doc was made from, without its date line, so "changed since" means the content changed.
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n?/g, '\n') : '');
// A file's body: no front matter, no comments, and no top-level title (the Doc has its own).
const body = (md) => md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*# .*\n/, '').trim();
// Links to workspace files mean nothing in Drive: keep their text. Obsidian links too.
const plainLinks = (md) => md.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a);

// Every posting folder: applications/<company>/<folder>/posting.md, keyed by its Record ID "<company>/<folder>".
function postings() {
  const dir = join(root, 'applications'), out = [];
  for (const c of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    if (!c.isDirectory() || c.name === 'data') continue;
    for (const p of readdirSync(join(dir, c.name), { withFileTypes: true })) {
      const file = join(dir, c.name, p.name, 'posting.md');
      if (p.isDirectory() && existsSync(file)) out.push({ id: `${c.name}/${p.name}`, dir: join(dir, c.name, p.name), ...readFrontmatter(file) });
    }
  }
  return out;
}
const stageOf = (data) => (data.events || []).map(parseEvent).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.stage ?? 'shortlisted';

// The parts of company.md worth having at hand: the verdict, the full research's bottom line and table (or the quick
// check's), and the questions to ask. The evidence and sources stay in the workspace.
function companyPart(file) {
  const md = read(file);
  if (!md) return '';
  const { verdict } = readFrontmatter(file).data;
  const section = (name) => { const m = md.match(new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')); return m ? m[1] : ''; };
  const pick = section('Full Research') || section('Quick Check');
  const summary = pick.split(/^### /m)[0].trim();
  const questions = [...md.matchAll(/^\*\*(Questions for interviews|Ask the recruiter|Red flags):\*\*.*$/gm)].map((m) => m[0]);
  return [verdict && `**Verdict:** ${verdict}`, summary, ...questions].filter(Boolean).join('\n\n');
}

// Form answers without the voluntary self-identification (EEO) questions, which stay in the workspace.
function answersPart(file) {
  const md = body(read(file)).replace(/^## [^\n]*(Self-Identification|EEO)[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/gim, '');
  return md.split('\n').filter((l) => !/\bEEO\b|self-identification|gender, race|veteran|disability/i.test(l)).join('\n').trim();
}

function packet(p) {
  const { data } = p;
  const facts = [`**Stage:** ${stageOf(data)}`, data.posting && `[View posting](${data.posting})`,
    data.frozen && `**Applied:** ${data.frozen}`, data.resume && data.resume !== 'tbd' && `**Resume:** ${data.resume}`].filter(Boolean).join(' · ');
  const parts = [facts, '# Fit and Recommendation', body(p.body)];
  const company = companyPart(join(dirname(p.dir), 'company.md'));
  if (company) parts.push('# Company', company);
  if (existsSync(join(p.dir, 'answers.md'))) parts.push('# Application Answers', answersPart(join(p.dir, 'answers.md')));
  if (existsSync(join(p.dir, 'prep.md'))) parts.push('# Prep Plan', body(read(join(p.dir, 'prep.md'))));
  if (data.frozen) {
    const { txt } = resumeFiles(root, get, data.resume, p.dir, true);
    if (existsSync(txt)) parts.push('# Resume Sent', `The text of the resume sent on ${data.frozen}. The PDF is in the workspace, in this posting's folder.`,
      read(txt).trim().split('\n').filter(Boolean).map((l) => (/^- /.test(l) ? l : `\n${l}\n`)).join('\n'));
  }
  return { title: `${data.company} · ${data.role}`, markdown: plainLinks(parts.join('\n\n')), live: LIVE.includes(stageOf(data)) };
}

function docFor(key) {
  if (key === 'prep') {
    const file = join(root, get('files.interview_prep', 'interview-prep.md'));
    return existsSync(file) ? { title: 'Interview Prep', markdown: plainLinks(body(read(file))), live: true } : null;
  }
  const p = postings().find((x) => x.id === key);
  return p ? packet(p) : null;
}

const url = (id) => `https://docs.google.com/document/d/${id}/edit`;

const [cmd, key] = process.argv.slice(2);
const opt = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1] ?? true; };

if (get('drive.enabled', false) !== true) {
  console.error('The Drive folder is off (drive.enabled in workspace.yaml). Turn it on with /onboard, or by setting drive.enabled: true.');
  process.exit(1);
}

if (cmd === 'list') {
  const d = load(), lines = [];
  const show = (k, doc) => {
    const rec = d.docs[k];
    const state = !rec?.doc ? 'no Doc yet'
      : rec.archived ? `archived ${rec.archived}`
      : !doc ? 'its posting is gone: move it to Archive'
      : !doc.live ? 'the posting has ended: move it to Archive'
      : rec.hash === sha(doc.markdown) ? `current (made ${rec.made})` : `made ${rec.made}, the workspace has changed since`;
    lines.push(`${k}\n  ${doc?.title ?? rec.title}: ${state}${rec?.doc && !rec.archived ? `\n  ${url(rec.doc)}` : ''}`);
  };
  if (docFor('prep')) show('prep', docFor('prep'));
  const seen = new Set(['prep']);
  for (const p of postings()) {
    const doc = packet(p);
    if (!doc.live && !d.docs[p.id]) continue;
    seen.add(p.id); show(p.id, doc);
  }
  for (const k of Object.keys(d.docs)) if (!seen.has(k)) show(k, null);
  console.log(lines.length ? lines.join('\n') : 'Nothing to put in Drive yet: no prep file, and no posting marked interested or later.');
} else if (cmd === 'markdown') {
  const doc = docFor(key);
  if (!doc) { console.error(`No Doc for "${key}". Use prep or a Record ID from docs.mjs list.`); process.exit(1); }
  console.log(`${doc.title}\n\n*Made by RoleForward from your career workspace on ${today}. Asking for a fresh copy replaces this one, so edits made here aren't kept.*\n\n${doc.markdown}`);
} else if (cmd === 'record') {
  const d = load(), doc = docFor(key), rec = d.docs[key] ??= {};
  if (opt('--doc')) {
    if (!doc) { console.error(`No Doc for "${key}".`); process.exit(1); }
    const previous = rec.archived ? null : rec.doc;
    Object.assign(rec, { doc: opt('--doc'), title: doc.title, hash: sha(doc.markdown), made: today });
    delete rec.archived;
    save(d);
    console.log(`${key}: ${url(rec.doc)}${previous ? `\nTrash the previous copy: ${previous}` : ''}`);
  } else if (opt('--archived')) {
    if (!rec.doc) { console.error(`No Doc recorded for "${key}".`); process.exit(1); }
    rec.archived = today; save(d);
    console.log(`${key}: archived ${today}`);
  } else { console.error('Usage: docs.mjs record <key> --doc <id> | --archived'); process.exit(1); }
} else {
  console.error('Usage: docs.mjs list | markdown <key> | record <key> --doc <id> | --archived');
  process.exit(1);
}
