#!/usr/bin/env node
// Renders the workspace's default resume (workspace.yaml files.resume) into:
//   output/<stem>-Resume.txt         plain-text copy for application forms (with phone and email)
//   output/<stem>-Resume-Apply.pdf   application copy (includes email and phone)
//   website/index.html               the personal site, from the workspace's site template (no phone, email assembled on click)
//   website/<stem>-Resume.pdf        web copy (no email or phone, so crawlers can't scrape them from the PDF)
// <stem> is workspace.yaml person.file_stem. The website files are written only when website.enabled is true.
// Usage: node <plugin>/tools/render.mjs   (run from inside the workspace; needs Chrome, Chromium, Edge, or Brave, and no npm packages)
//        node <plugin>/tools/render.mjs <variant-or-job>.md   renders only that resume's PDF and .txt, never the website

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { loadWorkspace, palette, PLUGIN, findChrome, CHROME_HELP, relPath } from './workspace.mjs';

const { root, get } = loadWorkspace();
const PALETTE = palette(get);
const CHROME_PATH = findChrome(get);
// Runs Chrome headless, or stops with what to install when there's none.
function chrome(args) {
  if (!CHROME_PATH || !existsSync(CHROME_PATH)) {
    console.error(CHROME_PATH ? `Chrome not found at ${CHROME_PATH} (render.chrome in workspace.yaml). ${CHROME_HELP}` : `No Chrome found. ${CHROME_HELP}`);
    process.exit(1);
  }
  execFileSync(CHROME_PATH, ['--headless', '--disable-gpu', ...args], { stdio: 'ignore' });
}
const STEM = get('person.file_stem') + '-Resume';
const PDF_NAME = STEM + '.pdf';
const APPLY_PDF_NAME = STEM + '-Apply.pdf'; // distinct name so it's never mistaken for the web copy
const DEFAULT_RESUME = join(root, get('files.resume'));
const MAX_PAGES = get('render.max_pages', 2);
// The workspace's own site template if it has one, else the plugin's generic template.
const workspaceTemplate = get('website.template') && join(root, get('website.template'));
const SITE_TEMPLATE = workspaceTemplate && existsSync(workspaceTemplate) ? workspaceTemplate : join(PLUGIN, 'templates', 'site-template.html');

// ---------- parse ----------

