// Reads the text layer of a PDF the way a resume parser (an applicant tracking system) does: glyphs grouped into
// lines by their position on the page, top to bottom, with a space wherever there's a visible gap. Built for the
// PDFs render.mjs makes through Chrome (Flate-compressed page streams, Type0 fonts with ToUnicode maps), with the
// standard library only. Used by ats.mjs.
//
//   import { pdfText } from './pdftext.mjs';
//   const { pages } = pdfText(buffer);     pages: [{ lines: ['Test Candidate', ...] }, ...]

import { inflateSync } from 'node:zlib';

// ---- Tokens: one tokenizer for object bodies and content streams ----
const WS = new Set([0, 9, 10, 12, 13, 32]), DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

function* tokens(buf, start = 0, end = buf.length) {
  let i = start;
  while (i < end) {
    const c = buf[i];
    if (WS.has(c)) { i++; continue; }
    if (c === 37) { while (i < end && buf[i] !== 10 && buf[i] !== 13) i++; continue; } // % comment
    if (c === 40) { // (literal string), nested parentheses and escapes
      const out = []; let depth = 1; i++;
      while (i < end && depth) {
        let b = buf[i++];
        if (b === 92) {
          const n = buf[i++];
          const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (map[n] !== undefined) out.push(map[n]);
          else if (n >= 48 && n <= 55) { let v = n - 48; for (let k = 0; k < 2 && buf[i] >= 48 && buf[i] <= 55; k++) v = v * 8 + buf[i++] - 48; out.push(v & 255); }
          else if (n === 13 || n === 10) { if (n === 13 && buf[i] === 10) i++; }
          else out.push(n);
          continue;
        }
        if (b === 40) depth++;
        if (b === 41 && --depth === 0) break;
        out.push(b);
      }
      yield { t: 'str', v: Buffer.from(out) }; continue;
    }
    if (c === 60 && buf[i + 1] === 60) { yield { t: '<<' }; i += 2; continue; }
    if (c === 62 && buf[i + 1] === 62) { yield { t: '>>' }; i += 2; continue; }
    if (c === 60) { // <hex string>
      let j = i + 1, hex = '';
      while (j < end && buf[j] !== 62) { if (!WS.has(buf[j])) hex += String.fromCharCode(buf[j]); j++; }
      if (hex.length % 2) hex += '0';
      yield { t: 'str', v: Buffer.from(hex, 'hex') }; i = j + 1; continue;
    }
    if (c === 91 || c === 93) { yield { t: c === 91 ? '[' : ']' }; i++; continue; }
    if (c === 47) { // /Name
      let j = i + 1; while (j < end && !WS.has(buf[j]) && !DELIM.has(buf[j])) j++;
      yield { t: 'name', v: buf.toString('latin1', i + 1, j).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) }; i = j; continue;
    }
    let j = i; while (j < end && !WS.has(buf[j]) && !DELIM.has(buf[j])) j++;
    if (j === i) j++; // a stray delimiter
    const word = buf.toString('latin1', i, j);
    yield /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? { t: 'num', v: +word } : { t: 'op', v: word, at: j };
    i = j;
  }
}

// Builds one value (dict, array, number, name, string, or { ref: n } for "n g R") from a token array, from index i.
// Returns [value, next index].
function parseValue(toks, i) {
  const tok = toks[i];
  if (!tok) return [undefined, i];
  if (tok.t === '<<') {
    const d = {}; i++;
    while (toks[i] && toks[i].t !== '>>') { const key = toks[i].v; let v; [v, i] = parseValue(toks, i + 1); d[key] = v; }
    return [d, i + 1];
  }
  if (tok.t === '[') {
    const a = []; i++;
    while (toks[i] && toks[i].t !== ']') { let v; [v, i] = parseValue(toks, i); a.push(v); }
    return [a, i + 1];
  }
  if (tok.t === 'num' && toks[i + 1]?.t === 'num' && toks[i + 2]?.t === 'op' && toks[i + 2].v === 'R') return [{ ref: tok.v }, i + 3];
  if (tok.t === 'op') return [tok.v === 'true' ? true : tok.v === 'false' ? false : null, i + 1];
  return [tok.v, i + 1];
}

