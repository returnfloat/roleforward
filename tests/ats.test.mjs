// The ATS-style check (ats.mjs) and the PDF text reader behind it (pdftext.mjs). The reader is tested on a small PDF
// built here, so it runs everywhere. The end-to-end checks render the fixture resume, so they need Chrome, Chromium,
// Edge, or Brave, and are skipped with a note when none is installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { pdfText } from '../plugins/roleforward/tools/pdftext.mjs';
import { findChrome } from '../plugins/roleforward/tools/workspace.mjs';
import { buildWorkspace } from './fixture.mjs';

const skip = findChrome() ? false : 'no Chrome, Chromium, Edge, or Brave on this machine';

// A one-page PDF: a simple font with literal strings, and a Type0 font with two-byte codes and a ToUnicode map, as
// Chrome writes them. Objects are numbered from 1 in the order given.
function makePdf(content) {
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfchar <0004> <FB01> endbfchar
1 beginbfrange <0001> <0003> <0041> endbfrange
endcmap end end`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Example /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>',
    { stream: deflateSync(Buffer.from(content)), dict: '/Filter /FlateDecode' },
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Example /W [1 [600 600 600 600]] /DW 500 >>',
    { stream: Buffer.from(cmap), dict: '' },
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  objs.forEach((o, i) => {
    if (typeof o === 'string') parts.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else parts.push(Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} ${o.dict} >>\nstream\n`), o.stream, Buffer.from('\nendstream\nendobj\n'));
  });
  parts.push(Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n'));
  return Buffer.concat(parts);
}

test('pdftext.mjs reads lines top to bottom, with a space only at a visible gap', () => {
  const pdf = makePdf(`
BT /F1 12 Tf 1 0 0 1 72 700 Tm (Test Candidate) Tj ET
BT /F1 10 Tf 1 0 0 1 400 660 Tm (Example City) Tj ET
BT /F1 10 Tf 1 0 0 1 72 660 Tm (Data Engineer) Tj ET
BT /F1 10 Tf 1 0 0 1 72 680 Tm (Employer A) Tj ET
BT /F2 10 Tf 1 0 0 1 72 640 Tm <000100020003> Tj ET
BT /F1 10 Tf 1 0 0 1 72 620 Tm [(Wor) -50 (k)] TJ ET
BT /F1 10 Tf 1 0 0 1 72 600 Tm [(two) -600 (words)] TJ ET
q .5 0 0 .5 0 0 cm BT /F2 20 Tf 1 0 0 1 144 1160 Tm <0004> Tj ET Q
`);
  assert.deepEqual(pdfText(pdf).pages.map((p) => p.lines), [[
    'Test Candidate',
    'Employer A',
    'Data Engineer Example City', // two runs on one baseline, far apart: one line, with a space
    'ABC',                         // two-byte codes through the ToUnicode map
    'Work',                        // a small kerning step isn't a space
    'two words',                   // a wide one is
    'ﬁ',                      // a ligature reads as one character, which is what ats.mjs warns about
  ]]);
  assert.throws(() => pdfText(Buffer.from('not a pdf')), /Not a PDF file/);
});

test('ats.mjs: a fresh render parses cleanly, each role reads as one line, and there are no ligatures', { skip }, () => {
  const ws = buildWorkspace();
  try {
    ws.write('resume.md', ws.read('resume.md').replace('Example skill,', 'Example skill, certified workflow, exceptional planning,'));
    ws.run('render');
    const pdf = join(ws.root, 'output', 'Test-Candidate-Resume-Apply.pdf');
    const lines = pdfText(readFileSync(pdf)).pages.flatMap((p) => p.lines);
    assert.ok(lines.includes('Senior Data Engineer · Example City, ST (Hybrid) · Jan 2022 to Present'), lines.join('\n'));
    assert.match(lines.join(' '), /certified workflow, exceptional planning/);
    const out = ws.run('ats', [pdf]);
    assert.match(out, /^output\/Test-Candidate-Resume-Apply\.pdf: 1 page, \d+ words$/m);
    assert.match(out, /^ {2}ok {4}Contact: an email address and a phone number near the top\.$/m);
    assert.match(out, /^ {2}ok {4}Section headings: all \d+ read as lines of their own/m);
    assert.match(out, /^ {2}ok {4}Characters: no ligatures or unreadable glyphs\.$/m);
    assert.match(out, /^ {2}ok {4}Reading order: all \d+ lines of output\/Test-Candidate-Resume\.txt appear in the PDF's text as written\.$/m);
    assert.match(out, /Keywords: no keywords file\./);
  } finally { ws.cleanup(); }
});

test("ats.mjs: a posting's terms match as whole words, plural or not, with their context", { skip }, () => {
  const ws = buildWorkspace();
  try {
    ws.write('resume.md', ws.read('resume.md').replace('Example skill,', 'Example skill, exceptional planning,'));
    ws.run('render');
    const folder = ws.folder('employer-a');
    ws.write(`${folder}/posting.md`, ws.read(`${folder}/posting.md`).replace('resume: tbd', 'resume: resume.md'));
    ws.write(`${folder}/keywords.md`, `---\ntitle: Example terms\n---\n\n## Required\n- data engineer\n- example-city | example town\n- policy as code\n\n## Preferred\n- exception | risk acceptance\n- Example skills\n`);
    const out = ws.run('ats', [join(ws.root, folder)]);
    assert.match(out, /^output\/Test-Candidate-Resume-Apply\.pdf: /m, "the posting's resume: field picks the default resume's PDF");
    assert.match(out, /^ {2}Required: 2 of 3$/m);
    assert.match(out, /^ {4}found {4}data engineer \(\d+\): "[^"]*data engineer[^"]*"$/m);
    assert.match(out, /^ {4}found {4}example-city \| example town \(\d+\)/m, 'a hyphen and a space are the same');
    assert.match(out, /^ {4}MISSING {2}policy as code$/m);
    assert.match(out, /^ {2}Preferred: 1 of 2$/m);
    assert.match(out, /^ {4}MISSING {2}exception \| risk acceptance$/m, '"exceptional" is a different word');
    assert.match(out, /^ {4}found {4}Example skills \(\d+\)/m, 'a plural term matches the singular in the text');
    ws.write(`${folder}/posting.md`, ws.read(`${folder}/posting.md`).replace('resume: resume.md', 'resume: tbd'));
    assert.match(ws.fails('ats', [join(ws.root, folder)]).out, /has no resume chosen yet \(resume: tbd\)/);
  } finally { ws.cleanup(); }
});
