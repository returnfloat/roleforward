#!/usr/bin/env node
// Builds plugins/roleforward/data/places.json, the place list the scout's place screen uses to tell which country a
// posting is in (London is in the UK). For RoleForward's developers: users never run this, and it isn't in the plugin.
//
// Source: Natural Earth (naturalearthdata.com), which is public domain. Download these three files from
// https://github.com/nvkelso/natural-earth-vector/tree/master/geojson into one folder, then run
//   node scripts/build-places.mjs <that folder>
//   ne_50m_admin_0_countries.geojson         countries, codes, continents
//   ne_10m_admin_1_states_provinces.geojson  states and provinces
//   ne_10m_populated_places_simple.geojson   cities

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/build-places.mjs <folder with the Natural Earth geojson files>'); process.exit(1); }
const load = (f) => JSON.parse(readFileSync(join(dir, `${f}.geojson`), 'utf8')).features.map((x) => x.properties);
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'plugins', 'roleforward', 'data', 'places.json');
const low = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- Countries: the code is ISO_A2, or ISO_A2_EH where ISO_A2 is -99 (France, Norway) ----
const countries = {};
for (const c of load('ne_50m_admin_0_countries')) {
  const iso = c.ISO_A2 !== '-99' ? c.ISO_A2 : c.ISO_A2_EH;
  if (!/^[A-Z]{2}$/.test(iso) || countries[iso]) continue;
  countries[iso] = { name: c.NAME, iso3: [c.ISO_A3, c.ISO_A3_EH].find((x) => /^[A-Z]{3}$/.test(x)) ?? '', continent: c.CONTINENT, region: c.REGION_UN, subregion: c.SUBREGION,
    names: [...new Set([c.NAME, c.NAME_LONG, c.FORMAL_EN].filter(Boolean).map(low))] };
}
// The names postings use that Natural Earth doesn't list.
const ALIASES = {
  US: ['united states', 'usa', 'u.s.', 'u.s.a.'], GB: ['uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  KR: ['korea', 'south korea'], CZ: ['czech republic', 'czechia'], NL: ['holland', 'the netherlands'], AE: ['uae', 'u.a.e.', 'dubai'], RU: ['russia'],
  VN: ['vietnam'], TW: ['taiwan'], IE: ['ireland'], CN: ['china', 'prc'], HK: ['hong kong'], MO: ['macau', 'macao'], PH: ['philippines'],
  BO: ['bolivia'], VE: ['venezuela'], IR: ['iran'], SY: ['syria'], LA: ['laos'], MD: ['moldova'], TZ: ['tanzania'], CI: ['ivory coast', "cote d'ivoire"],
};
for (const [iso, names] of Object.entries(ALIASES)) if (countries[iso]) countries[iso].names = [...new Set([...countries[iso].names, ...names])];

// ---- Region words: which countries each one covers ----
const where = (test) => Object.entries(countries).filter(([iso, c]) => test(c, iso)).map(([iso]) => iso).sort();
const LATAM_SUB = ['South America', 'Central America', 'Caribbean'];
const regions = {
  emea: where((c) => ['Europe', 'Africa'].includes(c.continent) || c.subregion === 'Western Asia'),
  europe: where((c) => c.continent === 'Europe'), eu: where((c) => c.continent === 'Europe'),
  apac: where((c) => ['Asia', 'Oceania'].includes(c.continent)), 'asia pacific': where((c) => ['Asia', 'Oceania'].includes(c.continent)),
  asia: where((c) => c.continent === 'Asia'), oceania: where((c) => c.continent === 'Oceania'), africa: where((c) => c.continent === 'Africa'),
  'middle east': where((c, iso) => c.subregion === 'Western Asia' || ['EG', 'IR'].includes(iso)),
  latam: [...where((c) => LATAM_SUB.includes(c.subregion)), 'MX'].sort(), 'latin america': [...where((c) => LATAM_SUB.includes(c.subregion)), 'MX'].sort(),
  'south america': where((c) => c.subregion === 'South America'),
  'north america': ['CA', 'MX', 'US'], americas: where((c) => c.region === 'Americas'),
  nordics: ['DK', 'FI', 'IS', 'NO', 'SE'], dach: ['AT', 'CH', 'DE'], benelux: ['BE', 'LU', 'NL'], anz: ['AU', 'NZ'],
};

// ---- States and provinces: names for every country, postal codes for the country's own addresses ----
// Names made only of generic words ("Central", "West Coast", "Northern Islands") read as ordinary words in a posting,
// so they're left out.
const GENERIC_WORD = new Set(['north', 'south', 'east', 'west', 'central', 'northern', 'southern', 'eastern', 'western', 'upper', 'lower', 'middle',
  'greater', 'inner', 'outer', 'capital', 'centre', 'center', 'island', 'islands', 'coast', 'coastal', 'mountain', 'mountains', 'highlands', 'lowlands',
  'lake', 'lakes', 'river', 'valley', 'plains', 'region', 'province', 'district', 'federal', 'city', 'territory', 'and', 'of', 'the']);
const generic = (n) => n.split(/[\s-]+/).every((w) => GENERIC_WORD.has(w));
// Informal regions postings use for parts of a country ("Remote (West Coast)"), counted as that country's own.
const INFORMAL = {
  US: ['west coast', 'east coast', 'midwest', 'pacific northwest', 'northeast', 'southeast', 'southwest', 'northwest', 'mountain west', 'new england',
    'mid-atlantic', 'mid atlantic', 'bay area', 'sf bay area', 'silicon valley', 'tri-state area', 'dmv', 'continental us', 'contiguous us', 'lower 48'],
  CA: ['western canada', 'eastern canada', 'atlantic canada', 'the prairies', 'greater toronto area', 'gta'],
  GB: ['the midlands', 'midlands', 'home counties', 'south east england', 'north west england'],
};
const admin1 = {};
for (const a of load('ne_10m_admin_1_states_provinces')) {
  const iso = a.iso_a2;
  if (!countries[iso]) continue;
  for (const n of new Set([a.name_en, a.name].map(low))) {
    if (n.length < 4 || generic(n) || /\d/.test(n)) continue;
    (admin1[iso] ??= {})[n] = /^[A-Z]{2}$/.test(a.postal) ? a.postal : '';
  }
}

for (const [iso, names] of Object.entries(INFORMAL)) for (const n of names) (admin1[iso] ??= {})[n] = '';

// ---- Cities: each name points to its most populous match (London is the UK's, Sydney Australia's) ----
const best = {};
for (const p of load('ne_10m_populated_places_simple')) {
  if (!countries[p.iso_a2] || !(p.pop_max >= 100000 || p.adm0cap)) continue;
  for (const n of new Set([p.name, p.nameascii].map(low))) {
    if (n.length < 3 || /\d/.test(n)) continue;
    if (!best[n] || p.pop_max > best[n][1]) best[n] = [p.iso_a2, p.pop_max];
  }
}
const cities = Object.fromEntries(Object.entries(best).sort(([a], [b]) => a.localeCompare(b)).map(([n, [iso]]) => [n, iso]));

const out = {
  about: 'Countries, region words, states and provinces, and cities, for the scout\'s place screen. Built from Natural Earth (naturalearthdata.com), which is public domain, by RoleForward\'s scripts/build-places.mjs.',
  countries: Object.fromEntries(Object.entries(countries).sort().map(([iso, c]) => [iso, { name: c.name, iso3: c.iso3, names: c.names }])),
  regions, admin1, cities,
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${OUT}: ${Object.keys(countries).length} countries, ${Object.keys(regions).length} region words, ${Object.values(admin1).reduce((n, a) => n + Object.keys(a).length, 0)} states and provinces, ${Object.keys(cities).length} cities, ${Math.round(JSON.stringify(out).length / 1024)} KB.`);
