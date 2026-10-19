#!/usr/bin/env node
// Builds the application tracker from every applications/<company>/<posting>/posting.md frontmatter in the workspace.
// The posting.md files are the only source of truth. Everything written here is generated:
//   applications/tracker.md          funnel, breakdowns, needs-attention list, and the full table
//   applications/data/applications.csv   one row per posting (open in Numbers, Excel, or pandas)
//   applications/data/events.csv         one row per dated event, for time-in-stage analysis
//   applications/data/stats.json         the tracker's numbers, for the sheet's Stats tab
//   INDEX.md                             the workspace-wide link index (via tools/index.mjs)
// Usage: node <plugin>/tools/tracker.mjs   (run from inside the workspace)

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readFrontmatter, parseEvent } from './frontmatter.mjs';
import { buildIndex } from './index.mjs';
import { readCsv, toCsv } from './csv.mjs';
import { loadWorkspace, relPath } from './workspace.mjs';
import { visaOn, deadlineLine } from './visa.mjs';
import { readDirection, rankCompare, dealbreakerOf } from './fit.mjs';

const { root, get } = loadWorkspace();
// Company research scores the maturity of the function the user works in (security, nursing, finance...).
// workspace.yaml tracker.maturity_field names that frontmatter field, and the CSV column.
const MATURITY = get('tracker.maturity_field', 'function_maturity');
const apps = join(root, 'applications');

// Pipeline stages in order. /scout shortlists a posting, the user marks it interested, then applies.
// Anything after "applied" is a response. "expired" means the posting closed before the user decided.
export const PIPELINE = ['shortlisted', 'interested', 'applied', 'recruiter-screen', 'hiring-manager', 'interviews', 'final', 'offer', 'accepted'];
export const TERMINAL = ['expired', 'passed', 'rejected', 'withdrawn', 'no-response', 'declined-offer'];
const STALE_DAYS = 21;

const day = (d) => new Date(d + 'T00:00:00Z');
const days = (a, b) => Math.round((day(b) - day(a)) / 864e5);
const today = new Date().toLocaleDateString('en-CA');
const median = (xs) => { if (!xs.length) return ''; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '');

function load() {
  if (!existsSync(apps)) return [];
  const rows = [];
  for (const c of readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'data')) {
    // Company research scores (company.md) are joined onto every posting at that company.
    const co = existsSync(join(apps, c.name, 'company.md')) ? readFrontmatter(join(apps, c.name, 'company.md')).data : {};
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = join(apps, c.name, p.name, 'posting.md');
      if (!existsSync(file)) continue;
      const { data } = readFrontmatter(file);
      const events = (data.events || []).map(parseEvent).sort((a, b) => a.date.localeCompare(b.date));
      for (const e of events)
        if (![...PIPELINE, ...TERMINAL].includes(e.stage)) throw new Error(`${relPath(root, file)}: unknown stage "${e.stage}"`);
      const at = (s) => events.find((e) => e.stage === s)?.date ?? '';
      const applied = at('applied');
      const response = applied && events.find((e) => e.date >= applied && !['shortlisted', 'interested', 'applied', 'withdrawn', 'no-response'].includes(e.stage));
      const last = events.at(-1);
      const status = last?.stage ?? 'shortlisted';
      rows.push({
        id: relPath(apps, dirname(file)), company: data.company, role: data.role, track: data.track, level: data.level,
        work_mode: data.work_mode, location: data.location, source: data.source, referral: /^(true|yes)$/i.test(data.referral) ? 'yes' : 'no',
        resume: data.resume, comp_min: data.comp_min, comp_max: data.comp_max, posting: data.posting, jd: data.jd,
        shortlisted: at('shortlisted'), interested: at('interested'), applied, status,
        // Role fit and Preference fit (fit.mjs).
        role_fit: +data.role_fit || '', preference_fit: data.preference_fit === '' || data.preference_fit === undefined ? '' : +data.preference_fit,
        why: data.why,
        furthest: PIPELINE[Math.max(0, ...events.map((e) => PIPELINE.indexOf(e.stage)))],
        responded: response ? 'yes' : applied ? 'no' : '',
        first_response_days: response ? days(applied, response.date) : '',
        last_event: last?.date ?? '', days_since_last_event: last ? days(last.date, today) : '',
        active: !TERMINAL.includes(status) && status !== 'accepted', events,
        researched: co.researched, ownership: co.ownership, stability: +co.stability || '', growth: +co.growth || '',
        [MATURITY]: +co[MATURITY] || '',
      });
    }
  }
  // Postings pruned from the workspace (sheet.mjs prune) still count: one line each in data/archive.csv.
  for (const a of readCsv(join(apps, 'data', 'archive.csv')))
    rows.push({ ...a, id: a.id, status: a.outcome, role_fit: +a.role_fit || '', preference_fit: a.preference_fit === undefined || a.preference_fit === '' ? '' : +a.preference_fit, furthest: 'shortlisted', referral: 'no', applied: '', interested: '',
      responded: '', last_event: a.ended, days_since_last_event: days(a.ended, today), active: false, archived: a.archived || 'yes', events: [] });
  return rows.sort((a, b) => (a.company || '').localeCompare(b.company || '') || (a.role || '').localeCompare(b.role || ''));
}

