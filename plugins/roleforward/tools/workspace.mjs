// Finds the user's workspace (their private career data folder) and loads its workspace.yaml.
//
// The plugin holds the engine (these scripts, the skills, the templates). Each person's workspace holds their data:
// portfolio, resume, applications, and workspace.yaml, which says everything that differs between people (names,
// file names, targets, screening keywords, modules). Scripts run with the workspace as the working folder and find it
// by walking up to the nearest workspace.yaml. Set ROLEFORWARD_WORKSPACE_DIR to point at a workspace explicitly.
//
// workspace.yaml uses a small YAML subset, read here with no npm packages:
//   key: value                  scalars (quote with '...' to keep backslashes literal, or "..." for JSON-style escapes)
//   key:                        a nested map, by indentation (any depth)
//     sub: value
//   key:                        a list of scalars
//     - item
//   key: [a, "b, c", d]         an inline list of scalars (quote an item that contains a comma)
//   # comment                   full-line comments, and "  # comment" after an unquoted value

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');

function scalar(v) {
  v = v.trim();
  // A quoted value can have a comment after it: primary: '#132a45'   # headers
  const quoted = v.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s+#.*$/);
  if (quoted) v = quoted[1];
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  v = v.replace(/\s+#\s.*$/, '').trim();
  if (/^\[.*\]$/.test(v)) return (v.slice(1, -1).match(/\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*|[^,]+/g) || []).map((x) => scalar(x)).filter((x) => x !== '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === '' || v === '~' || v === 'null') return '';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseYaml(text) {
  text = String(text).replace(/\r\n?/g, '\n'); // Windows line endings read the same
  const root = {};
  const stack = [{ indent: -1, node: root }];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1);
    if (line.startsWith('- ')) {
      if (!Array.isArray(parent.node)) throw new Error(`workspace.yaml line ${i + 1}: a list item needs a "key:" line above it`);
      parent.node.push(scalar(line.slice(2)));
      continue;
    }
    const m = line.match(/^("[^"]+"|'[^']+'|[^:]+):(?:\s+(.*))?$/);
    if (!m) throw new Error(`workspace.yaml line ${i + 1}: can't read "${line}"`);
    const key = scalar(m[1]);
    const val = (m[2] ?? '').trim();
    if (val !== '' && !val.startsWith('#')) { parent.node[key] = scalar(val); continue; }
    // A key with nothing after it opens a map or a list, decided by the next meaningful line. When that line isn't
    // indented under it (pronouns:   # optional), the key is simply empty.
    const next = lines.slice(i + 1).find((l) => l.trim() && !/^\s*#/.test(l));
    if (!next || next.match(/^ */)[0].length <= indent) { parent.node[key] = ''; continue; }
    const child = next.trim().startsWith('- ') ? [] : {};
    parent.node[key] = child;
    stack.push({ indent, node: child });
  }
  return root;
}

export function findWorkspace(start = process.env.ROLEFORWARD_WORKSPACE_DIR || process.cwd()) {
  // The real path, so paths relative to the root stay short when the folder is reached through a symlink (macOS's
  // /var is /private/var, and a synced folder may be linked), since process.cwd() always gives the real one.
  let dir = resolve(start);
  try { dir = realpathSync(dir); } catch { /* a folder that doesn't exist yet: walk up from it as given */ }
  for (;;) {
    if (existsSync(join(dir, 'workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// A relative path with forward slashes on every system, for record IDs and links (Windows paths use backslashes).
export const relPath = (from, to) => relative(from, to).split(sep).join('/');

// Reads a dotted path such as "person.file_stem", with a fallback.
export const get = (obj, path, fallback = '') =>
  path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj) ?? fallback;

export function loadWorkspace() {
  const root = findWorkspace();
  if (!root) {
    console.error('No workspace.yaml found here or in any parent folder. Open your career workspace folder, or run /onboard to create one.');
    process.exit(1);
  }
  const cfg = parseYaml(readFileSync(join(root, 'workspace.yaml'), 'utf8'));
  return { root, cfg, get: (path, fallback) => get(cfg, path, fallback) };
}

// Where render.mjs writes the PDF and .txt for a posting's `resume:` value (keep in step with its naming):
//   tailored                the posting's own resume.md, rendered next to it
//   <files.resume>          the default, rendered to output/ (the PDF with "-Apply", which has phone and email)
//   variants/<name>.md      a standing variant, rendered to output/variants/
// A frozen posting holds its own copy of what was sent, so those files are used instead.
export function resumeFiles(root, get, resume, dir, frozen = false) {
  const stem = get('person.file_stem') + '-Resume', DEFAULT = get('files.resume');
  if (frozen) return { md: join(dir, 'resume.md'), pdf: join(dir, stem + '.pdf'), txt: join(dir, stem + '.txt') };
  if (resume === 'tailored') return { md: join(dir, 'resume.md'), pdf: join(dir, stem + '.pdf'), txt: join(dir, stem + '.txt') };
  if (resume === DEFAULT) return { md: join(root, resume), pdf: join(root, 'output', stem + '-Apply.pdf'), txt: join(root, 'output', stem + '.txt') };
  const m = String(resume).match(/^variants\/([\w-]+)\.md$/);
  if (!m) throw new Error(`posting.md resume: must be ${DEFAULT}, variants/<name>.md, or tailored (got "${resume}")`);
  const base = join(root, 'output', 'variants', stem + '-' + m[1].replace(/(^|-)(\w)/g, (_, d, c) => d + c.toUpperCase()));
  return { md: join(root, resume), pdf: base + '.pdf', txt: base + '.txt' };
}

// The workspace's two colors, chosen during onboarding: theme.primary carries white text (headers, the site's sidebar),
// and theme.accent is the highlight (rules and pills). Used by the sheet, the website, and its share images.
export const palette = (get) => ({
  primary: get('theme.primary', '') || '#132a45',
  accent: get('theme.accent', '') || '#d8b66a',
});

// Chrome, Chromium, Edge, or Brave prints the PDFs and draws the site images. render.chrome in workspace.yaml wins (a
// full path, or a command name on the PATH), then the CHROME_PATH environment variable, then the usual install places
// on macOS and Windows, or the PATH on Linux. Returns '' when none is found.
const onPath = (name) => (process.env.PATH || '').split(delimiter).map((d) => join(d, name)).find((p) => existsSync(p)) ?? '';
export function findChrome(get = () => '') {
  const set = get('render.chrome', '') || process.env.CHROME_PATH || '';
  if (set) return /[\\/]/.test(set) ? set : onPath(set) || set;
  const env = process.env;
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'];
    return ['/Applications', join(homedir(), 'Applications')].flatMap((d) => apps.map((a) => join(d, `${a}.app/Contents/MacOS/${a}`))).find((p) => existsSync(p)) ?? '';
  }
  if (process.platform === 'win32') {
    const exes = ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe'];
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => exes.map((e) => join(d, e))).find((p) => existsSync(p)) ?? '';
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
    const p = onPath(name);
    if (p) return p;
  }
  return '';
}
export const CHROME_HELP = 'Install Google Chrome (or Chromium, Microsoft Edge, or Brave), or set render.chrome in workspace.yaml to its path.';

// Turns a keyword list (or one pattern string) into a case-insensitive regex. Entries are regex fragments.
export function regex(value, fallback) {
  const parts = Array.isArray(value) ? value : value ? [value] : [];
  return parts.length ? new RegExp(parts.join('|'), 'i') : fallback;
}
