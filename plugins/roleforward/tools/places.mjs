// The place screen: whether a posting's location fits where the user can work. Settings in workspace.yaml:
//   targets.country   the one country the user works in, as a two-letter code (US). The feeds search it.
//   targets.remote    true (the default): remote roles anywhere in that country pass
//   targets.places    up to three places, each with its nearby names:  Denver, CO: [Boulder, Aurora]
// To tell which country a location names (London is in the UK), it reads data/places.json, a list of countries,
// region words, states and provinces, and cities built from Natural Earth, which is public domain.
//
// A location can list several places ("Seattle, WA; Remote, US"): any one that fits is enough. Each is judged so:
//   one of the user's places or its nearby names     passes, in any work mode
//   remote in the user's country                     passes when targets.remote is true
//   remote with no country ("Remote", "Anywhere")    passes, for the description to settle
//   remote in another country or region             drops ("London; remote", "Remote, EMEA")
//   only the country, or "Multiple locations"        passes, for the description to settle
//   anywhere else, onsite or hybrid                  drops
// A work mode on its own ("remote", "hybrid") applies to the places beside it, so "London; remote" is remote in London.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, regex } from './workspace.mjs';

export const MAX_PLACES = 3;
export const PLACES = JSON.parse(readFileSync(join(PLUGIN, 'data', 'places.json'), 'utf8'));
export const DEFAULT_REMOTE_WORDS = /remote|anywhere|distributed|virtual/i;

// Lowercase, accents and periods dropped, other punctuation as spaces: "U.S." is "us", "São Paulo" is "sao paulo".
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9']+/g, ' ').trim();
const MODE = /\b(hybrid|on ?site|in ?office|office|flexible|fully|work from home|wfh|first|only|friendly|optional|ok|or|and|full ?time)\b/g;
const MULTIPLE = /^(multiple locations?|various locations?|\d+ locations?|locations?)?$/;

// Lookups built once: every name is normalized the same way the posting's text is.
const COUNTRY = new Map(), REGION = new Map(), ADMIN1 = new Map(), CITY = new Map();
for (const [iso, c] of Object.entries(PLACES.countries)) for (const n of c.names) if (!COUNTRY.has(norm(n))) COUNTRY.set(norm(n), iso);
for (const [n, isos] of Object.entries(PLACES.regions)) REGION.set(norm(n), isos);
for (const [iso, names] of Object.entries(PLACES.admin1)) for (const n of Object.keys(names)) if (!ADMIN1.has(norm(n))) ADMIN1.set(norm(n), iso);
for (const [n, iso] of Object.entries(PLACES.cities)) CITY.set(norm(n), iso);
const ISO2 = new Set(Object.keys(PLACES.countries)), ISO3 = new Map(Object.entries(PLACES.countries).filter(([, c]) => c.iso3).map(([iso, c]) => [c.iso3, iso]));

// Every run of one to five words, with its position, so "new york" and "york" are both looked up.
function grams(text) {
  const w = norm(text).split(' ').filter(Boolean), out = [];
  for (let i = 0; i < w.length; i++) for (let n = 5; n >= 1; n--) if (i + n <= w.length) out.push([w.slice(i, i + n).join(' '), i]);
  return out;
}

// The settings, read once per screen. Places are "City, Region" keys with a list of nearby names.
export function placeSettings(cfg) {
  const home = String(cfg('targets.country', '') || 'US').toUpperCase();
  const places = cfg('targets.places', {}) || {};
  const local = new Set();
  for (const [place, nearby] of Object.entries(typeof places === 'object' ? places : {})) {
    local.add(norm(place.split(',')[0]));
    for (const n of [].concat(nearby || [])) if (norm(n)) local.add(norm(n));
  }
  local.delete('');
  const homeAdmin1 = PLACES.admin1[home] ?? {};
  return {
    home, local, remote: cfg('targets.remote', true) !== false, remoteWords: regex(cfg('scout.remote_words'), DEFAULT_REMOTE_WORDS),
    homeRegions: new Set(Object.keys(homeAdmin1).map(norm)), homeCodes: new Set(Object.values(homeAdmin1).filter(Boolean)),
  };
}

