#!/usr/bin/env node
// An ATS-style check of a resume PDF: reads its text the way an applicant tracking system's parser does, then checks
// the posting's terms against that text. It reads only local files and changes nothing.
//   node tools/ats.mjs applications/<company>/<YYYY-MM-DD-role>    the resume that posting.md's `resume:` names
//   node tools/ats.mjs <file.pdf> [--terms <keywords.md>]           any PDF
//
// Parsing checks:
//   - the text layer: pages and words found
//   - the contact line: an email address and a phone number near the top
//   - section headings: each of the resume's own "## " headings reads as a line of its own
//   - characters a parser can mangle: ligatures (one glyph for "fi"), and glyphs with no text behind them
//   - every line of the plain-text copy render.mjs wrote (.txt) appears in the PDF's text as written
// Keyword check, when there's a keywords.md (in the posting folder, or --terms): each "## " heading is a group (for
// example Required and Preferred), and each "- " line is a term, with alternatives after " | ":
//   ## Required
//   - threat modeling | threat model
//   - CI/CD
// A term matches as whole words, in any letter case, plural or not, with a hyphen and a space counted as the same.
// Each match is printed with its context, so a wrong match is easy to spot.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pdfText } from './pdftext.mjs';
import { readFrontmatter } from './frontmatter.mjs';
import { loadWorkspace, relPath, resumeFiles } from './workspace.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args.splice(i, 2)[1]; };
const termsArg = flag('--terms');
const target = args[0];
if (!target) {
  console.error('Usage: ats.mjs <posting folder> | <file.pdf> [--terms <keywords.md>]');
  process.exit(1);
}

const { root, get } = loadWorkspace();
const shown = (p) => relPath(root, p);
let pdf, txt, md, terms = termsArg && resolve(termsArg);
const abs = resolve(target);
if (abs.endsWith('.pdf')) {
  pdf = abs;
  if (existsSync(abs.replace(/(-Apply)?\.pdf$/, '.txt'))) txt = abs.replace(/(-Apply)?\.pdf$/, '.txt');
} else {
  const posting = join(abs, 'posting.md');
  if (!existsSync(posting)) { console.error(`No posting.md in ${shown(abs)}.`); process.exit(1); }
  const { data } = readFrontmatter(posting);
  if (!data.resume || data.resume === 'tbd') { console.error(`${shown(posting)} has no resume chosen yet (resume: ${data.resume || 'empty'}).`); process.exit(1); }
  ({ pdf, txt, md } = resumeFiles(root, get, data.resume, abs, Boolean(data.frozen)));
  terms ??= join(abs, 'keywords.md');
}
if (!existsSync(pdf)) { console.error(`${shown(pdf)} doesn't exist. Render it first.`); process.exit(1); }
// The Markdown source, for the headings check: a posting's resume.md, or the default resume for a PDF in output/.
md ??= txt && existsSync(join(dirname(txt), 'resume.md')) ? join(dirname(txt), 'resume.md')
  : dirname(pdf) === join(root, 'output') ? join(root, get('files.resume')) : undefined;

const { pages } = pdfText(readFileSync(pdf));
const lines = pages.flatMap((p) => p.lines);
const text = lines.join('\n');
const words = text.split(/\s+/).filter(Boolean).length;
console.log(`${shown(pdf)}: ${pages.length} page${pages.length === 1 ? '' : 's'}, ${words} words\n\nParsing`);

const report = (ok, msg) => console.log(`  ${ok === true ? 'ok  ' : ok === false ? 'FIX ' : 'note'}  ${msg}`);
report(words > 50, words > 50 ? 'Text layer: the PDF holds real text, not an image.' : 'Text layer: almost no text found. A parser sees an empty resume.');

const top = lines.slice(0, 4).join(' ');
const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(top), phone = /\+?\d[\d ().-]{7,}\d/.test(top);
report(email && phone ? true : null, email && phone ? 'Contact: an email address and a phone number near the top.'
  : `Contact: no ${[!email && 'email address', !phone && 'phone number'].filter(Boolean).join(' or ')} near the top. Fine for a web copy, but an application copy needs both.`);

