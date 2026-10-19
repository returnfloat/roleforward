#!/usr/bin/env node
// Builds INDEX.md, the map of the whole workspace for the user (in Obsidian) and for any future agent, and copies the
// plugin's README.md in as the workspace's README.md, so it always describes the installed plugin.
// Core files carry descriptions from workspace.yaml. Applications, variants, and any note not listed there
// are discovered from the folder, so the index can't go stale. tracker.mjs runs this too.
// Usage: node <plugin>/tools/index.mjs   (run from inside the workspace)

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrontmatter, parseEvent } from './frontmatter.mjs';
import { loadWorkspace, PLUGIN, relPath } from './workspace.mjs';

const { root, get } = loadWorkspace();
const SKIP = new Set(['.obsidian', '.git', 'archive', 'output', 'website', 'tools', 'node_modules', 'previews', 'intake']);

// [path, description] rows come from workspace.yaml's index section ("path | description" strings), so each workspace
// describes its own files. A new workspace without one gets the defaults below.
const DEFAULT_CORE = {
  'Start Here': [
    "README.md | RoleForward's README, the same one GitHub shows: what it does and how to use it. Copied in on every run.",
    "CLAUDE.md | The user's standing instructions for Claude Code (theirs to edit).",
    'MEMORY.md | Current status, open items, and how the user likes to work.',
    'workspace.yaml | Settings the RoleForward plugin reads: names, file names, targets, screening keywords, and modules.',
  ],
  'Sources of Truth': [
    `${get('files.portfolio', 'portfolio.md')} | The only source of facts: evidence, tagged resume lines, and disclosure rules.`,
    `${get('files.guide', 'resume-writing-guide.md')} | House rules and the audit rubric.`,
    `${get('files.direction', 'career-direction.md')} | Goals, Dealbreakers, Preferences, and research notes. Personal, never published.`,
  ],
  'Resumes and Profiles': [
    `${get('files.resume', 'resume.md')} | The default resume.`,
    ...(get('linkedin.enabled', false) ? [`${get('files.linkedin', 'linkedin.md')} | Paste-ready LinkedIn copy.`] : []),
    'variants/README.md | Standing variants: what they are and how they sync.',
  ],
  'Job Search': [
    'applications/tracker.md | Generated tracker: summary, review queue, needs attention, funnel, and all postings.',
    'applications/watchlist.md | Employers /scout checks every run.',
    'applications/profile.md | Reusable answers for online application forms.',
    // The prep module is optional: listed only while workspace.yaml names its file.
    ...(get('files.interview_prep', '') ? [`${get('files.interview_prep')} | Learning path and story bank for interviews.`] : []),
  ],
};
const stem = get('person.file_stem', 'Resume');
// Folders that belong to optional modules, listed while the module is on, even under a workspace's own index.files.
const MODULE_FILES = [
  ...(get('website.enabled', false) ? ['website/ | Generated personal website. Never edit by hand.'] : []),
  ...(get('connections.enabled', false) ? ['contacts/ | LinkedIn connections from the data export (connections module). Private.'] : []),
];
const DEFAULT_FILES = [
  `output/${stem}-Resume-Apply.pdf | Application PDF of the default resume, with phone and email.`,
  `output/${stem}-Resume.txt | Plain-text default resume for pasting into application forms.`,
  'output/variants/ | Rendered standing variants (PDF and .txt).',
  'applications/data/ | Generated CSVs and scout health files.',
];
const row = (s) => { const i = s.indexOf(' | '); return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 3).trim()]; };
const cfgCore = get('index.core', null);
const CORE = Object.fromEntries(Object.entries(cfgCore && Object.keys(cfgCore).length ? cfgCore : DEFAULT_CORE).map(([h, rows]) => [h, rows.map(row)]));
const OWN = (get('index.files', null) || DEFAULT_FILES).map(row);
const FILES = [...OWN, ...MODULE_FILES.map(row).filter(([p]) => !OWN.some(([q]) => q === p))];

// Obsidian link with a readable label, plus the plain path for agents.
const link = (p, label) => p.endsWith('.md') && !p.startsWith('.')
  ? `[[${p.slice(0, -3)}|${label}]] (\`${p}\`)` : `\`${p}\``;
const titleOf = (p) => (existsSync(join(root, p)) && readFrontmatter(join(root, p)).data.title) || p;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(relPath(root, p));
  }
  return out.sort();
}

