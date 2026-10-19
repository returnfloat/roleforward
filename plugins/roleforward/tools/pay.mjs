// Pay screening, a standalone setting (workspace.yaml targets.pay), separate from Dealbreakers and Preferences, and off
// unless the user gave a minimum (or their current pay as the floor) during onboarding. It only drops; it never scores.
//   targets.pay.min             the floor, yearly
//   targets.pay.unlisted        keep (default) or drop postings that publish no pay
//   targets.pay.drop_below      a posting is dropped only when the top of its published range is more than this many
//                               percent below the floor (default 10). Anything closer stays, with a note in its triage.

import { loadWorkspace } from './workspace.mjs';

const { get } = loadWorkspace();
const PAY = get('targets.pay', null);
export const PAY_MIN = +(PAY?.min ?? 0) || 0;
export const PAY_UNLISTED = String(PAY?.unlisted ?? 'keep').toLowerCase() === 'drop' ? 'drop' : 'keep';
export const DROP_BELOW = PAY?.drop_below === undefined || PAY?.drop_below === '' ? 10 : Math.max(0, +PAY.drop_below || 0);
export const PAY_ON = !!PAY && PAY_MIN > 0;

// The widest yearly range in a pay line or description: "$212,000 - $265,000", "272,000 USD - 431,250 USD", "$150K-$200K".
// Hourly ranges ("$90.08 - $127.17/hour", "$61.41 to $79.45 Hourly") count at HOURS_A_YEAR hours, and are kept as
// `hourly` too, so the check line can show what was posted. Several ranges (pay zones, levels) are merged.
export const HOURS_A_YEAR = 2080;
const HOURLY_AFTER = /^[^$\n]{0,25}?(\/\s?(hr|hour)\b|per hour|an hour|\bhourly\b)/i;
const HOURLY_BEFORE = /\b(hourly|per hour)\b[^$\n]{0,40}$/i;
export function parsePay(...texts) {
  const amt = (n, k) => { const v = +String(n).replace(/,/g, '') * (/k/i.test(k ?? '') ? 1000 : 1); return v >= 1000 ? v : NaN; };
  const found = [], hourly = [];
  for (const t of texts.filter(Boolean).map(String)) {
    for (const m of t.matchAll(/\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?)\s*([kK])?\s*(?:USD)?\s*(?:-|–|—|to)\s*\$?\s?(\d{2,3}(?:,\d{3})+|\d{2,3}(?:\.\d)?)\s*([kK])?/g)) {
      const lo = amt(m[1], m[2] || m[4]), hi = amt(m[3], m[4]);
      if (lo >= 10000 && hi >= lo && hi < 5e6) found.push([lo, hi]);
    }
    // Hourly: both ends carry a dollar sign, and "an hour", "/hr", or "hourly" sits right next to the range.
    for (const m of t.matchAll(/\$\s?(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/\s?(?:hr|hour))?\s*(?:-|–|—|to)\s*\$\s?(\d{1,3}(?:\.\d{1,2})?)/g)) {
      const lo = +m[1], hi = +m[2];
      if (!(lo >= 7 && hi >= lo && hi < 1000)) continue;
      if (HOURLY_AFTER.test(t.slice(m.index + m[0].length)) || HOURLY_BEFORE.test(t.slice(Math.max(0, m.index - 60), m.index))) hourly.push([lo, hi]);
    }
  }
  const all = [...found, ...hourly.map(([lo, hi]) => [Math.round(lo * HOURS_A_YEAR), Math.round(hi * HOURS_A_YEAR)])];
  if (!all.length) return null;
  const out = { min: Math.min(...all.map((f) => f[0])), max: Math.max(...all.map((f) => f[1])) };
  if (hourly.length) out.hourly = { min: Math.min(...hourly.map((f) => f[0])), max: Math.max(...hourly.map((f) => f[1])) };
  return out;
}
const fmt = (n) => `$${Math.round(n).toLocaleString()}`;

// A parsed range in words: "$90.08 to $127.17 an hour" or "$150,000 to $190,000".
export const payText = (range) => (range.hourly ? `$${range.hourly.min.toFixed(2)} to $${range.hourly.max.toFixed(2)} an hour` : `${fmt(range.min)} to ${fmt(range.max)}`);

// A published range ({min, max}, or null when none) against the floor. Returns null when pay screening is off, otherwise
// { drop, text }: drop is true only for a range whose top is more than DROP_BELOW% under the floor, or for no published
// pay when unlisted is drop.
export function payFit(range) {
  if (!PAY_ON) return null;
  if (!range) return { drop: PAY_UNLISTED === 'drop', text: `not published (your setting: ${PAY_UNLISTED} postings without pay)` };
  const hr = (n) => `$${n.toFixed(2)}`;
  const posted = range.hourly
    ? `posted ${hr(range.hourly.min)} to ${hr(range.hourly.max)} an hour, about ${fmt(range.min)} to ${fmt(range.max)} a year at ${HOURS_A_YEAR.toLocaleString()} hours, your floor ${fmt(PAY_MIN)}`
    : `posted ${fmt(range.min)} to ${fmt(range.max)}, your floor ${fmt(PAY_MIN)}`;
  if (range.max < PAY_MIN * (1 - DROP_BELOW / 100)) return { drop: true, text: `more than ${DROP_BELOW}% below your floor (${posted}): drop` };
  if (range.max < PAY_MIN) return { drop: false, text: `below your floor, within ${DROP_BELOW}% (${posted})` };
  return { drop: false, text: `reaches your floor (${posted})` };
}
