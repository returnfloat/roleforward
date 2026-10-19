// The scout's feeds (scout.mjs) against synthetic responses, one employer per source type, fully offline: a preload
// (mock-fetch.mjs) answers every request from feed-responses.mjs. These catch changes in how the scout reads a feed it
// already supports. A site changing its own format is caught by the live `scout.mjs validate`, never here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../plugins/roleforward/tools/csv.mjs';
import { buildWorkspace } from './fixture.mjs';
import { WATCHLIST } from './feed-responses.mjs';

// --import takes a file URL (a Windows path such as D:\... isn't one).
const PRELOAD = new URL('./mock-fetch.mjs', import.meta.url).href;

// A test workspace whose watchlist has one employer per source type, and a scout runner that logs its requests.
function feedWorkspace(opts) {
  const ws = buildWorkspace(opts);
  const md = ws.read('applications/watchlist.md');
  ws.write('applications/watchlist.md', md.slice(0, md.indexOf('| Employer A')) + WATCHLIST.map(([c, s, b]) => `| ${c} | ${s} | ${b} | Example reason | Test Domain |`).join('\n') + '\n');
  const logFile = join(ws.root, 'requests.jsonl');
  const env = (scenarios) => ({ ROLEFORWARD_TEST_SCENARIO: scenarios.join(','), ROLEFORWARD_TEST_LOG: logFile });
  ws.scout = (args = [], scenarios = []) => ws.run('scout', args, { node: ['--import', PRELOAD], env: env(scenarios) });
  ws.scoutFails = (args = [], scenarios = []) => ws.fails('scout', args, { node: ['--import', PRELOAD], env: env(scenarios) });
  ws.requests = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  ws.seen = () => Object.fromEntries(parseCsv(ws.read('applications/data/seen.csv')).map((r) => [r.key, r]));
  return ws;
}

// The postings that pass the title and place screen, with the place each feed's own fields give.
const EXPECTED = {
  'ashby:test-employer-b:test-ashby-1': 'Example City, ST; Remote, US; Remote; Hybrid',
  'lever:test-employer-c:test-lever-1': 'Example City, ST; Example City, ST; Remote, US; hybrid',
  'workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Senior-Data-Engineer_test-wd-01': 'Example City, ST',
  'workday:test-employer-d/wd1/Careers:/job/Remote/Staff-Data-Engineer_test-wd-02': 'Remote, US',
  'workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Lead-Data-Engineer_test-wd-41': 'Example City ST',
  'eightfold:careers.example.invalid/example.invalid/pcsx:7001': 'Example City, ST, United States; onsite',
  'eightfold:jobs.example.invalid/example.invalid/v2:8001': 'Remote, United States; remote',
  'smartrecruiters:TestEmployerI:9001': 'Example City, ST, US',
  'smartrecruiters:TestEmployerI:9002': 'Other City, ST, US, Remote',
  'amazon:-:test-amz-1': 'Example City, ST, USA',
  'google:-:test-goog-1': 'Example City, ST, USA',
  'apple:-:test-apl-1': 'Example City',
  'talentbrew:talentbrew.example.invalid/1001:tb-101': 'Example City, ST',
  'talentbrew:talentbrew.example.invalid/1001:5550002': 'Remote, US',
  'talentbrew:talentbrew.example.invalid/1001:tb-103': 'Example City, ST',
  'oracle:oracle.example.invalid/CX_1:3001': 'Example City, ST, United States; Remote, US; Hybrid',
  'successfactors:sf.example.invalid?locationsearch=United%20States:2001': 'Example City, ST, US +2 more...',
  'successfactors:sf.example.invalid?locationsearch=United%20States:2002': 'Remote, US',
  'icims:icims.example.invalid:4001': 'US-ST-Example City',
  'icims:icims.example.invalid:4002': 'US-ST-Other City; Remote',
  'page:page.example.invalid/sitemap.xml:/jobs/5001/senior-data-engineer': 'Example City, ST, US',
};

