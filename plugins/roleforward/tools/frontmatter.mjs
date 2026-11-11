// Minimal frontmatter reader and writer for posting.md files (no npm packages).
// Supports exactly three shapes, which is all the application records use:
//   key: value            scalar (surrounding quotes are stripped on read)
//   key:\n  - item         list
//   key:\n  sub: value     map
// Key order is preserved, so a round trip only changes what was set.

import { readFileSync, writeFileSync } from 'node:fs';

// A text file with Windows line endings (CRLF) read as LF, so every reader sees the same lines.
export const readText = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

const FM = /^---\n([\s\S]*?)\n---\n/;
// Trailing "  # comment" text is dropped, as in YAML (the company template documents its fields that way).
// Double-quoted values are JSON-style; single-quoted ones use YAML's '' escape (Obsidian's Properties editor may write either).
const unquote = (v) => {
  v = v.replace(/\s+#\s.*$/, '').trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  return /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v;
};

export function readFrontmatter(path) {
  const md = readText(path);
  const m = md.match(FM);
  const data = {};
  let key = null;
  for (const line of (m?.[1] ?? '').split('\n')) {
    let x;
    if ((x = line.match(/^  - (.*)$/)) && key) (Array.isArray(data[key]) ? data[key] : (data[key] = [])).push(unquote(x[1]));
    else if ((x = line.match(/^  ([\w.-]+): ?(.*)$/)) && key) ((data[key] && typeof data[key] === 'object') ? data[key] : (data[key] = {}))[x[1]] = unquote(x[2]);
    else if ((x = line.match(/^([\w-]+): ?(.*)$/))) { key = x[1]; data[key] = unquote(x[2]); }
  }
  return { data, body: m ? md.slice(m[0].length) : md };
}

// Quoted when YAML would misread it: ": " anywhere, " #" (a comment), a leading indicator character, or edge spaces.
const scalar = (v) => (/: |\s#|^[\s"'#&*!|>%@`[{-]|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));

export function writeFrontmatter(path, data, body) {
  const lines = Object.entries(data).map(([k, v]) =>
    Array.isArray(v) ? `${k}:${v.map((i) => `\n  - ${scalar(i)}`).join('')}`
    : v && typeof v === 'object' ? `${k}:${Object.entries(v).map(([s, x]) => `\n  ${s}: ${scalar(x)}`).join('')}`
    : `${k}: ${v === '' ? '' : scalar(v)}`.trimEnd());
  writeFileSync(path, `---\n${lines.join('\n')}\n---\n${body}`);
}

// Adds one event to a posting.md and sets updated, editing the text in place so every other line stays exactly as written.
export function appendEvent(path, event, date) {
  const md = readText(path);
  const m = md.match(FM);
  if (!m) throw new Error(`${path}: no frontmatter`);
  const lines = m[1].split('\n');
  const start = lines.findIndex((l) => /^events:\s*$/.test(l));
  if (start < 0) lines.push('events:', `  - ${scalar(event)}`);
  else { let end = start + 1; while (end < lines.length && /^  - /.test(lines[end])) end++; lines.splice(end, 0, `  - ${scalar(event)}`); }
  const u = lines.findIndex((l) => /^updated:/.test(l));
  if (u >= 0) lines[u] = `updated: ${date}`; else lines.push(`updated: ${date}`);
  writeFileSync(path, `---\n${lines.join('\n')}\n---\n${md.slice(m[0].length)}`);
}

// Replaces the note on a posting.md's last event (keeping its date and stage) and sets updated, editing in place.
export function setLastEventNote(path, note, date) {
  const md = readText(path);
  const m = md.match(FM);
  if (!m) throw new Error(`${path}: no frontmatter`);
  const lines = m[1].split('\n');
  const start = lines.findIndex((l) => /^events:\s*$/.test(l));
  if (start < 0) throw new Error(`${path}: no events`);
  let end = start + 1; while (end < lines.length && /^  - /.test(lines[end])) end++;
  if (end === start + 1) throw new Error(`${path}: no events`);
  const raw = lines[end - 1].replace(/^  - /, '');
  const { date: d, stage } = parseEvent(/^["']/.test(raw) ? unquote(raw) : raw);
  lines[end - 1] = `  - ${scalar([d, stage, note].filter(Boolean).join(' | '))}`;
  const u = lines.findIndex((l) => /^updated:/.test(l));
  if (u >= 0) lines[u] = `updated: ${date}`; else lines.push(`updated: ${date}`);
  writeFileSync(path, `---\n${lines.join('\n')}\n---\n${md.slice(m[0].length)}`);
}

// Sets one top-level field (for example next) and updated, editing the text in place so every other line stays exactly
// as written. An empty value leaves the key with nothing after it. A missing field is added after the events list, or
// before updated.
export function setField(path, key, value, date) {
  const md = readText(path);
  const m = md.match(FM);
  if (!m) throw new Error(`${path}: no frontmatter`);
  const lines = m[1].split('\n');
  const line = value === '' ? `${key}:` : `${key}: ${scalar(value)}`;
  const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (at >= 0) { let end = at + 1; while (end < lines.length && /^  /.test(lines[end])) end++; lines.splice(at, end - at, line); }
  else {
    const ev = lines.findIndex((l) => /^events:\s*$/.test(l));
    let pos = lines.findIndex((l) => /^updated:/.test(l));
    if (ev >= 0) { pos = ev + 1; while (pos < lines.length && /^  - /.test(lines[pos])) pos++; }
    lines.splice(pos < 0 ? lines.length : pos, 0, line);
  }
  if (key !== 'updated') { const u = lines.findIndex((l) => /^updated:/.test(l)); if (u >= 0) lines[u] = `updated: ${date}`; else lines.push(`updated: ${date}`); }
  writeFileSync(path, `---\n${lines.join('\n')}\n---\n${md.slice(m[0].length)}`);
}

// Events are "YYYY-MM-DD | stage | optional note".
export const parseEvent = (s) => { const [date, stage, ...note] = s.split(' | '); return { date, stage, note: note.join(' | ') }; };
