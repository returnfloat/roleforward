// Minimal CSV reader and writer shared by the scripts (no npm packages). Handles quoted cells with commas,
// quotes, and newlines. Rows read back as objects keyed by the header.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
export const toCsv = (head, rows) => [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';

export function parseCsv(text) {
  const rows = [];
  let row = [], v = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { v += '"'; i++; }
      else if (c === '"') q = false;
      else v += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(v); v = ''; }
    else if (c === '\n') { row.push(v); rows.push(row); row = []; v = ''; }
    else if (c !== '\r') v += c;
  }
  if (v || row.length) { row.push(v); rows.push(row); }
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export const readCsv = (path) => (existsSync(path) ? parseCsv(readFileSync(path, 'utf8')) : []);
export const writeCsv = (path, head, objs) => writeFileSync(path, toCsv(head, objs.map((o) => head.map((h) => o[h]))));