test('every source type is read, with the place from each feed\'s own fields', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout();
    assert.match(out, /^Scout \d{4}-\d{2}-\d{2}: 97 postings fetched from 15 companies/);
    const seen = ws.seen();
    for (const [key, place] of Object.entries(EXPECTED)) {
      assert.ok(seen[key], `missing ${key}`);
      assert.equal(seen[key].location, place, key);
      assert.equal(seen[key].decision, 'new', key);
    }
    for (const r of Object.values(seen)) assert.doesNotMatch(r.title, /Recruiter|Example Role|Unlisted/, `title screened out, never recorded: ${r.key}`);
    // A matching title remote only in another country is dropped and recorded; an office elsewhere is only counted.
    assert.deepEqual([seen['eightfold:careers.example.invalid/example.invalid/pcsx:7013'].decision, seen['eightfold:careers.example.invalid/example.invalid/pcsx:7013'].reason], ['dropped', 'Wrong place: London, United Kingdom; remote']);
    assert.equal(seen['greenhouse:test-employer-a:1003'], undefined, 'an office in London is not recorded');
    assert.match(out, /, 21 new\. 2 more had a matching title in the wrong place \(1 new remote roles in another country, recorded as dropped: Wrong place\)\.\n/);
    assert.doesNotMatch(out, /\[(short|repeat|drop|empty|error|down|check|closed)\]/);
  } finally { ws.cleanup(); }
});

test('posting dates are read from each feed\'s format', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const seen = ws.seen(), ymd = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    // Workday writes "Posted Today", "Posted Yesterday", and "Posted 30+ Days Ago".
    assert.equal(seen['workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Senior-Data-Engineer_test-wd-01'].posted, new Date().toLocaleDateString('en-CA'));
    assert.equal(seen['workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Lead-Data-Engineer_test-wd-41'].posted, new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA'));
    assert.equal(seen['lever:test-employer-c:test-lever-1'].posted, ymd(2), 'milliseconds');
    assert.equal(seen['eightfold:careers.example.invalid/example.invalid/pcsx:7001'].posted, ymd(4), 'seconds');
    assert.equal(seen['amazon:-:test-amz-1'].posted, new Date(new Date(Date.now() - 864e5).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })).toISOString().slice(0, 10), '"October 16, 2026"');
    assert.match(seen['icims:icims.example.invalid:4001'].posted, /^\d{4}-\d{2}-\d{2}$/, 'from the title attribute');
  } finally { ws.cleanup(); }
});

test('Workday pages through every posting, not just the first 40', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const posts = ws.requests().filter((r) => r.method === 'POST' && r.url.includes('myworkdayjobs.com')).map((r) => JSON.parse(r.body));
    assert.deepEqual(posts.map((b) => b.offset), [0, 20, 40]);
    assert.ok(posts.every((b) => b.searchText === 'data engineer' && b.limit === 20));
    assert.match(ws.read('applications/data/feed-health.csv'), /^Employer D,workday,test-employer-d\/wd1\/Careers,\d{4}-\d{2}-\d{2},45,45,45$/m);
  } finally { ws.cleanup(); }
});

test('Eightfold advances by what each page returned, and pauses between pages', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const log = ws.requests();
    const starts = log.filter((r) => r.url?.includes('/api/pcsx/search')).map((r) => +new URL(r.url).searchParams.get('start'));
    assert.deepEqual(starts, [0, 10, 20, 25]);
    assert.equal(log.filter((r) => r.wait === 1000).length, 4, 'a one-second pause after each Eightfold page (pcsx 3, v2 1)');
  } finally { ws.cleanup(); }
});

test('TalentBrew reads both layouts, keeps the page\'s own job id, and skips repeats across pages', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout();
    const keys = Object.keys(ws.seen()).filter((k) => k.startsWith('talentbrew:'));
    assert.deepEqual(keys.sort(), ['talentbrew:talentbrew.example.invalid/1001:5550002', 'talentbrew:talentbrew.example.invalid/1001:tb-101', 'talentbrew:talentbrew.example.invalid/1001:tb-103']);
    assert.match(ws.read('applications/data/feed-health.csv'), /^Employer M,talentbrew,talentbrew\.example\.invalid\/1001,\d{4}-\d{2}-\d{2},3,3,3$/m);
    assert.doesNotMatch(out, /\[repeat\] Employer M/);
  } finally { ws.cleanup(); }
});

test('every request names the scout in its user agent', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const requests = ws.requests().filter((r) => r.url);
    assert.ok(requests.length > 20, `${requests.length} requests`);
    for (const r of requests) assert.match(r.ua, /roleforward-scout/, r.url);
  } finally { ws.cleanup(); }
});