export function buildIndex() {
  // The README first, so a new workspace's first index doesn't list it as missing.
  buildReadme();
  const listed =new Set([...Object.values(CORE).flat().map(([p]) => p), 'INDEX.md']);
  const sections = Object.entries(CORE).map(([h, rows]) => `## ${h}\n\n` + rows.map(([p, d]) =>
    `- ${link(p, p.replace(/\.md$/, '').split('/').pop() === 'README' ? p.replace(/\.md$/, '') : p.replace(/\.md$/, '').split('/').pop())}${existsSync(join(root, p)) ? '' : ' **(missing)**'}: ${d}`).join('\n'));

  // Standing variants
  const variants = existsSync(join(root, 'variants')) ? readdirSync(join(root, 'variants')).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];
  variants.forEach((f) => listed.add(`variants/${f}`));
  sections.push('## Standing Variants\n\n' + (variants.length
    ? variants.map((f) => `- ${link(`variants/${f}`, f.replace(/\.md$/, ''))}: ${titleOf(`variants/${f}`)}`).join('\n')
    : '- None drafted yet. See [[variants/README|variants/README]].'));

  // Applications, by company
  const apps = join(root, 'applications'), companies = [];
  for (const c of existsSync(apps) ? readdirSync(apps, { withFileTypes: true }) : []) {
    if (!c.isDirectory() || c.name === 'data') continue;
    const lines = [];
    const co = `applications/${c.name}/company.md`;
    if (existsSync(join(root, co))) {
      const d = readFrontmatter(join(root, co)).data;
      listed.add(co);
      lines.push(`  - ${link(co, 'Company research')}: ${d.researched ? `full research ${d.researched}` : d.quick_checked ? `quick check ${d.quick_checked}` : 'not started'}`);
    }
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const base = `applications/${c.name}/${p.name}`;
      if (!existsSync(join(root, base, 'posting.md'))) continue;
      const d = readFrontmatter(join(root, base, 'posting.md')).data;
      const last = (d.events || []).map(parseEvent).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      const files = readdirSync(join(root, base)).filter((f) => f.endsWith('.md'));
      files.forEach((f) => listed.add(`${base}/${f}`));
      lines.push(`  - **${d.role}** (${last ? `${last.stage} ${last.date}` : 'no events'}${d.frozen ? ', frozen' : ''}): ` +
        files.map((f) => link(`${base}/${f}`, f.replace(/\.md$/, ''))).join(' · '));
    }
    const name = existsSync(join(root, co)) ? readFrontmatter(join(root, co)).data.company : null;
    companies.push(`- **${name || c.name}** (\`applications/${c.name}/\`)\n${lines.join('\n')}`);
  }
  sections.push('## Applications\n\n' + (companies.join('\n') || '- None yet.'));

  // Anything not covered above, so no note is ever unreachable
  const other = walk(root).filter((p) => !listed.has(p));
  if (other.length) sections.push('## Other Notes\n\n' + other.map((p) => `- ${link(p, p.replace(/\.md$/, ''))}: ${titleOf(p)}`).join('\n'));

  sections.push('## Files and Folders (not notes)\n\n' + FILES.map(([p, d]) => `- \`${p}\`${existsSync(join(root, p)) ? '' : ' (not created yet)'}: ${d}`).join('\n'));

  const out = `---
title: ${get('index.title', 'Career Workspace Index')}
generated: true
---

<!-- Generated by the RoleForward plugin's tools/index.mjs (also run by tools/tracker.mjs). Don't edit by hand.
     To add a description for a new core file, edit the index section of workspace.yaml. -->

# ${get('index.title', 'Career Workspace Index')}

The map of everything in this workspace. Agents: read [[README]], [[CLAUDE]], and [[MEMORY]] first, then follow the links below. Paths are relative to the workspace root.

${sections.join('\n\n')}
`;
  writeFileSync(join(root, 'INDEX.md'), out);
  return other.length;
}

// README.md is RoleForward's README (the repository's, the same one GitHub shows), copied in on every run, so the workspace always
// describes the installed plugin. A short header adds the plugin version and the workspace's version stamp. CLAUDE.md and
// MEMORY.md are the user's, and are never touched here.
export const pluginVersion = () => JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
export function buildReadme() {
  const stamp = String(get('workspace_version', '') || 'not stamped');
  const header = `<!-- Copied from the RoleForward plugin's README by tools/index.mjs on every tracker run. Don't edit: changes are
     overwritten. Notes and instructions for this workspace belong in MEMORY.md and CLAUDE.md. -->

> **This workspace:** RoleForward ${pluginVersion()} is installed, and the workspace was last brought up to date with ${stamp} (\`workspace_version\` in \`workspace.yaml\`).${stamp === pluginVersion() ? '' : ' They differ, so the workspace hasn\'t been updated for the installed plugin yet.'}

`;
  // The repository's root README is the source. An installed copy holds only the plugin folder, which ships an identical
  // copy, so use the root one when the plugin runs from the repository itself.
  const repo = join(PLUGIN, '..', '..', 'README.md'), shipped = join(PLUGIN, 'README.md');
  const source = existsSync(join(PLUGIN, '..', '..', '.claude-plugin', 'marketplace.json')) && existsSync(repo) ? repo : shipped;
  writeFileSync(join(root, 'README.md'), header + readFileSync(source, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const other = buildIndex();
  console.log(`Wrote INDEX.md and README.md${other ? ` (${other} note${other === 1 ? '' : 's'} under Other Notes; consider describing them in the index section of workspace.yaml)` : ''}`);
}