// ---- Objects ----
function readObjects(buf) {
  const text = buf.toString('latin1'), objs = new Map();
  for (const m of text.matchAll(/(\d+)\s+\d+\s+obj\b/g)) {
    const start = m.index + m[0].length, toks = [];
    for (const tok of tokens(buf, start)) { if (tok.t === 'op' && (tok.v === 'endobj' || tok.v === 'stream')) { toks.end = tok; break; } toks.push(tok); }
    const obj = { value: parseValue(toks, 0)[0] };
    if (toks.end?.v === 'stream') {
      let s = toks.end.at;
      if (buf[s] === 13) s++;
      if (buf[s] === 10) s++;
      obj.streamStart = s; obj.streamEnd = text.indexOf('endstream', s);
    }
    objs.set(+m[1], obj);
  }
  const resolve = (v) => (v && typeof v === 'object' && typeof v.ref === 'number' ? objs.get(v.ref)?.value : v);
  const stream = (num) => {
    const o = objs.get(num);
    if (!o?.streamStart) return Buffer.alloc(0);
    let len = resolve(o.value.Length);
    if (typeof len !== 'number' || len <= 0 || o.streamStart + len > o.streamEnd) len = o.streamEnd - o.streamStart;
    let data = buf.subarray(o.streamStart, o.streamStart + len);
    for (const f of [].concat(resolve(o.value.Filter) ?? [])) if (f === 'FlateDecode') data = inflateSync(data);
    return data;
  };
  return { objs, resolve, stream };
}

// ---- Fonts ----
function cmap(data) {
  const map = new Map(), text = data.toString('latin1');
  const hex = (h) => parseInt(h, 16);
  const uni = (h) => { let s = ''; for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4))); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(hex(m[1]), uni(m[2]));
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const lo = hex(m[1]), hi = hex(m[2]);
      if (m[4]) { const base = hex(m[4]); for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + c - lo)); }
      else [...m[5].matchAll(/<([0-9a-f]+)>/gi)].forEach((x, k) => map.set(lo + k, uni(x[1])));
    }
  return map;
}

function loadFont(pdf, ref) {
  const f = (pdf.resolve(ref)) ?? {};
  const type0 = f.Subtype === 'Type0';
  const toUnicode = f.ToUnicode?.ref ? cmap(pdf.stream(f.ToUnicode.ref)) : new Map();
  const widths = new Map(); let dw = 1000;
  if (type0) {
    const cid = (pdf.resolve([].concat(f.DescendantFonts)[0])) ?? {};
    dw = cid.DW ?? 1000;
    const w = (pdf.resolve(cid.W)) ?? [];
    for (let i = 0; i < w.length;) {
      if (Array.isArray(w[i + 1])) { w[i + 1].forEach((x, k) => widths.set(w[i] + k, x)); i += 2; }
      else { for (let c = w[i]; c <= w[i + 1]; c++) widths.set(c, w[i + 2]); i += 3; }
    }
  } else {
    const first = f.FirstChar ?? 0, ws = (pdf.resolve(f.Widths)) ?? [];
    ws.forEach((x, k) => widths.set(first + k, x)); dw = 500;
  }
  return {
    // Codes are two bytes in a Type0 font with Identity-H, one byte otherwise.
    glyphs(bytes) {
      const out = [];
      if (type0) for (let i = 0; i + 1 < bytes.length; i += 2) out.push((bytes[i] << 8) | bytes[i + 1]);
      else for (const b of bytes) out.push(b);
      return out.map((code) => ({ ch: toUnicode.get(code) ?? (type0 ? '' : String.fromCharCode(code)), w: (widths.get(code) ?? dw) / 1000 }));
    },
  };
}

// ---- Pages ----
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