test('a posting already in seen.csv is not new, and a second run finds nothing new', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const seen = ws.seen();
    assert.equal(seen['greenhouse:test-employer-a:1001'].decision, 'shortlisted', 'the fixture had it shortlisted already');
    assert.equal(seen['ashby:test-employer-b:test-002'].decision, 'shortlisted');
    assert.match(ws.scout(), /, 0 new\. 2 more had a matching title in the wrong place\.\nTo screen: 21 new, 0 held/, 'the first run\'s new postings wait for screening');
  } finally { ws.cleanup(); }
});

test('more than one search term merges the results without duplicates', () => {
  const ws = feedWorkspace();
  try {
    ws.write('workspace.yaml', ws.read('workspace.yaml').replace('search_terms: [data engineer]', 'search_terms: [data engineer, data platform]'));
    ws.scout();
    const terms = ws.requests().filter((r) => r.method === 'POST').map((r) => JSON.parse(r.body).searchText);
    assert.deepEqual([...new Set(terms)], ['data engineer', 'data platform']);
    assert.match(ws.read('applications/data/feed-health.csv'), /^Employer D,workday,[^,]+,[^,]+,45,/m);
  } finally { ws.cleanup(); }
});

test('mark records a decision and its reason', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    const key = 'amazon:-:test-amz-1';
    assert.equal(ws.scout(['mark', key, 'dropped', 'Wrong level: example']).trim(), 'Employer J, Senior Data Engineer: dropped (Wrong level: example)');
    assert.deepEqual([ws.seen()[key].decision, ws.seen()[key].reason], ['dropped', 'Wrong level: example']);
    assert.match(ws.scoutFails(['mark', key, 'maybe']).out, /decision must be dropped, held, or shortlisted/);
  } finally { ws.cleanup(); }
});

test('validate opens one posting per source type end to end', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout(['validate']);
    assert.match(out, /0 source type\(s\) failed\.$/m);
    const results = JSON.parse(ws.read('applications/data/feed-validation.json')).results;
    assert.deepEqual(Object.keys(results).sort(), ['amazon', 'apple', 'ashby', 'eightfold', 'google', 'greenhouse', 'icims', 'lever', 'oracle', 'page', 'smartrecruiters', 'successfactors', 'talentbrew', 'workday']);
    for (const [source, r] of Object.entries(results)) assert.match(r, /^ok: /, source);
    assert.match(results.workday, /\(45 listed, \d+-word description\)/);
  } finally { ws.cleanup(); }
});

test('validate fails a source whose job page holds only a stub (the Apple bug)', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout(['validate'], ['apple-stub']);
    assert.match(out, /^FAIL apple +Employer L, title "Senior Data Engineer", 70-word description$/m);
    assert.match(out, /1 source type\(s\) failed\./);
  } finally { ws.cleanup(); }
});

test('show prints the description, the published pay, and the pay check', () => {
  const ws = feedWorkspace({ pay: { min: 180000 } });
  try {
    ws.scout();
    const gh = ws.scout(['show', 'greenhouse:test-employer-a:1001']);
    assert.match(gh, /^Senior Data Engineer\nRemote, US\nPay: Example Range: \$150,000 - \$190,000 USD\nPay check: reaches your floor \(posted \$150,000 to \$190,000, your floor \$180,000\)\n/);
    assert.match(gh, /\n\nPlaceholder description text/, 'HTML escaped twice is decoded');
    assert.doesNotMatch(gh, /&lt;|<p>/);
    assert.match(ws.scout(['show', 'lever:test-employer-c:test-lever-1']), /\nPay: \$150,000 - \$190,000 USD\n/);
    assert.match(ws.scout(['show', 'ashby:test-employer-b:test-ashby-1']), /\nPay: \$150K – \$190K\n/);
    const ymd = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    assert.match(ws.scout(['show', 'talentbrew:talentbrew.example.invalid/1001:tb-101']), new RegExp(`\\nPublished: ${ymd(5)}\\n`), 'an unpadded date is padded');
    assert.match(ws.scout(['show', 'successfactors:sf.example.invalid?locationsearch=United%20States:2001']), new RegExp(`\\nPublished: ${ymd(2)}\\n`));
  } finally { ws.cleanup(); }
});

test('show adds the sponsorship check with the visa module on', () => {
  const ws = feedWorkspace({ visa: true });
  try {
    ws.scout();
    assert.match(ws.scout(['show', 'oracle:oracle.example.invalid/CX_1:3001']), /\nSponsorship check: not mentioned\nSponsor history: /);
  } finally { ws.cleanup(); }
});

