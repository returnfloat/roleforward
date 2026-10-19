#!/usr/bin/env node
// Freezes a posting once the user confirms they have submitted the application.
//   node tools/freeze.mjs applications/<company>/<YYYY-MM-DD-role>              freeze, applied today
//   node tools/freeze.mjs applications/<company>/<YYYY-MM-DD-role> 2026-10-04   freeze with an explicit applied date
//   node tools/freeze.mjs --check                                               verify every frozen posting is untouched
//
// posting.md's `resume:` field says what was sent:
//   <default resume> or variants/<name>.md  a reused resume. Its current rendered PDF and .txt, plus the source
//                                           Markdown, are copied into the posting folder as the record of what went out.
//   tailored                                the posting's own resume.md, rendered next to it.
// Either way the folder ends up holding resume.md, <file_stem>-Resume.pdf and .txt. Freezing then:
//   - refuses if the PDF is older than its Markdown source (render first)
//   - adds the applied event, frozen date, and sha256 hashes of every frozen file to posting.md
//   - makes resume.md, the PDF, the .txt, answers.md, and jd.md read-only
// posting.md stays writable, since events keep coming after applying. Then the tracker is rebuilt.

import { existsSync, statSync, chmodSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { readFrontmatter, writeFrontmatter, parseEvent } from './frontmatter.mjs';
import { loadWorkspace, PLUGIN, relPath, resumeFiles } from './workspace.mjs';

const { root, get } = loadWorkspace();
const STEM = get('person.file_stem') + '-Resume';
const PDF = STEM + '.pdf', TXT = STEM + '.txt';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function freeze(dirArg, date = new Date().toLocaleDateString('en-CA')) {
  const dir = resolve(dirArg), posting = join(dir, 'posting.md');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Applied date must be YYYY-MM-DD, got ${date}`);
  if (!existsSync(posting)) throw new Error(`No posting.md in ${relPath(root, dir)}`);
  const { data, body } = readFrontmatter(posting);
  if (data.frozen) throw new Error(`Already frozen on ${data.frozen}.`);

  const src = resumeFiles(root, get, data.resume || '', dir);
  const { pdf, txt } = src;
  for (const p of [src.md, pdf, txt]) if (!existsSync(p)) throw new Error(`Missing ${relPath(root, p)}. Render it first.`);
  if (statSync(pdf).mtimeMs < statSync(src.md).mtimeMs) throw new Error(`${relPath(root, pdf)} is older than ${relPath(root, src.md)}. Render it first.`);

  // The resume's own frontmatter is edited as text, not round-tripped, so its other fields stay byte-identical.
  const mark = data.resume === 'tailored' ? `frozen: ${date}\n` : `frozen: ${date}\nsnapshot_of: ${data.resume}\n`;
  if (data.resume !== 'tailored') { copyFileSync(pdf, join(dir, PDF)); copyFileSync(txt, join(dir, TXT)); }
  const resumeMd = readFileSync(src.md, 'utf8').replace(/\r\n?/g, '\n');
  if (!resumeMd.startsWith('---\n')) throw new Error(`${relPath(root, src.md)} needs frontmatter.`);
  writeFileSync(join(dir, 'resume.md'), resumeMd.replace(/^---\n/, '---\n' + mark));

  const files = ['resume.md', PDF, TXT, 'answers.md', 'jd.md'].filter((f) => existsSync(join(dir, f)));
  const events = data.events || [];
  if (!events.map(parseEvent).some((e) => e.stage === 'applied')) events.push(`${date} | applied`);
  writeFrontmatter(posting, { ...data, events, frozen: date, frozen_files: Object.fromEntries(files.map((f) => [f, sha(join(dir, f))])) }, body);
  for (const f of files) chmodSync(join(dir, f), 0o444);
  console.log(`Frozen ${relPath(root, dir)} (applied ${date}, resume: ${data.resume}). Read-only: ${files.join(', ')}`);
  execFileSync(process.execPath, [join(PLUGIN, 'tools', 'tracker.mjs')], { stdio: 'inherit', cwd: root });
}

function check() {
  const apps = join(root, 'applications');
  let n = 0, bad = 0;
  for (const c of readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory()))
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = join(apps, c.name, p.name);
      if (!existsSync(join(dir, 'posting.md'))) continue;
      const { frozen_files } = readFrontmatter(join(dir, 'posting.md')).data;
      if (!frozen_files) continue;
      n++;
      for (const [f, want] of Object.entries(frozen_files))
        if (!existsSync(join(dir, f)) || sha(join(dir, f)) !== want) { console.error(`CHANGED: ${relPath(root, join(dir, f))}`); bad++; }
    }
  console.log(`${n} frozen posting${n === 1 ? '' : 's'} checked, ${bad} changed file${bad === 1 ? '' : 's'}`);
  if (bad) process.exitCode = 1;
}

const args = process.argv.slice(2);
if (args[0] === '--check') check();
else if (args[0]) freeze(args[0], args[1]);
else console.error('Usage: node <plugin>/tools/freeze.mjs <posting folder> [YYYY-MM-DD] | --check');
