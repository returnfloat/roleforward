// The resume render (render.mjs): the application PDF and .txt, the website copies, and variants. These need Chrome,
// Chromium, Edge, or Brave, and are skipped with a note when none is installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome } from '../plugins/roleforward/tools/workspace.mjs';
import { buildWorkspace } from './fixture.mjs';

const skip = findChrome() ? false : 'no Chrome, Chromium, Edge, or Brave on this machine';
const pages = (file) => Math.max(...[...readFileSync(file, 'latin1').matchAll(/\/Count (\d+)/g)].map((m) => +m[1]));

test('the default render writes the application PDF and .txt, and the website without phone or email', { skip }, () => {
  const ws = buildWorkspace({ website: true });
  try {
    const out = ws.run('render');
    assert.match(out, /output\/Test-Candidate-Resume-Apply\.pdf: 1 page/);
    assert.equal(pages(join(ws.root, 'output', 'Test-Candidate-Resume-Apply.pdf')), 1);

    const txt = ws.read('output/Test-Candidate-Resume.txt');
    assert.match(txt, /^TEST CANDIDATE\nExample City, ST \| 000-000-0000 \| candidate@example\.invalid\n/);
    assert.match(txt, /^- Pipeline Speed: Cut example pipeline run time by 40%/m);
    assert.doesNotMatch(txt, /[^\x00-\x7F]/);

    const site = ws.read('website/index.html');
    assert.doesNotMatch(site, /000-000-0000|candidate@example\.invalid/);
    assert.match(site, /Test Candidate/);
    assert.match(site, /<div class="role"><span class="title">Senior Data Engineer<\/span><span class="meta"> · Example City, ST \(Hybrid\) · Jan 2022 to Present<\/span><\/div>/, 'one line of text per role');
    for (const f of ['Test-Candidate-Resume.pdf', 'favicon.svg', 'og-image.png', 'robots.txt', 'sitemap.xml', '404.html'])
      assert.ok(existsSync(join(ws.root, 'website', f)), f);
    assert.match(ws.read('website/sitemap.xml'), /<loc>https:\/\/example\.invalid\/<\/loc>/);
  } finally { ws.cleanup(); }
});

test('the website copy of the PDF leaves out phone and email', { skip }, () => {
  const ws = buildWorkspace({ website: true });
  try {
    const keep = join(ws.root, 'kept');
    ws.write('kept/.keep', '');
    ws.run('render', [], { env: { ROLEFORWARD_KEEP_PRINT: keep } });
    const web = readFileSync(join(keep, 'Test-Candidate-Resume.pdf.html'), 'utf8');
    const apply = readFileSync(join(keep, 'Test-Candidate-Resume-Apply.pdf.html'), 'utf8');
    assert.doesNotMatch(web, /000-000-0000|candidate@example\.invalid/);
    assert.match(apply, /000-000-0000/);
    assert.match(apply, /mailto:candidate@example\.invalid/);
  } finally { ws.cleanup(); }
});

test('with the website module off, website/ is never written', { skip }, () => {
  const ws = buildWorkspace();
  try {
    assert.match(ws.run('render'), /\(website module off\)/);
    assert.equal(existsSync(join(ws.root, 'website')), false);
  } finally { ws.cleanup(); }
});

test('a non-ASCII character in the resume stops the plain-text copy', { skip }, () => {
  const ws = buildWorkspace();
  try {
    ws.write('resume.md', ws.read('resume.md').replace('Example skill,', 'Example skill — with a dash,'));
    const r = ws.fails('render');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Non-ASCII characters in plain-text resume: —/);
  } finally { ws.cleanup(); }
});

test('a variant renders to output/variants and leaves the website alone', { skip }, () => {
  const ws = buildWorkspace({ website: true });
  try {
    ws.write('variants/leadership.md', ws.read('resume.md').replace('Resume (default)', 'Resume (leadership)'));
    assert.match(ws.run('render', [join(ws.root, 'variants', 'leadership.md')]), /Wrote output\/variants\/Test-Candidate-Resume-Leadership\.pdf and \.txt \(website untouched\)/);
    assert.ok(existsSync(join(ws.root, 'output', 'variants', 'Test-Candidate-Resume-Leadership.txt')));
    assert.equal(existsSync(join(ws.root, 'website')), false);
  } finally { ws.cleanup(); }
});

test('a frozen resume is refused, and so is the default passed as a variant', { skip }, () => {
  const ws = buildWorkspace();
  try {
    const f = `${ws.folder('employer-c')}/resume.md`;
    ws.write(f, ws.read('resume.md').replace('reviewed:', 'frozen: 2026-01-01\nreviewed:'));
    assert.match(ws.fails('render', [join(ws.root, f)]).out, /was frozen on 2026-01-01 \(submitted\)/);
    assert.match(ws.fails('render', [join(ws.root, 'resume.md')]).out, /That is the default resume/);
  } finally { ws.cleanup(); }
});

test('a resume over render.max_pages fails the render', { skip }, () => {
  const ws = buildWorkspace();
  try {
    ws.write('workspace.yaml', ws.read('workspace.yaml').replace('max_pages: 2', 'max_pages: 0'));
    const r = ws.fails('render');
    assert.equal(r.status, 1);
    assert.match(r.out, /Over 0 pages\. Trim before using this resume\./);
  } finally { ws.cleanup(); }
});

test('the website knows non-tech names for the experience and skills sections', { skip }, () => {
  const ws = buildWorkspace({ website: true });
  try {
    ws.write('resume.md', ws.read('resume.md').replace('## Work Experience', '## Clinical Experience').replace('## Core Competencies', '## Clinical Skills'));
    ws.run('render');
    const site = ws.read('website/index.html');
    assert.match(site, /<div class="comps"><h2>Clinical Skills<\/h2>/, 'the skills sidebar, under its own heading');
    assert.match(site, /<h2>Experience<\/h2><article class="job"><h3 class="company">Employer Y/, 'the main experience section');
    assert.doesNotMatch(site, /Clinical Experience/, 'not an extra section');
  } finally { ws.cleanup(); }
});