test('capture writes jd.md with the posting\'s details and escapes dollar signs', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    assert.match(ws.scout(['capture', 'greenhouse:test-employer-a:1001', 'applications/employer-a/captured']), /^Wrote applications\/employer-a\/captured\/jd\.md \(\d+ words\)\. Pay: Example Range/);
    const jd = ws.read('applications/employer-a/captured/jd.md');
    assert.match(jd, /^---\ntitle: "Job Description: Senior Data Engineer"\ncompany: "Employer A"\nlocation: "Remote, US"\n/);
    assert.match(jd, /\ncaptured_via: "Greenhouse public job board API"\n/);
    assert.match(jd, /\ncompensation: "Example Range: \$150,000 - \$190,000 USD"\n/);
  } finally { ws.cleanup(); }
});

test('a site under maintenance is reported as down, not as broken feeds', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout([], ['workday-down']);
    assert.match(out, /\[down\] workday: 1 employer under maintenance, so not checked this run \(Employer D\)\. Re-run once the site is back\. The feeds aren't broken\./);
    assert.doesNotMatch(out, /\[error\]/);
    assert.match(out, /Due now: run `scout\.mjs validate`/);
    const v = ws.scout(['validate'], ['workday-down']);
    assert.match(v, /^DOWN workday +Employer D: under maintenance \(redirected to community\.workday\.com\/maintenance-page\)$/m);
    assert.match(v, /1 under maintenance: run validate again once it is back\./);
    assert.match(ws.run('doctor'), /warn\s+Feed validation \(.*\): workday was under maintenance\. Run scout\.mjs validate again\./);
  } finally { ws.cleanup(); }
});

test('a 429 is retried after a wait, and one that persists is reported', () => {
  const ws = feedWorkspace();
  try {
    const once = ws.scout([], ['eightfold-429']);
    assert.doesNotMatch(once, /\[error\]/);
    assert.match(ws.read('applications/data/feed-health.csv'), /^Employer G,eightfold,[^,]+,[^,]+,25,/m);
    assert.ok(ws.requests().some((r) => r.wait === 5000), 'waited 5 seconds before the retry');
    const always = ws.scout([], ['eightfold-429-always']);
    assert.match(always, /\[error\] Employer G \(eightfold careers\.example\.invalid\/example\.invalid\/pcsx\): 429 https:\/\/careers\.example\.invalid\/api\/pcsx\/search/);
    assert.ok(ws.requests().some((r) => r.wait === 20000), 'and 20 seconds before the last try');
    ws.write('requests.jsonl', '');
    ws.scout([], ['eightfold-retry-after']);
    assert.ok(ws.requests().some((r) => r.wait === 7000), 'the site\'s Retry-After wait');
    assert.ok(!ws.requests().some((r) => r.wait === 5000), 'instead of the default 5 seconds');
  } finally { ws.cleanup(); }
});

test('health checks flag short, repeated, empty, and sharply smaller feeds', () => {
  const ws = feedWorkspace();
  try {
    ws.write('applications/data/feed-health.csv', 'company,source,board,last_run,last_count,expected,recent\nEmployer D,workday,test-employer-d/wd1/Careers,2026-01-01,200,200,200 200 200\n');
    const out = ws.scout([], ['greenhouse-short', 'lever-repeat', 'ashby-empty']);
    assert.match(out, /\[short\] Employer A: got 3 postings, but the site reports 30\. Paging or parsing may be broken\./);
    assert.match(out, /\[repeat\] Employer C: 1 duplicate postings\. Pages may be repeating\./);
    assert.match(out, /\[empty\] Employer B: the feed returned no postings\./);
    assert.match(out, /\[drop\] Employer D: 45 postings vs\. a usual 200\. The site may have changed\./);
  } finally { ws.cleanup(); }
});