const COLS = ['id', 'archived', 'company', 'role', 'track', 'level', 'work_mode', 'location', 'source', 'referral', 'resume', 'comp_min', 'comp_max',
  'posting', 'jd', 'role_fit', 'preference_fit', 'why', 'shortlisted', 'interested', 'applied', 'status', 'furthest', 'responded', 'first_response_days', 'last_event', 'days_since_last_event',
  'researched', 'ownership', 'stability', 'growth', MATURITY];
const csv = toCsv;
const md = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n');

// One row per group: [group, applied, got a response, reached interviews, median days to response].
function breakdownRows(applied, key) {
  const groups = {};
  for (const r of applied) (groups[r[key] || '(blank)'] ??= []).push(r);
  return Object.entries(groups).sort().map(([g, rs]) => {
    const resp = rs.filter((r) => r.responded === 'yes');
    return [g, rs.length, `${resp.length} (${pct(resp.length, rs.length)})`,
      rs.filter((r) => PIPELINE.indexOf(r.furthest) >= PIPELINE.indexOf('interviews')).length,
      median(resp.map((r) => r.first_response_days))];
  });
}
const BREAKDOWNS = ['referral', 'source', 'resume', 'track', 'ownership', 'role_fit', 'preference_fit_rounded'];
const breakdown = (applied, key, label) => `### By ${label}\n\n` + md([label, 'Applied', 'Got a response', 'Reached interviews', 'Median days to response'], breakdownRows(applied, key));

const rows = load();
for (const r of rows) r.preference_fit_rounded = r.preference_fit === '' ? '' : Math.round(r.preference_fit);
// Scout volume: every watchlist posting /scout screened, one line each (applications/data/seen.csv).
const seenFile = join(apps, 'data', 'seen.csv');
const seen = readCsv(seenFile);
const seenBy = (d) => seen.filter((s) => s.decision === d).length;
// Drops per dealbreaker, from each drop reason's leading name ("Wrong level: ..."). A rule that drops a lot, or that
// came from a single posting, is easy to spot and question here. Reasons that name no current dealbreaker count as other.
// Stale, Pay, and Sponsorship drops come from settings (scout.stale_days, targets.pay, targets.visa), not the list, and are
// counted by those names.
const DEALBREAKERS = [...readDirection().dealbreakers.map((d) => d.name), 'Stale', 'Pay', 'Sponsorship'];
const dropCounts = Object.entries(seen.filter((s) => s.decision === 'dropped').reduce((m, s) => { const k = dealbreakerOf(s.reason, DEALBREAKERS) || 'Other (no dealbreaker named)'; m[k] = (m[k] || 0) + 1; return m; }, {}))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const applied = rows.filter((r) => r.applied);
mkdirSync(join(apps, 'data'), { recursive: true });
writeFileSync(join(apps, 'data', 'applications.csv'), csv(COLS, rows.map((r) => COLS.map((c) => r[c]))));
writeFileSync(join(apps, 'data', 'events.csv'), csv(['id', 'company', 'role', 'date', 'stage', 'note'],
  rows.flatMap((r) => r.events.map((e) => [r.id, r.company, r.role, e.date, e.stage, e.note]))));

const stale = rows.filter((r) => r.active && r.applied && r.days_since_last_event >= STALE_DAYS);
const RESEARCH_DAYS = 90;
// apply.depth light defers full company research until an interview is scheduled, so only flag it from then on.
const LIGHT = get('apply.depth', 'full') === 'light';
const RESEARCH_FROM = LIGHT ? 'recruiter-screen' : 'applied';
const unresearched = rows.filter((r) => r.active && PIPELINE.indexOf(r.furthest) >= PIPELINE.indexOf(RESEARCH_FROM) && (!r.researched || days(r.researched, today) > RESEARCH_DAYS));
const queue = rows.filter((r) => r.active && r.status === 'shortlisted');
const evaluating = rows.filter((r) => r.active && r.status === 'interested');
const funnel = PIPELINE.slice(PIPELINE.indexOf('applied') + 1).map((s) => {
  const n = applied.filter((r) => PIPELINE.indexOf(r.furthest) >= PIPELINE.indexOf(s)).length;
  return [s, n, pct(n, applied.length)];
});