function parse(md) {
  md = md.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '');
  const r = { sections: [] };
  let section = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^# (.+)/))) r.name = m[1];
    else if ((m = line.match(/^## (.+)/))) r.sections.push((section = { title: m[1], blocks: [] }));
    else if ((m = line.match(/^### (.+)/))) section.blocks.push({ type: 'company', text: m[1] });
    else if ((m = line.match(/^- \*\*(.+?):\*\* (.+)/))) section.blocks.push({ type: 'bullet', label: m[1], text: m[2] });
    else if ((m = line.match(/^- (.+)/))) section.blocks.push({ type: 'bullet', text: m[1] });
    else if (!section && (m = line.match(/^\*\*(.+)\*\*$/))) r.headline = m[1];
    else if ((m = line.match(/^\*\*(.+?)\*\* · (.+)/))) section.blocks.push({ type: 'role', title: m[1], meta: m[2] });
    else if (!section && !r.contact) r.contact = line.split(' · ');
    else section.blocks.push({ type: 'p', text: line });
  }
  return r;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const section = (r, title) => r.sections.find((s) => s.title === title);

// A role's title, place, and dates as one line of text ("Title · Place · Dates"), so a resume parser or screen reader
// reads them apart. Two spans laid out left and right extract as "Title Place", run together.
const roleLine = (b) => `<div class="role"><span class="title">${esc(b.title)}</span><span class="meta"> · ${esc(b.meta)}</span></div>`;

// ---------- print HTML (single column, ATS-friendly text PDF) ----------

const isPhone = (c) => /^\+?[\d\s().-]{7,}$/.test(c);

function printHtml(r, { includePrivate }) {
  const contact = r.contact.filter((c) => includePrivate || !(c.includes('@') || isPhone(c)));
  const body = r.sections.map((s) => {
    let out = `<h2>${esc(s.title)}</h2>`, list = false;
    for (const b of s.blocks) {
      if (b.type !== 'bullet' && list) { out += '</ul>'; list = false; }
      if (b.type === 'bullet' && !list) { out += '<ul>'; list = true; }
      if (b.type === 'p') out += `<p>${esc(b.text)}</p>`;
      if (b.type === 'company') out += `<h3>${esc(b.text)}</h3>`;
      if (b.type === 'role') out += roleLine(b);
      if (b.type === 'bullet') out += `<li>${b.label ? `<strong>${esc(b.label)}:</strong> ` : ''}${esc(b.text)}</li>`;
    }
    return out + (list ? '</ul>' : '');
  }).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.name)} Resume</title>
<style>
@page { size: Letter; margin: 0.55in 0.65in; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.38; color: #1a1a1a; margin: 0;
  font-variant-ligatures: none; } /* a ligature is one glyph for "fi", which a resume parser can read as an unknown letter */
h1 { font-size: 21pt; margin: 0 0 2pt; letter-spacing: 0.2pt; }
.contact { color: #444; margin-bottom: 5pt; }
.contact a { color: #0b4f6c; text-decoration: none; }
.headline { font-weight: 600; color: #0b4f6c; margin-bottom: 4pt; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.8pt; color: #0b4f6c; border-bottom: 1px solid #b9c7cf; padding-bottom: 2pt; margin: 11pt 0 5pt; }
h3 { font-size: 11pt; font-weight: 700; color: #1a1a1a; margin: 9pt 0 1.5pt; break-after: avoid; }
.role { break-after: avoid; }
.role .title { color: #0b4f6c; font-weight: 500; }
.role .meta { color: #555; }
p { margin: 0 0 4pt; }
ul { margin: 3pt 0 4pt; padding-left: 14pt; }
li { margin-bottom: 2.5pt; break-inside: avoid; }
</style></head><body>
<h1>${esc(r.name)}</h1>
<div class="contact">${contact.map(link).join(' &nbsp;·&nbsp; ')}</div>
<div class="headline">${esc(r.headline)}</div>
${body}
</body></html>`;
}

// Contact items become live links in the PDF (Chrome keeps anchors as clickable annotations).
function link(item) {
  const href = item.includes('@') ? `mailto:${item}`
    : isPhone(item) ? `tel:${item.replace(/[^\d+]/g, '')}`
    : /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(item) ? `https://${item.startsWith('linkedin.com') ? 'www.' : ''}${item}`
    : null;
  return href ? `<a href="${esc(href)}">${esc(item)}</a>` : esc(item);
}

function toPdf(html, outPath) {
  const tmp = join(root, 'output', '.print.html');
  mkdirSync(dirname(tmp), { recursive: true }); // a per-job resume can be rendered before the default ever was
  writeFileSync(tmp, html);
  chrome(['--no-pdf-header-footer', `--print-to-pdf=${outPath}`, pathToFileURL(tmp).href]);
  // For tests: ROLEFORWARD_KEEP_PRINT=<folder> keeps the exact HTML each PDF was printed from.
  if (process.env.ROLEFORWARD_KEEP_PRINT) copyFileSync(tmp, join(process.env.ROLEFORWARD_KEEP_PRINT, basename(outPath) + '.html'));
  rmSync(tmp);
}

// ---------- website ----------

// Website competency chips use Title Case ("Attack-Surface Management"). Acronyms such as SDLC,
// CI/CD, and C/C++ keep their casing, and short joining words stay lowercase.
const SMALL_WORDS = new Set(['and', 'of', 'to', 'for', 'in', 'on', 'the', 'a']);
const titleCase = (text) => text.split(' ').map((word, i) => word.split('-').map((part) =>
  /[A-Z]/.test(part.slice(1)) || (SMALL_WORDS.has(part) && i > 0) ? part : part.charAt(0).toUpperCase() + part.slice(1)
).join('-')).join(' ');

// The section names a resume may use for each part of the site. The first name in each list is the template's default.
// Any other section (Projects, Publications, Open Source...) goes to the template's {{EXTRA_SECTIONS}} slot.
const SITE_SECTIONS = {
  SUMMARY: ['Summary', 'Profile', 'About'],
  COMPETENCIES: ['Core Competencies', 'Skills', 'Technical Skills', 'Skills & Tools', 'Clinical Skills', 'Areas of Expertise', 'Core Skills'],
  EXPERIENCE: ['Work Experience', 'Experience', 'Professional Experience', 'Clinical Experience', 'Teaching Experience', 'Relevant Experience'],
  EDUCATION: ['Education & Recognition', 'Education', 'Education & Certifications'],
};
const KNOWN_SECTIONS = Object.values(SITE_SECTIONS).flat();

// Groups blocks under their ### headings (employers, or projects), each with its role lines and bullets in order.
// Blocks before the first ### heading form a group without one.
function groupedHtml(blocks) {
  const groups = [];
  for (const b of blocks) {
    if (b.type === 'company') groups.push({ company: b.text, items: [] });
    else (groups.at(-1) ?? groups[groups.push({ items: [] }) - 1]).items.push(b);
  }
  return groups.map((j) => {
    let html = `<article class="job">${j.company ? `<h3 class="company">${esc(j.company)}</h3>` : ''}`, list = false;
    for (const b of j.items) {
      if (b.type !== 'bullet' && list) { html += '</ul>'; list = false; }
      if (b.type === 'bullet' && !list) { html += '<ul>'; list = true; }
      if (b.type === 'role') html += roleLine(b);
      if (b.type === 'p') html += `<p>${esc(b.text)}</p>`;
      if (b.type === 'bullet') html += `<li>${b.label ? `<strong>${esc(b.label)}:</strong> ` : ''}${esc(b.text)}</li>`;
    }
    return html + (list ? '</ul>' : '') + '</article>';
  }).join('\n');
}

function siteHtml(r, template = SITE_TEMPLATE) {
  const part = (key) => r.sections.find((s) => SITE_SECTIONS[key].includes(s.title));
  const blocks = (key) => part(key)?.blocks ?? [];
  const summary = blocks('SUMMARY').map((b) => `<p>${esc(b.text)}</p>`).join('');

  const comps = blocks('COMPETENCIES').map((b) =>
    `<div class="comp">${b.label ? `<h3>${esc(b.label)}</h3>` : ''}<ul>${b.text.replace(/\.$/, '').split(/, (?![^()]*\))/)
      .map((t) => `<li>${esc(titleCase(t))}</li>`).join('')}</ul></div>`).join('');

  const experience = groupedHtml(blocks('EXPERIENCE'));

  const education = blocks('EDUCATION').map((b) =>
    b.label ? `<li><strong>${esc(b.label)}</strong><span>${esc(b.text)}</span></li>` : `<li><span>${esc(b.text)}</span></li>`).join('');

  const extras = r.sections.filter((s) => !KNOWN_SECTIONS.includes(s.title));
  const extraSections = extras.map((s) => `<section class="extra"><h2>${esc(s.title)}</h2>${groupedHtml(s.blocks)}</section>`).join('\n');
  if (extras.length && !readFileSync(template, 'utf8').includes('{{EXTRA_SECTIONS}}'))
    console.warn(`Website: ${relPath(root, template)} has no {{EXTRA_SECTIONS}} slot, so these sections aren't on the site: ${extras.map((s) => s.title).join(', ')}`);

  // The email never appears as text in the page. It ships as shifted char codes and is
  // assembled by a click handler, which keeps it away from scrapers that don't run JS or click.
  const email = r.contact.find((c) => c.includes('@'));
  const emailCodes = JSON.stringify([...email].map((c) => c.charCodeAt(0) + 7));

  const fill = { NAME: r.name, HEADLINE: r.headline, TAGLINE: r.headline.split(' · ').slice(-1)[0] };
  // Site details for the generic template, from workspace.yaml website.* (a workspace's own template may not use them).
  const [first, ...rest] = r.name.split(' ');
  const site = { SITE_ROLE: get('website.site_role'), DESCRIPTION: get('website.description'), JOB_TITLE: get('website.job_title'),
    LOCATION: get('website.location'), LINKEDIN: get('website.linkedin'), GITHUB: get('website.github'), URL: get('website.url'), DOMAIN: get('website.domain'),
    FIRST_NAME: first, LAST_NAME: rest.join(' '), PRIMARY: PALETTE.primary, ACCENT: PALETTE.accent };
  let page = readFileSync(template, 'utf8');
  if (!site.LINKEDIN) page = page.replace(/[^\n]*\{\{LINKEDIN\}\}[^\n]*LinkedIn<\/a>[^\n]*\n/, '');
  // Structured data for search engines (schema.org ProfilePage), built from website.* so each part shows only when set.
  const list = (k) => [].concat(get(k, []) || []).filter(Boolean);
  const address = Object.fromEntries([['addressLocality', get('website.address_locality') || site.LOCATION], ['addressRegion', get('website.address_region')], ['addressCountry', get('website.address_country')]].filter(([, v]) => v));
  const person = { '@type': 'Person', name: r.name, url: site.URL || undefined, jobTitle: site.JOB_TITLE || undefined,
    worksFor: get('website.works_for') ? { '@type': 'Organization', name: get('website.works_for') } : undefined,
    address: Object.keys(address).length ? { '@type': 'PostalAddress', ...address } : undefined,
    alumniOf: list('website.alumni_of').length ? list('website.alumni_of').map((n) => ({ '@type': 'CollegeOrUniversity', name: n })) : undefined,
    knowsAbout: list('website.knows_about').length ? list('website.knows_about') : undefined,
    sameAs: [site.LINKEDIN, site.GITHUB].filter(Boolean).length ? [site.LINKEDIN, site.GITHUB].filter(Boolean) : undefined };
  const profileData = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ProfilePage', url: site.URL || undefined, mainEntity: person }).replace(/</g, '\\u003c');
  page = page.replace('{{PROFILE_DATA}}', () => profileData);
  if (!site.GITHUB) page = page.replace(/[^\n]*\{\{GITHUB\}\}[^\n]*GitHub<\/a>[^\n]*\n/, '');
  page = page.replace(/\{\{(SITE_ROLE|DESCRIPTION|JOB_TITLE|LOCATION|LINKEDIN|GITHUB|URL|DOMAIN|FIRST_NAME|LAST_NAME|PRIMARY|ACCENT)\}\}/g, (_, k) => esc(String(site[k] ?? '')));
  // A part the resume doesn't have (many leave out a summary) drops the template lines that would show it empty.
  for (const [key, html] of Object.entries({ SUMMARY: summary, COMPETENCIES: comps, EDUCATION: education }))
    if (!html) page = page.replace(new RegExp(`[^\\n]*\\{\\{${key}\\}\\}[^\\n]*\\n`, 'g'), '');
  // Section titles for the generic template, taken from the resume (Skills instead of Core Competencies, say).
  const titles = { COMPETENCIES_TITLE: part('COMPETENCIES')?.title ?? '', EDUCATION_TITLE: part('EDUCATION')?.title ?? '' };
  page = page.replace(/\{\{(COMPETENCIES_TITLE|EDUCATION_TITLE)\}\}/g, (_, k) => esc(titles[k]))
    .replace(/[^\n]*\{\{EXTRA_SECTIONS\}\}[^\n]*\n/, (line) => (extraSections ? line.replace('{{EXTRA_SECTIONS}}', () => extraSections) : ''));
  return page
    .replace('{{EMAIL_CODES}}', emailCodes)
    .replace(/\{\{(NAME|HEADLINE|TAGLINE)\}\}/g, (_, k) => esc(fill[k]))
    .replace('{{SUMMARY}}', summary)
    .replaceAll('{{COMPETENCIES}}', comps)
    .replace('{{EXPERIENCE}}', experience)
    .replace('{{EDUCATION}}', education)
    .replaceAll('{{PDF}}', PDF_NAME)
    .replace('{{YEAR}}', String(new Date().getFullYear()));
}

// ---------- plain text (for pasting into application forms) ----------

// ASCII only, one line per bullet (forms reflow text themselves), "|" instead of "·", and "-"
// bullets, since many applicant-tracking text boxes mangle Unicode and rich formatting.
function plainText(r) {
  const ascii = (s) => s.replace(/ · /g, ' | ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const out = [r.name.toUpperCase(), ascii(r.contact.join(' · ')), ascii(r.headline), ''];
  for (const s of r.sections) {
    out.push(s.title.toUpperCase(), '');
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(ascii(b.text), '');
      if (b.type === 'company') { if (out.at(-1) !== '') out.push(''); out.push(b.text.toUpperCase()); }
      if (b.type === 'role') { if (out.at(-1).startsWith('- ')) out.push(''); out.push(`${b.title} | ${ascii(b.meta)}`); }
      if (b.type === 'bullet') out.push(`- ${b.label ? b.label + ': ' : ''}${ascii(b.text)}`);
    }
    if (out.at(-1) !== '') out.push('');
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const bad = [...new Set(text.match(/[^\x00-\x7F]/g) || [])];
  if (bad.length) throw new Error('Non-ASCII characters in plain-text resume: ' + bad.join(' '));
  return text;
}

// ---------- website extras (SEO, icons, sharing card, 404) ----------

const SITE = get('website.url');
const DOMAIN = get('website.domain');

function screenshot(html, out, w, h) {
  const tmp = join(root, 'website', '.shot.html');
  writeFileSync(tmp, html);
  chrome(['--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(tmp).href]);
  rmSync(tmp);
}

function siteExtras(r, dir) {
  const navy = PALETTE.primary, gold = PALETTE.accent;
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${navy}"/><text x="32" y="42" font-family="Helvetica,Arial,sans-serif" font-size="28" font-weight="700" fill="${gold}" text-anchor="middle">${esc(get('website.initials'))}</text></svg>`;
  writeFileSync(join(dir, 'favicon.svg'), iconSvg);

  // PNG icons for search results and home screens, drawn by Chrome at their final size.
  // Square corners: iOS and Android apply their own rounding mask to home-screen icons.
  for (const [name, size] of [['icon-192.png', 192], ['apple-touch-icon.png', 180]])
    screenshot(`<body style="margin:0">${iconSvg.replace('<svg ', `<svg width="${size}" height="${size}" `).replace(' rx="14"', '')}</body>`, join(dir, name), size, size);

  // 1200x630 card shown when the link is shared on LinkedIn, Slack, iMessage, and so on.
  const lines = r.headline.split(' · ').map((l) => `<div>${esc(l)}</div>`).join('');
  screenshot(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:${navy};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;border-left:14px solid ${gold}">
<div style="color:${gold};font-size:24px;letter-spacing:4px;text-transform:uppercase;margin-bottom:22px">${esc(DOMAIN)}</div>
<div style="color:#fff;font-size:84px;font-weight:700;letter-spacing:-1.5px;margin-bottom:26px">${esc(r.name)}</div>
<div style="color:#c4d1df;font-size:32px;line-height:1.45">${lines}</div>
<div style="color:${gold};font-size:24px;letter-spacing:2px;margin-top:34px">${esc(get('website.location_line'))}</div>
</body></html>`, join(dir, 'og-image.png'), 1200, 630);

  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
  writeFileSync(join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>
</urlset>
`);
  writeFileSync(join(dir, '404.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>404 · ${esc(r.name)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${navy};color:#eef2f6;font:16px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;text-align:center;padding:16px}
h1{font-size:56px;letter-spacing:2px;margin:0 0 8px}p{color:#9fb2c8;margin:0 0 24px}a{display:inline-block;background:${gold};color:${navy};font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px}</style>
</head><body><main><h1>404</h1><p>The content you requested was not found.</p><a href="/">Go to ${esc(DOMAIN)}</a></main></body></html>
`);
}

// ---------- main ----------

// Chrome writes an uncompressed page tree, so the root /Count is the page count.
function checkPages(pdfPath) {
  const pages = Math.max(...[...readFileSync(pdfPath, 'latin1').matchAll(/\/Count (\d+)/g)].map((m) => +m[1]));
  console.log(`${relPath(root, pdfPath)}: ${pages} page${pages === 1 ? '' : 's'}`);
  if (pages > MAX_PAGES) { console.error(`Over ${MAX_PAGES} pages. Trim before using this resume.`); process.exitCode = 1; }
}

// `node <plugin>/tools/render.mjs <file.md>` renders a variant or per-job resume: application PDF and
// plain text only, never the website. variants/<name>.md goes to output/variants/, and
// applications/.../resume.md goes next to its source. A frozen (already submitted) resume is refused.
const variantArg = process.argv.slice(2).find((a) => a.endsWith('.md'));

if (variantArg) {
  // The real path, like the workspace root's, so a path through a symlink is still recognized as the default resume.
  const src = realpathSync(resolve(variantArg));
  if (src === DEFAULT_RESUME) throw new Error('That is the default resume. Run without a file argument.');
  const md = readFileSync(src, 'utf8');
  const frozen = (md.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '').match(/^frozen: *(.+)$/m);
  if (frozen) throw new Error(`${relPath(root, src)} was frozen on ${frozen[1]} (submitted). Copy it to a new posting folder instead of re-rendering.`);
  const resume = parse(md);
  const name = basename(src, '.md');
  const [dir, stem] = name === 'resume'
    ? [dirname(src), STEM]
    : [join(root, 'output', 'variants'), STEM + '-' + name.replace(/(^|-)(\w)/g, (_, d, c) => d + c.toUpperCase())];
  mkdirSync(dir, { recursive: true });
  toPdf(printHtml(resume, { includePrivate: true }), join(dir, stem + '.pdf'));
  writeFileSync(join(dir, stem + '.txt'), plainText(resume));
  console.log(`Wrote ${relPath(root, join(dir, stem))}.pdf and .txt (website untouched)`);
  checkPages(join(dir, stem + '.pdf'));
  process.exit();
}

const resume = parse(readFileSync(DEFAULT_RESUME, 'utf8'));
const WEBSITE = get('website.enabled', false) === true;
mkdirSync(join(root, 'output'), { recursive: true });

toPdf(printHtml(resume, { includePrivate: true }), join(root, 'output', APPLY_PDF_NAME));
writeFileSync(join(root, 'output', STEM + '.txt'), plainText(resume));
if (WEBSITE) {
  mkdirSync(join(root, 'website'), { recursive: true });
  toPdf(printHtml(resume, { includePrivate: false }), join(root, 'website', PDF_NAME));
  writeFileSync(join(root, 'website', 'index.html'), siteHtml(resume));
  siteExtras(resume, join(root, 'website'));
}
console.log('Wrote output/' + APPLY_PDF_NAME + ', output/' + STEM + '.txt' + (WEBSITE ? ', website/index.html, website/' + PDF_NAME + ', plus icons, og-image, robots, sitemap, 404' : ' (website module off)'));
checkPages(join(root, 'output', APPLY_PDF_NAME));

// `--previews` also renders every design in the workspace's website.themes folder into previews/ (HTML plus desktop and
// phone screenshots),
// so alternatives can be compared without touching the live website/ folder.
if (WEBSITE && process.argv.includes('--previews')) {
  const themes = join(root, get('website.themes', 'site/themes')), out = join(root, 'previews');
  mkdirSync(out, { recursive: true });
  copyFileSync(join(root, 'website', PDF_NAME), join(out, PDF_NAME));
  for (const f of readdirSync(themes).filter((f) => f.endsWith('.html'))) {
    const html = siteHtml(resume, join(themes, f));
    writeFileSync(join(out, f), html);
    // Screenshots at desktop and phone width, so design options can be compared as images.
    const stem = f.replace(/\.html$/, '');
    screenshot(html, join(out, `${stem}-desktop.png`), 1280, 900);
    screenshot(html, join(out, `${stem}-phone.png`), 390, 844);
    console.log(`Wrote previews/${f}, ${stem}-desktop.png, ${stem}-phone.png`);
  }
}