// Text normalized for comparing: letter case, spacing, the separators render.mjs uses (" · " in the PDF, " | " in
// the .txt), and typographic quotes and dashes.
const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s*[·|]\s*/g, ' | ').replace(/\s+/g, ' ').trim();

if (md && existsSync(md)) {
  const headings = [...readFileSync(md, 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const lineSet = new Set(lines.map(norm));
  const missing = headings.filter((h) => !lineSet.has(norm(h)));
  report(!missing.length || null, missing.length ? `Section headings: ${missing.join(', ')} ${missing.length === 1 ? "doesn't" : "don't"} read as a line of its own.`
    : `Section headings: all ${headings.length} read as lines of their own (${headings.join(', ')}).`);
}

const ligatures = [...new Set(text.match(/[ﬀ-ﬆ]/g) ?? [])];
const unmapped = (text.match(/[�-]/g) ?? []).length;
report(!ligatures.length && !unmapped || false, ligatures.length || unmapped
  ? [ligatures.length && `Characters: ligatures (${ligatures.join(' ')}) stand for letter pairs, so a parser may miss words that contain them. Re-render with the current plugin, which turns them off.`,
    unmapped && `Characters: ${unmapped} glyph${unmapped === 1 ? ' has' : 's have'} no text behind ${unmapped === 1 ? 'it' : 'them'}.`].filter(Boolean).join(' ')
  : 'Characters: no ligatures or unreadable glyphs.');

if (txt && existsSync(txt)) {
  const flat = ` ${norm(text.replace(/\n/g, ' '))} `;
  const want = readFileSync(txt, 'utf8').split('\n').map((l) => l.replace(/^- /, '')).filter((l) => l.trim());
  const lost = want.filter((l) => !flat.includes(norm(l)));
  report(!lost.length || false, lost.length ? `Reading order: ${lost.length} of ${want.length} lines of ${shown(txt)} don't appear in the PDF's text as written:`
    : `Reading order: all ${want.length} lines of ${shown(txt)} appear in the PDF's text as written.`);
  for (const l of lost.slice(0, 5)) console.log(`          "${l.length > 90 ? l.slice(0, 87) + '...' : l}"`);
  if (lost.length > 5) console.log(`          and ${lost.length - 5} more`);
}

if (!terms || !existsSync(terms)) {
  console.log(`\nKeywords: no ${terms ? shown(terms) : 'keywords file'}. Write the posting's terms there to check them (see the apply skill).`);
  process.exit();
}

const groups = [];
for (const line of readFileSync(terms, 'utf8').split(/\r?\n/)) {
  const h = line.match(/^## (.+)/), t = line.match(/^- (.+)/);
  if (h) groups.push({ name: h[1].trim(), terms: [] });
  else if (t) (groups.at(-1) ?? groups[groups.push({ name: 'Terms', terms: [] }) - 1]).terms.push(t[1].split(' | ').map((x) => x.trim()).filter(Boolean));
}
const esc = (s) => s.replace(/[.*+?^${}()[\]\\]/g, '\\$&');
// A term with and without a final "s", each with an optional plural ending: "skills" finds "skill", and "access" finds
// "accesses".
const pattern = (alt) => {
  const forms = [...new Set([alt, alt.replace(/s$/i, '')])].map((f) => esc(f.toLowerCase()).replace(/[-\s]+/g, '[-\\s]+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join('|')})(?:s|es)?(?![\\p{L}\\p{N}])`, 'gu');
};
const flatText = text.replace(/\n/g, ' ').toLowerCase();

console.log(`\nKeywords (${shown(terms)})`);
for (const g of groups) {
  const results = g.terms.map((alts) => {
    const hits = alts.flatMap((a) => [...flatText.matchAll(pattern(a))]);
    return { alts, hits };
  });
  console.log(`  ${g.name}: ${results.filter((r) => r.hits.length).length} of ${results.length}`);
  for (const { alts, hits } of results) {
    if (!hits.length) { console.log(`    MISSING  ${alts.join(' | ')}`); continue; }
    const h = hits[0], from = Math.max(0, h.index - 35), to = Math.min(flatText.length, h.index + h[0].length + 35);
    console.log(`    found    ${alts.join(' | ')} (${hits.length}): "${from ? '...' : ''}${flatText.slice(from, to)}${to < flatText.length ? '...' : ''}"`);
  }
}