// A posting waiting on the user's decision, at one of the synthetic employers.
function awaiting(ws, slug, role, { key = '', link = '', stage = 'shortlisted' } = {}) {
  const folder = `applications/${slug}/2026-01-01-${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  ws.write(`${folder}/posting.md`, `---\ncompany: ${slug}\nrole: ${role}\nposting: ${link}\nscout_key: ${key}\nevents:\n  - 2026-01-01 | shortlisted\n${stage === 'interested' ? '  - 2026-01-02 | interested\n' : ''}---\n`);
  return folder;
}

test('each posting awaiting a decision is checked on its own, with each site\'s gone signal', () => {
  const ws = feedWorkspace();
  try {
    const open = [
      awaiting(ws, 'employer-c', 'Lead Data Engineer', { key: 'lever:test-employer-c:test-lever-1' }),
      awaiting(ws, 'employer-n', 'Senior Data Engineer', { key: 'oracle:oracle.example.invalid/CX_1:3001', stage: 'interested' }),
      awaiting(ws, 'employer-l', 'Senior Data Engineer', { key: 'apple:-:test-apl-1', link: 'https://jobs.apple.com/en-us/details/test-apl-1/senior-data-engineer' }),
      awaiting(ws, 'employer-k', 'Senior Data Engineer', { key: 'google:-:test-goog-1', link: 'https://www.google.com/about/careers/applications/jobs/results/test-goog-1' }),
      awaiting(ws, 'employer-q', 'Senior Data Engineer', { link: 'https://page.example.invalid/jobs/5001/senior-data-engineer' }),
    ];
    const gone = {
      [awaiting(ws, 'employer-a', 'Gone Greenhouse Role', { key: 'greenhouse:test-employer-a:1999' })]: 'the site answers 404 for it',
      [awaiting(ws, 'employer-b', 'Gone Ashby Role', { key: 'ashby:test-employer-b:test-ashby-gone' })]: 'no longer on its Ashby board',
      [awaiting(ws, 'employer-d', 'Gone Workday Role', { key: 'workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Gone_test-wd-00' })]: 'the site answers 404 for it',
      [awaiting(ws, 'employer-h', 'Gone Eightfold Role', { key: 'eightfold:jobs.example.invalid/example.invalid/v2:8999' })]: 'the site answers 404 for it',
      [awaiting(ws, 'employer-i', 'Gone SmartRecruiters Role', { key: 'smartrecruiters:TestEmployerI:9999' })]: 'the site answers 404 for it',
      [awaiting(ws, 'employer-n', 'Gone Oracle Role', { key: 'oracle:oracle.example.invalid/CX_1:3999' })]: 'Oracle returns no requisition for it',
      [awaiting(ws, 'employer-o', 'Gone SuccessFactors Role', { key: 'successfactors:sf.example.invalid?locationsearch=United%20States:2999', link: 'https://sf.example.invalid/job/Gone/2999/' })]: 'the posting link now redirects to an error page',
      [awaiting(ws, 'employer-k', 'Gone Google Role', { key: 'google:-:test-goog-gone', link: 'https://www.google.com/about/careers/applications/jobs/results/test-goog-gone' })]: 'the link now shows the job search page',
      [awaiting(ws, 'employer-l', 'Gone Apple Role', { key: 'apple:-:test-apl-gone', link: 'https://jobs.apple.com/en-us/details/test-apl-gone/gone' })]: 'Apple reports the job as not found',
      [awaiting(ws, 'employer-j', 'Gone Amazon Role', { key: 'amazon:-:test-amz-gone', link: 'https://www.amazon.jobs/en/jobs/test-amz-gone/gone' })]: 'the site answers 404 for it',
      [awaiting(ws, 'employer-z', 'Gone Linked Role', { link: 'https://example.invalid/jobs/gone' })]: 'the site answers 404 for it',
    };
    const goneFolder = Object.keys(gone)[0];
    ws.write(`${goneFolder}/jd.md`, 'Saved job description.\n');
    ws.write(`${open[0]}/jd.md`, 'Saved job description.\n');
    const out = ws.scout();
    for (const [folder, why] of Object.entries(gone)) assert.ok(out.includes(`[closed] ${folder}: ${why}. Marked expired.`), `${folder}\n${out}`);
    // The run expires each one in place: the ending event, and the saved job description goes.
    for (const folder of Object.keys(gone)) assert.match(ws.read(`${folder}/posting.md`), /\n  - \d{4}-\d{2}-\d{2} \| expired \| posting closed\nupdated: \d{4}-\d{2}-\d{2}\n/, folder);
    assert.equal(existsSync(join(ws.root, goneFolder, 'jd.md')), false);
    assert.equal(existsSync(join(ws.root, open[0], 'jd.md')), true, 'an open posting keeps its job description');
    assert.doesNotMatch(ws.read(`${open[0]}/posting.md`), /expired/);
    assert.match(ws.scout(), /Closed shortlisted postings: 0\./, 'an expired posting is no longer checked');
    for (const folder of open) assert.ok(!out.includes(folder), `open: ${folder}`);
    assert.match(out, new RegExp(`Closed shortlisted postings: ${Object.keys(gone).length}\\.`));
    assert.doesNotMatch(out, /\[closed\] applications\/employer-b\/.*staff-data-engineer/, 'the interested fixture posting is still on its board');
  } finally { ws.cleanup(); }
});

test('a posting a capped or partial search leaves out stays open', () => {
  const ws = feedWorkspace();
  try {
    const older = awaiting(ws, 'employer-d', 'Senior Data Engineer, Archive', { key: 'workday:test-employer-d/wd1/Careers:/job/Example-City-ST/Senior-Data-Engineer-Archive_test-wd-99' });
    const unpaged = awaiting(ws, 'employer-g', 'Example Role 20', { key: 'eightfold:careers.example.invalid/example.invalid/pcsx:7020' });
    const out = ws.scout([], ['eightfold-429-later']);
    assert.match(out, /\[partial\] Employer G/);
    assert.ok(!out.includes(older) && !out.includes(unpaged), out);
    assert.match(out, /Closed shortlisted postings: 0\./);
  } finally { ws.cleanup(); }
});

test("a posting whose state can't be told is left alone, and flagged [check] after three runs in a row", () => {
  const ws = feedWorkspace();
  try {
    const folder = ws.folder('employer-a');
    for (const run of [1, 2]) assert.doesNotMatch(ws.scout([], ['greenhouse-detail-503']), /\[(closed|check)\]/, `run ${run}`);
    assert.match(ws.scout([], ['greenhouse-detail-503']), new RegExp(`\\[check\\] ${folder}: couldn't tell whether it's still open for 3 runs in a row \\(the site answered 503\\)\\. Open the posting by hand\\.`));
    assert.match(ws.read('applications/data/closure-checks.csv'), new RegExp(`^${folder},3,\\d{4}-\\d{2}-\\d{2},the site answered 503$`, 'm'));
    ws.scout();
    assert.doesNotMatch(ws.read('applications/data/closure-checks.csv'), new RegExp(folder), 'an open answer clears the count');
  } finally { ws.cleanup(); }
});

test('closed lists each awaiting posting\'s state without changing anything', () => {
  const ws = feedWorkspace();
  try {
    awaiting(ws, 'employer-i', 'Gone SmartRecruiters Role', { key: 'smartrecruiters:TestEmployerI:9999' });
    const out = ws.scout(['closed']);
    assert.match(out, new RegExp(`^open    ${ws.folder('employer-a')}$`, 'm'));
    assert.match(out, /^closed  applications\/employer-i\/2026-01-01-gone-smartrecruiters-role \(the site answers 404 for it\)$/m);
    assert.equal(existsSync(join(ws.root, 'applications', 'data', 'closure-checks.csv')), false);
    assert.doesNotMatch(ws.read('applications/employer-i/2026-01-01-gone-smartrecruiters-role/posting.md'), /expired/, 'closed changes nothing');
  } finally { ws.cleanup(); }
});

test('the fallback reader honors robots.txt', () => {
  const ws = feedWorkspace();
  try {
    assert.match(ws.scout([], ['page-robots-block']), /\[error\] Employer Q \(page page\.example\.invalid\/sitemap\.xml\): robots\.txt asks crawlers to stay off https:\/\/page\.example\.invalid\/sitemap\.xml/);
  } finally { ws.cleanup(); }
});

// A feed's work mode ("remote") applies to the places beside it, so "London, United Kingdom; remote" is remote in London.
test('a remote posting abroad does not pass the place screen', () => {
  const ws = feedWorkspace();
  try {
    ws.scout();
    assert.equal(ws.seen()['eightfold:careers.example.invalid/example.invalid/pcsx:7013'].decision, 'dropped');
  } finally { ws.cleanup(); }
});

test('a refused later page keeps the postings already fetched, as a partial feed', () => {
  const ws = feedWorkspace();
  try {
    const out = ws.scout([], ['eightfold-429-later']);
    assert.match(out, /\[partial\] Employer G: the site refused more pages \("data engineer": rate-limited after 10 postings\)\. Kept those, newest first; the oldest weren't checked\./);
    assert.doesNotMatch(out, /\[error\] Employer G/);
    assert.ok(ws.seen()['eightfold:careers.example.invalid/example.invalid/pcsx:7001'], 'the first page\'s match is kept');
    assert.doesNotMatch(out, /\[short\] Employer G/, 'a partial feed is not also reported as short');
  } finally { ws.cleanup(); }
});
