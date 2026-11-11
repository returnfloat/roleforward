// The scout's first screen, shared by scout.mjs (watchlist feeds) and discover.mjs (finding new employers).
// The title screen comes from workspace.yaml scout.*: every title_all pattern must match, title_none must not. The place
// screen comes from targets.country, targets.places, and targets.remote (places.mjs). Both are broad on purpose. The
// skill makes the real call against the workspace's Dealbreakers.
//
// The title audit (scout.mjs audit) is here too: the near misses the title screen hides, among postings in a place that fits.

import { createHash } from 'node:crypto';
import { regex } from './workspace.mjs';
import { placeVerdict, placeSettings } from './places.mjs';

const patterns = (v) => [].concat(v || []).map(String).filter(Boolean);

export function screens(cfg) {
  const TITLE_ALL = (cfg('scout.title_all', []) || []).map((p) => new RegExp(p, 'i'));
  const TITLE_NONE = regex(cfg('scout.title_none'), /$^/);
  const places = placeSettings(cfg);
  return {
    titleOk: (t) => TITLE_ALL.length > 0 && TITLE_ALL.every((r) => r.test(t)) && !TITLE_NONE.test(t),
    placeOk: (l) => placeVerdict(l, places) === 'fits',
    placeVerdict: (l) => placeVerdict(l, places),
  };
}

// A short fingerprint of the title patterns, so a run can tell when they changed since the last audit.
export const titleFingerprint = (cfg) => createHash('sha256')
  .update(JSON.stringify([patterns(cfg('scout.title_all', [])), patterns(cfg('scout.title_none', []))])).digest('hex').slice(0, 12);

// Titles that differ only in case, punctuation, or a requisition number share a key: "Senior Data Engineer (R-12345)"
// and "senior data engineer" are one line.
export const titleKey = (t) => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(req(uisition)?|job id)\b|\b[a-z]{0,4}[-_#]?\d{3,}[\w-]*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Postings ({ company, title, n }) as one line per title key: the commonest wording, the posting count, and the
// employers, most postings first.
export function collapseTitles(postings) {
  const groups = new Map();
  for (const p of postings) {
    const k = titleKey(p.title), n = p.n ?? 1;
    const g = groups.get(k) ?? { count: 0, wordings: new Map(), companies: new Map() };
    g.count += n;
    g.wordings.set(p.title, (g.wordings.get(p.title) ?? 0) + n);
    g.companies.set(p.company, (g.companies.get(p.company) ?? 0) + n);
    groups.set(k, g);
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([v]) => v);
  return [...groups.values()].map((g) => ({ title: top(g.wordings)[0], count: g.count, companies: top(g.companies) }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

// The near misses among postings ({ company, title, location, n }) whose place fits: titles that fail exactly one
// title_all pattern (by pattern), and titles that pass title_all but match title_none (by the words matched). With one
// title_all pattern, "fails one" would be every other posting, so that part is left out (oneAll is null), and with no
// title_none, so is the other (none is null).
export function titleAudit(cfg, postings) {
  const all = patterns(cfg('scout.title_all', [])), none = patterns(cfg('scout.title_none', []));
  const allRe = all.map((p) => new RegExp(p, 'i')), noneRe = none.map((p) => new RegExp(p, 'i'));
  const places = placeSettings(cfg), verdicts = new Map();
  const fits = (l) => { if (!verdicts.has(l)) verdicts.set(l, placeVerdict(l, places) === 'fits'); return verdicts.get(l); };
  const out = { looked: 0, placed: 0, passed: 0, patterns: all.length, oneAll: all.length > 1 ? new Map(all.map((p) => [p, []])) : null, none: none.length ? new Map() : null };
  for (const p of postings) {
    const n = p.n ?? 1;
    out.looked += n;
    if (!fits(p.location)) continue;
    out.placed += n;
    const failed = allRe.map((r, i) => (r.test(p.title) ? -1 : i)).filter((i) => i >= 0);
    const excluded = noneRe.map((r) => p.title.match(r)?.[0]).find(Boolean);
    if (!failed.length && !excluded && all.length) out.passed += n;
    else if (!failed.length && excluded && all.length) {
      const k = excluded.toLowerCase();
      if (!out.none.has(k)) out.none.set(k, []);
      out.none.get(k).push(p);
    } else if (failed.length === 1 && !excluded && out.oneAll) out.oneAll.get(all[failed[0]]).push(p);
  }
  const finish = (m) => m && [...m].map(([label, ps]) => ({ label, count: ps.reduce((s, p) => s + (p.n ?? 1), 0), lines: collapseTitles(ps) }))
    .sort((a, b) => b.count - a.count);
  return { ...out, oneAll: finish(out.oneAll), none: finish(out.none) };
}

// The audit as printed lines. Each group shows its first `limit` titles unless `all` is set.
export function auditLines(a, { all = false, limit = 15, employers = 3 } = {}) {
  const total = (gs) => gs?.reduce((s, g) => s + g.count, 0) ?? 0;
  const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  const out = [`${plural(a.looked, 'posting')} looked at, ${a.placed.toLocaleString('en-US')} in a place that fits, ${a.passed.toLocaleString('en-US')} of those passed the title screen. `
    + `Near misses: ${a.oneAll ? `${total(a.oneAll)} failed one title_all pattern` : 'title_all check skipped'}, ${a.none ? `${total(a.none)} excluded by title_none` : 'no title_none'}.`];
  if (!a.patterns) out.push('scout.title_all is empty, so no title passes the screen. Set it before auditing.');
  else if (!a.oneAll) out.push('scout.title_all has one pattern, so every title that misses it would count as a near miss. That part is left out.');
  const section = (head, groups, label) => {
    out.push('', head);
    for (const g of groups) {
      if (!g.count) { out.push(`  ${label(g.label)}: none`); continue; }
      out.push(`  ${label(g.label)} (${plural(g.count, 'posting')}, ${plural(g.lines.length, 'title')}):`);
      for (const l of all ? g.lines : g.lines.slice(0, limit)) {
        const more = l.companies.length > employers ? ` +${l.companies.length - employers} more` : '';
        out.push(`    ${String(l.count).padStart(4)}  ${l.title}  (${l.companies.slice(0, employers).join(', ')}${more})`);
      }
      if (!all && g.lines.length > limit) out.push(`    and ${plural(g.lines.length - limit, 'more title')} (--all shows every title)`);
    }
  };
  if (a.oneAll) section('Failed one title_all pattern:', a.oneAll, (p) => `Missed '${p}'`);
  if (a.none) section('Passed title_all, but excluded by title_none:', a.none, (m) => `Matched "${m}"`);
  else if (a.patterns) out.push('', 'scout.title_none is empty, so it excludes nothing.');
  return out;
}
