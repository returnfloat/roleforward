// The place screen (places.mjs) on the location formats job sites use, its settings, and the doctor's checks of them.
// City and country names here are public place names; the user's own area is a neutral stand-in (Denver).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from '../plugins/roleforward/tools/workspace.mjs';
import { classify, placeFits, placeSettings, placeVerdict, PLACES, MAX_PLACES } from '../plugins/roleforward/tools/places.mjs';
import { placeProblems } from '../plugins/roleforward/tools/doctor.mjs';

const settings = (targets, scout = {}) => placeSettings((p, f) => get({ targets, scout }, p, f));
const s = settings({ country: 'US', remote: true, places: { 'Denver, CO': ['Boulder', 'Aurora', 'Lakewood'] } });
const check = (cases, want, ss = s) => { for (const loc of cases) assert.equal(placeFits(loc, ss), want, JSON.stringify(loc)); };

test('a listed place or one of its nearby names passes in any work mode', () => {
  check(['Denver, CO', 'Boulder, Colorado', 'Aurora; Hybrid', 'Lakewood, CO (Onsite)', 'Seattle, WA; Denver, CO'], true);
});

test('remote in the home country passes, in the ways sites write it', () => {
  check(['Remote', 'Anywhere', 'Remote, US', 'Remote - United States', 'US Remote', 'Remote (US or Canada)', 'Remote - Americas',
    'New York, NY; Remote', 'Atlanta, Georgia; Remote', 'Remote, CA', 'Remote - New Mexico', 'Paris, TX; Remote', 'Washington, DC; Remote',
    'Other City, ST, US, Remote', 'US-ST-Other City; Remote', 'Remote; Hybrid',
    // Informal regions of the home country; "West Coast" is also a region of the Gambia and of New Zealand.
    'Remote (West Coast)', 'Remote - East Coast', 'Bay Area or Remote', 'Remote, Pacific Northwest'], true);
});

test('only the country, or several locations, passes for the description to settle', () => {
  check(['United States', 'USA', 'North America', 'Multiple Locations', '3 Locations', '', 'Hybrid'], true);
});

test('remote in another country or region drops', () => {
  check(['London, United Kingdom; remote', 'London; Remote', 'Remote - EMEA', 'Remote, Canada', 'Toronto, ON; Remote', 'Remote - Bengaluru',
    'Sydney, New South Wales, Australia; Remote', 'London, Ontario; Remote', 'Remote, Latin America', 'Remote - Europe', 'Paris, France; Remote',
    'Remote - Mexico City', 'Remote, UK', 'Remote (Germany)', 'Remote - APAC', 'Remote - Northern Ireland'], false);
});

test('onsite or hybrid anywhere else drops', () => {
  check(['Seattle, WA', 'New York, NY', 'Austin, TX; Hybrid', 'Hyderabad, Telangana, India', 'Tel Aviv, Israel', 'Other City, ST'], false);
});

test('which country a place names: home states first, then the longest name, then the one named last', () => {
  assert.deepEqual(classify('Atlanta, Georgia', s), { iso: 'US' }, 'a home state, not the country Georgia');
  assert.deepEqual(classify('Remote, CA', s), { iso: 'US' }, 'California, not Canada');
  assert.equal(classify('Sydney, New South Wales', s).iso, 'AU', 'New South Wales, not Wales');
  assert.equal(classify('London, Ontario', s).iso, 'CA', 'the province named last');
  assert.equal(classify('London', s).iso, 'GB', 'a city on its own is its most populous match');
  assert.equal(classify('São Paulo', s).iso, 'BR', 'accents are ignored');
  assert.deepEqual(classify('Remote - EMEA', s).region.includes('GB'), true);
  assert.deepEqual(classify('Somewhere Unknown', s), {});
});

test('remote switched off: only the listed places pass', () => {
  const office = settings({ country: 'US', remote: false, places: { 'Denver, CO': ['Boulder'] } });
  check(['Denver, CO', 'Boulder; Remote'], true, office);
  check(['Remote', 'Remote, US', 'New York, NY; Remote'], false, office);
});

test('a home country outside the US uses its own states and codes', () => {
  const uk = settings({ country: 'GB', remote: true, places: { 'Manchester, England': ['Salford'] } });
  check(['Manchester', 'Remote, UK', 'Remote - United Kingdom', 'London; Remote', 'Remote - EMEA'], true, uk);
  check(['Remote, US', 'Remote, Canada', 'London'], false, uk);
});

test('custom remote words count as remote', () => {
  const wfh = settings({ country: 'US', places: { 'Denver, CO': [] } }, { remote_words: 'remote|telework' });
  check(['Telework, US', 'Telework'], true, wfh);
  check(['Telework - Germany'], false, wfh);
});

test('the place list covers what the screen needs', () => {
  assert.ok(Object.keys(PLACES.countries).length > 200);
  assert.equal(PLACES.countries.FR.iso3, 'FRA');
  assert.equal(PLACES.cities.london, 'GB');
  assert.ok(PLACES.regions.emea.includes('DE') && !PLACES.regions.emea.includes('US'));
  assert.equal(PLACES.admin1.US.california, 'CA');
  assert.match(PLACES.about, /Natural Earth.*public domain/);
});

test('the doctor checks the place settings', () => {
  const doc = (targets) => placeProblems((p, f) => get({ targets }, p, f)).map((x) => `${x.level}: ${x.text}`);
  assert.deepEqual(doc({ country: 'US', places: { 'Denver, CO': ['Boulder'] } }), []);
  const four = Object.fromEntries(['A', 'B', 'C', 'D'].map((x) => [`Example ${x}, ST`, []]));
  assert.ok(doc({ country: 'US', places: four }).some((l) => l.startsWith(`problem: workspace.yaml targets.places lists 4 places. RoleForward uses at most ${MAX_PLACES}`)));
  assert.ok(doc({ country: 'XX', places: {} }).some((l) => /^problem: .*"XX" isn't a two-letter country code/.test(l)));
  assert.ok(doc({ country: 'GB', places: { 'Manchester, England': [] } }).some((l) => /^warn: .*the job feeds search the US only today/.test(l)));
  assert.ok(doc({ country: 'US', places: { 'Denver, CO': 'Boulder' } }).some((l) => /^problem: .*nearby names should be a list/.test(l)));
  assert.ok(doc({ country: 'US', remote: false }).some((l) => /^problem: .*no posting can pass the place screen/.test(l)));
  assert.ok(doc({ country: 'US' }).some((l) => /^warn: .*only remote postings pass/.test(l)));
});

test('a failed place says why: remote only in another country, or somewhere else', () => {
  assert.equal(placeVerdict('Remote, US', s), 'fits');
  for (const loc of ['London; Remote', 'Remote - EMEA', 'UK - Remote', 'Canada, Remote', 'Remote - Netherlands; Remote - UK']) assert.equal(placeVerdict(loc, s), 'remote-abroad', loc);
  for (const loc of ['Seattle, WA', 'London, UK', 'Austin, TX; Hybrid', 'Seattle, WA; Remote - UK']) assert.equal(placeVerdict(loc, s), loc.includes('Remote') ? 'remote-abroad' : 'elsewhere', loc);
  const office = settings({ country: 'US', remote: false, places: { 'Denver, CO': [] } });
  assert.equal(placeVerdict('Remote, US', office), 'elsewhere', 'remote when remote is off is not a country call');
});