// What one place names: { local, iso, region, onlyCountry }. The user's own places, then their country's states and
// codes, are checked first, so "Atlanta, Georgia" stays in the US, "New Mexico" isn't Mexico, and "Remote, CA" is
// California, not Canada. Otherwise the longest name matched wins ("New South Wales" over "Wales"), then the one named
// last ("London, Ontario" is in Canada), then a country over a region word, a city, or a state elsewhere, in that order.
const KINDS = [[COUNTRY, 4, 'iso'], [REGION, 3, 'region'], [CITY, 2, 'iso'], [ADMIN1, 1, 'iso']];
export function classify(text, s) {
  const g = grams(text), words = norm(text).split(' '), codes = String(text).match(/\b[A-Z]{2,3}\b/g) ?? [];
  if (g.some(([n]) => s.local.has(n))) return { local: true };
  if (g.some(([n]) => s.homeRegions.has(n)) || codes.some((c) => s.homeCodes.has(c))) return { iso: s.home };
  const hits = [];
  for (const [n, i] of g) for (const [map, rank, kind] of KINDS) if (map.has(n)) hits.push({ n, i, len: n.split(' ').length, rank, [kind]: map.get(n) });
  for (const c of codes) {
    const iso = c.length === 2 ? (ISO2.has(c) ? c : '') : ISO3.get(c);
    if (iso) hits.push({ n: c.toLowerCase(), i: words.lastIndexOf(c.toLowerCase()), len: 1, rank: 4, iso });
  }
  if (!hits.length) return {};
  // Several countries in one place ("Remote (US or Canada)"): naming the user's country is enough.
  const named = new Set(hits.filter((h) => h.rank >= 3).map((h) => h.iso ?? h.region.join()));
  if (named.size > 1 && hits.some((h) => h.rank >= 3 && (h.iso === s.home || h.region?.includes(s.home)))) return { iso: s.home };
  const best = hits.sort((a, b) => b.len - a.len || b.i - a.i || b.rank - a.rank)[0];
  const rest = ` ${norm(text)} `.replace(` ${best.n} `, ' ').replace(MODE, ' ').replace(new RegExp(s.remoteWords.source, 'gi'), ' ').trim();
  return { iso: best.iso, region: best.region, onlyCountry: best.rank >= 3 && !rest };
}

// How a whole location string fares: 'fits', 'remote-abroad' (remote, but only in another country or region), or
// 'elsewhere' (an office somewhere else, or remote when targets.remote is false). The scout records remote-abroad drops
// so the user can check the country call, and skips the rest.
export function placeVerdict(location, s) {
  const parts = String(location ?? '').split(/[;•|]/).map((p) => p.trim()).filter(Boolean);
  const words = new RegExp(s.remoteWords.source, 'gi');
  const isMode = (p) => !norm(p).replace(words, ' ').replace(MODE, ' ').replace(/['\s]+/g, '');
  const modes = parts.filter(isMode), places = parts.filter((p) => !isMode(p));
  const remoteBeside = modes.some((p) => s.remoteWords.test(p));
  if (!places.length) return !remoteBeside || s.remote ? 'fits' : 'elsewhere';
  let abroad = false;
  for (const p of places) {
    const c = classify(p, s);
    if (c.local) return 'fits';
    const remote = remoteBeside || s.remoteWords.test(p);
    const atHome = c.iso === s.home || (c.region?.includes(s.home) ?? false);
    const unnamed = !c.iso && !c.region;
    if (remote && s.remote && (atHome || unnamed)) return 'fits';
    if (!remote && ((atHome && c.onlyCountry) || (unnamed && MULTIPLE.test(norm(p))))) return 'fits';
    if (remote && s.remote && !atHome && !unnamed) abroad = true;
  }
  return abroad ? 'remote-abroad' : 'elsewhere';
}

// Whether a whole location string passes the screen.
export const placeFits = (location, s) => placeVerdict(location, s) === 'fits';