function pageGlyphs(pdf, page) {
  const resources = (pdf.resolve(page.Resources)) ?? {};
  const fontDict = (pdf.resolve(resources.Font)) ?? {};
  const fonts = {};
  const contents = [].concat(page.Contents ?? []).map((r) => pdf.stream(r.ref));
  const data = Buffer.concat(contents.flatMap((c) => [c, Buffer.from('\n')]));
  const glyphs = [];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let tm = [1, 0, 0, 1, 0, 0], lm = [1, 0, 0, 1, 0, 0];
  let font = null, size = 0, tc = 0, tw = 0, th = 1, tl = 0, rise = 0;
  const show = (bytes) => {
    if (!font) return;
    for (const g of font.glyphs(bytes)) {
      const trm = mul([size * th, 0, 0, size, 0, rise], mul(tm, ctm));
      const scale = Math.hypot(trm[2], trm[3]);
      const adv = (g.w * size + tc + (g.ch === ' ' ? tw : 0)) * th;
      const end = mul([1, 0, 0, 1, adv, 0], mul(tm, ctm));
      glyphs.push({ ch: g.ch, x: trm[4], y: trm[5], x2: end[4], size: scale });
      tm = mul([1, 0, 0, 1, adv, 0], tm);
    }
  };
  const args = [];
  for (const tok of tokens(data)) {
    if (tok.t !== 'op') {
      if (tok.t === '[') { const arr = []; args.push(arr); args.inArray = arr; continue; }
      if (tok.t === ']') { args.inArray = null; continue; }
      if (tok.t === '<<' || tok.t === '>>') continue;
      (args.inArray ?? args).push(tok.v);
      continue;
    }
    const a = args.splice(0), op = tok.v;
    args.inArray = null;
    switch (op) {
      case 'q': stack.push(ctm); break;
      case 'Q': ctm = stack.pop() ?? ctm; break;
      case 'cm': ctm = mul(a.slice(0, 6), ctm); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; lm = tm; break;
      case 'Tf': {
        const ref = fontDict[a[0]];
        fonts[a[0]] ??= ref ? loadFont(pdf, ref) : null;
        font = fonts[a[0]]; size = a[1]; break;
      }
      case 'Tc': tc = a[0]; break;
      case 'Tw': tw = a[0]; break;
      case 'Tz': th = a[0] / 100; break;
      case 'TL': tl = a[0]; break;
      case 'Ts': rise = a[0]; break;
      case 'Tm': tm = lm = a.slice(0, 6); break;
      case 'Td': tm = lm = mul([1, 0, 0, 1, a[0], a[1]], lm); break;
      case 'TD': tl = -a[1]; tm = lm = mul([1, 0, 0, 1, a[0], a[1]], lm); break;
      case 'T*': tm = lm = mul([1, 0, 0, 1, 0, -tl], lm); break;
      case 'Tj': show(a[0]); break;
      case "'": tm = lm = mul([1, 0, 0, 1, 0, -tl], lm); show(a[0]); break;
      case '"': tw = a[0]; tc = a[1]; tm = lm = mul([1, 0, 0, 1, 0, -tl], lm); show(a[2]); break;
      case 'TJ':
        for (const part of a[0] ?? []) {
          if (Buffer.isBuffer(part)) show(part);
          else tm = mul([1, 0, 0, 1, (-part / 1000) * size * th, 0], tm);
        }
        break;
    }
  }
  return glyphs;
}

// Glyphs into lines: same baseline (within a third of the font size), left to right, a space at any gap wider than
// a quarter of the font size. Lines run top to bottom.
function lines(glyphs) {
  const rows = [];
  for (const g of [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - g.y) <= Math.max(g.size, r.size) / 3);
    if (row) row.glyphs.push(g); else rows.push({ y: g.y, size: g.size, glyphs: [g] });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    let s = '', last = null;
    for (const g of r.glyphs.sort((a, b) => a.x - b.x)) {
      if (last && g.x - last.x2 > g.size / 4 && !s.endsWith(' ') && g.ch !== ' ') s += ' ';
      s += g.ch; last = g;
    }
    return s.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

export function pdfText(buf) {
  if (buf.toString('latin1', 0, 5) !== '%PDF-') throw new Error('Not a PDF file.');
  const pdf = readObjects(buf);
  const catalog = [...pdf.objs.values()].find((o) => o.value?.Type === 'Catalog')?.value;
  const pages = [];
  const walk = (node) => {
    const n = pdf.resolve(node);
    if (!n) return;
    if (n.Type === 'Pages') for (const kid of n.Kids ?? []) walk(kid);
    else if (n.Type === 'Page') pages.push(n);
  };
  walk(catalog?.Pages);
  return { pages: pages.map((p) => ({ lines: lines(pageGlyphs(pdf, p)) })) };
}