const out = `# Application Tracker

Generated by the RoleForward plugin's \`tools/tracker.mjs\` on ${today} from each posting.md. Don't edit by hand. Raw data for analysis is in \`data/applications.csv\` and \`data/events.csv\`.

## Summary

- **Postings tracked:** ${rows.length} (${queue.length} shortlisted and waiting for review, ${evaluating.length} marked interested, ${rows.filter((r) => r.status === 'passed').length} passed on, ${rows.filter((r) => r.status === 'expired').length} expired)
- **Scout screening:** ${seen.length} watchlist postings seen (${seenBy('shortlisted')} shortlisted, ${seenBy('held')} held for a later run, ${seenBy('dropped')} dropped)
- **Applied:** ${applied.length}, of which ${applied.filter((r) => r.active).length} active, ${applied.filter((r) => r.referral === 'yes').length} with a referral
- **Response rate:** ${pct(applied.filter((r) => r.responded === 'yes').length, applied.length) || 'n/a'}, median ${median(applied.filter((r) => r.responded === 'yes').map((r) => r.first_response_days)) || 'n/a'} days to first response

## Needs Attention

${[...(visaOn() && deadlineLine() ? [`- **${deadlineLine()}**`] : []),...stale.map((r) => `- **${r.company}, ${r.role}:** no update in ${r.days_since_last_event} days (last: ${r.status}). Follow up, or log no-response.`),
  ...[...queue].sort(rankCompare).map((r) => `- **${r.company}, ${r.role}:** shortlisted ${r.shortlisted || 'unknown'}${r.role_fit ? `, role fit ${r.role_fit}/5` : ''}${r.preference_fit !== '' ? `, preference fit ${r.preference_fit}/5` : ''}. Interested or pass?`),
  ...evaluating.map((r) => `- **${r.company}, ${r.role}:** interested since ${r.interested || 'unknown'}. Apply or pass.`),
  ...unresearched.map((r) => `- **${r.company}:** company research ${r.researched ? `is from ${r.researched}, refresh it` : 'not done yet'} (${LIGHT ? 'interviewing' : 'applied, still active'}).`)].join('\n') || '- Nothing.'}

## Funnel (share of applications that reached each stage)

${applied.length ? md(['Stage', 'Reached', 'Share'], funnel) : 'No applications yet.'}

## Breakdowns

${applied.length ? BREAKDOWNS.map((k) => breakdown(applied, k, k.replace(/_/g, ' '))).join('\n\n') : 'No applications yet.'}

## Drops by Dealbreaker or Setting (all postings the scout has screened)

${dropCounts.length ? md(['Dealbreaker or setting', 'Dropped'], dropCounts) : 'Nothing dropped yet.'}

## All Postings

${md(['Company', 'Role', 'Track', 'Resume', 'Referral', 'Status', 'Applied', 'Last update', 'Role fit', 'Preference fit', 'Posting'],
  rows.map((r) => [r.company, r.role, r.track, r.resume, r.referral, r.status, r.applied, r.last_event,
    r.role_fit ? `${r.role_fit}/5` : '', r.preference_fit !== '' ? `${r.preference_fit}/5` : '', r.archived ? `archived ${r.archived}` : `[record](${r.id}/posting.md)`]))}
`;
writeFileSync(join(apps, 'tracker.md'), out);
// The same numbers as data, for the sheet's Stats tab (sheet.mjs rows stats).
const responded = applied.filter((r) => r.responded === 'yes');
writeFileSync(join(apps, 'data', 'stats.json'), JSON.stringify({
  updated: today,
  summary: [
    ['Postings tracked', rows.length], ['Shortlisted, waiting for review', queue.length], ['Marked interested', evaluating.length],
    ['Passed on', rows.filter((r) => r.status === 'passed').length], ['Expired', rows.filter((r) => r.status === 'expired').length],
    ['Archived (counted, folder removed)', rows.filter((r) => r.archived).length],
    ['Scout: postings screened', seen.length], ['Scout: shortlisted', seenBy('shortlisted')], ['Scout: held', seenBy('held')], ['Scout: dropped', seenBy('dropped')],
    ['Applied', applied.length], ['Applied, still active', applied.filter((r) => r.active).length], ['Applied with a referral', applied.filter((r) => r.referral === 'yes').length],
    ['Response rate', pct(responded.length, applied.length) || 'n/a'], ['Median days to first response', median(responded.map((r) => r.first_response_days)) || 'n/a'],
  ],
  funnel: funnel,
  breakdowns: Object.fromEntries(BREAKDOWNS.map((k) => [k, breakdownRows(applied, k)])),
  drops: dropCounts,
}, null, 2) + '\n');
buildIndex();
console.log(`Wrote applications/tracker.md, data/*.csv, and INDEX.md (${rows.length} posting${rows.length === 1 ? '' : 's'}, ${applied.length} applied)`);
