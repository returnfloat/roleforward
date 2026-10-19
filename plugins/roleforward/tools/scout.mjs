#!/usr/bin/env node
// The mechanical half of /scout (the judgment half is .claude/skills/scout/SKILL.md).
// Reads applications/watchlist.md, pulls every company's public job feed, keeps titles that pass the workspace's screen
// (workspace.yaml scout.*) in places that fit (targets.places, places.mjs), and records each one once in
// applications/data/seen.csv. A matching title that's remote only in another country is recorded too, as dropped (Wrong
// place). Nothing else is written to the vault: postings only get a folder when the skill shortlists them.
//
// Usage:
//   node tools/scout.mjs                            run: fetch, filter, update seen.csv, write output/scout/latest.json
//   node tools/scout.mjs show <key>                 print a posting's details and plain-text description
//   node tools/scout.mjs capture <key> <folder>     write <folder>/jd.md for a posting (also works from /apply)
//   node tools/scout.mjs mark <key> <decision> "<reason>"   decision: dropped | held | shortlisted
//   node tools/scout.mjs closed                     whether each posting awaiting a decision is open, closed, or unclear
//   node tools/scout.mjs validate                   open one real posting per source type end to end (monthly, or after a warning)
//
// Every run also checks each feed for silent failures: [empty] (nothing came back), [short] (fewer postings than the
// site reports), [repeat] (duplicate pages), [drop] (far below its usual count), and [partial] (a site refused later
// pages). Counts are kept in applications/data/feed-health.csv. Postings awaiting a decision are checked on their own
// ([closed] postings are marked expired, and [check] flags one that stays unclear).
//
// Sources: greenhouse, ashby, lever, workday, talentbrew, eightfold, smartrecruiters, oracle, successfactors, icims,
// amazon, google, apple, and page (the fallback for any other careers site), plus manual reminders.
//
// A key is "<source>:<board>:<job id>", as printed by a run.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readCsv, writeCsv } from './csv.mjs';
import { readFrontmatter, parseEvent, appendEvent } from './frontmatter.mjs';
import { loadWorkspace } from './workspace.mjs';
import { visaOn, sponsorshipText, historyLine, deadlineLine } from './visa.mjs';
import { screens } from './screen.mjs';
import { parsePay, payFit, payText } from './pay.mjs';
export { parsePay };

const { root, get: cfg } = loadWorkspace();
const apps = join(root, 'applications');
const SEEN = join(apps, 'data', 'seen.csv');
// Feed health: each company's recent posting counts, and the date of the last full validation.
const HEALTH = join(apps, 'data', 'feed-health.csv');
const HEALTH_COLS = ['company', 'source', 'board', 'last_run', 'last_count', 'expected', 'recent'];
const VALIDATED = join(apps, 'data', 'feed-validation.json');
const SEEN_COLS = ['key', 'company', 'title', 'location', 'posted', 'url', 'first_seen', 'last_seen', 'decision', 'reason'];
const today = new Date().toLocaleDateString('en-CA');
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh) roleforward-scout' };

// Title and place screens (workspace.yaml scout.*), shared with discover.mjs.
const { titleOk, placeVerdict } = screens(cfg);
// Search terms for feeds that search (Workday, Eightfold, and the others below). List feeds return every posting.
const TERMS = [].concat(cfg('scout.search_terms', []) || []).filter(Boolean);
// Pay against the user's optional range (targets.pay): the drop rule and the wording live in pay.mjs, shared with fit.mjs.
// "Pay check" text for show, empty when pay is off.
const payCheck = (d) => payFit(parsePay(d.pay, d.body))?.text ?? '';
const GOOGLE_LEVELS = [].concat(cfg('scout.google_levels', []) || []).map((l) => `&target_level=${l}`).join('');

// HTML entities, decoded twice because Greenhouse escapes its HTML a second time.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', bull: '-', middot: '-', reg: '\u00ae', trade: '\u2122', copy: '\u00a9' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const text = (html) => decode(decode(String(html ?? '')))
  .replace(/<\/(p|li|h\d|div|ul|ol)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const day = (v) => (v ? new Date(typeof v === 'number' ? v : v).toISOString().slice(0, 10) : '');
// Workday says "Posted Today", "Posted Yesterday", or "Posted 12 Days Ago" ("30+" means at least 30).
const ago = (v) => { const m = String(v ?? '').match(/today|yesterday|(\d+)\+? days? ago/i); if (!m) return ''; const n = /today/i.test(m[0]) ? 0 : /yesterday/i.test(m[0]) ? 1 : +m[1]; return new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA'); };
// A site in planned maintenance redirects every request to a maintenance or outage page (Workday does this on many weekends).
// That's an outage to wait out, not a broken feed, so it gets its own error.
const DOWN = /maintenance|outage/i;
const isDown = (r) => r.redirected && DOWN.test(r.url);
const downError = (r) => { const u = new URL(r.url); return Object.assign(new Error(`under maintenance (redirected to ${u.host}${u.pathname})`), { down: true }); };
// Retries "too many requests" (429) and brief server errors twice, waiting 5s then 20s, or as long as the site's
// Retry-After header asks (at most a minute), before giving up.
const retryAfter = (r) => {
  const v = r.headers?.get?.('retry-after');
  const ms = !v ? NaN : /^\d+$/.test(v) ? +v * 1000 : Date.parse(v) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60000) : 0;
};
const get = async (url, opt = {}) => {
  for (const wait of [5000, 20000, 0]) {
    const r = await fetch(url, { ...opt, headers: { ...UA, ...opt.headers } });
    if (isDown(r)) throw downError(r);
    if (r.ok) return r;
    if (!wait || ![429, 502, 503].includes(r.status)) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, retryAfter(r) || wait));
  }
};
const json = async (url, opt) => (await get(url, opt)).json();

// Records how many postings a feed says it has (capped at what we fetch), so a run can spot incomplete fetches.
const expect = (total, cap, list) => { if (Number.isFinite(+total) && total !== null) list.expected = Math.min(+total, cap); return list; };

// ---- Watchlist ----
function watchlist() {
  const md = readFileSync(join(apps, 'watchlist.md'), 'utf8');
  const rows = md.slice(md.indexOf('## Watchlist')).split(/\r?\n/).filter((l) => /^\|/.test(l)).slice(2);
  return rows.map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([company, source, board, why]) => ({ company, source, board, why }))
    .filter((w) => w.company && !w.company.startsWith('~') && w.source !== 'manual');
}

// ---- Feeds: each returns [{ id, title, location, posted, url }] ----
const FEEDS = {
  async greenhouse(b) {
    const j = await json(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`);
    return expect(j.meta?.total, Infinity, j.jobs.map((x) => ({ id: String(x.id), title: x.title, location: x.location?.name ?? '', posted: day(x.first_published || x.updated_at), url: x.absolute_url })));
  },
  async ashby(b) {
    const j = await json(`https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=true`);
    return j.jobs.filter((x) => x.isListed !== false).map((x) => ({
      id: x.id, title: x.title, posted: day(x.publishedAt), url: x.jobUrl,
      location: [x.location, ...(x.secondaryLocations || []).map((s) => s.location), x.isRemote ? 'Remote' : '', x.workplaceType].filter(Boolean).join('; '),
    }));
  },
  async lever(b) {
    const j = await json(`https://api.lever.co/v0/postings/${b}?mode=json`);
    return j.map((x) => ({ id: x.id, title: x.text, location: [x.categories?.location, ...(x.categories?.allLocations || []), x.workplaceType].filter(Boolean).join('; '), posted: day(x.createdAt), url: x.hostedUrl }));
  },
  async workday(b, term) {
    const [t, w, site] = b.split('/');
    const base = `https://${t}.${w}.myworkdayjobs.com`;
    const out = [];
    let total = 0; // Workday reports the total on the first page only; later pages say 0.
    for (let offset = 0; offset < 200; offset += 20) {
      const j = await json(`${base}/wday/cxs/${t}/${site}/jobs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: term }),
      });
      if (!offset) { total = j.total ?? 0; expect(total, 200, out); }
      // Some tenants (Accenture) leave locationsText out and put the place in bulletFields after the requisition ID.
      // Failing both, the job path starts with the place: /job/<Place>/<Title>_<ID>.
      const place = (x) => x.locationsText || (x.bulletFields || []).slice(1).join('; ')
        || (x.externalPath?.match(/^\/job\/([^/]+)\//)?.[1] || '').replace(/-+/g, ' ');
      for (const x of j.jobPostings || []) out.push({ id: x.externalPath, title: x.title, location: place(x), posted: ago(x.postedOn), url: `${base}/en-US/${site}${x.externalPath}` });
      if (offset + 20 >= total || !(j.jobPostings || []).length) break;
    }
    return out;
  },
  // Eightfold career sites (for example Microsoft and Netflix). Board: "<host>/<domain>/<pcsx|v2>". Newest first, capped.
  async eightfold(b, term) {
    const [host, domain, api] = b.split('/');
    const out = [];
    // Eightfold returns 10 per page whatever num says, so advance by what actually came back.
    for (let start = 0; start < 300; ) {
      const url = api === 'pcsx'
        ? `https://${host}/api/pcsx/search?domain=${domain}&query=${encodeURIComponent(term)}&location=United%20States&start=${start}&num=50&sort_by=timestamp`
        : `https://${host}/api/apply/v2/jobs?domain=${domain}&query=${encodeURIComponent(term)}&start=${start}&num=50&sort_by=timestamp`;
      // A refusal (429) after the first page keeps what came back, newest first, and the run reports it as [partial].
      let j;
      try { j = await json(url); } catch (e) { if (!start || !/^429 /.test(e.message)) throw e; out.partial = `rate-limited after ${start} postings`; break; }
      const list = api === 'pcsx' ? j.data?.positions ?? [] : j.positions ?? [];
      if (!start) expect(api === 'pcsx' ? j.data?.count : j.count, 300, out);
      for (const x of list) out.push({
        id: String(x.id), title: x.name, location: [...(x.locations || []), x.workLocationOption ?? x.work_location_option].filter(Boolean).join('; '),
        posted: day((x.postedTs ?? x.t_create) * 1000), url: api === 'pcsx' ? `https://${host}${x.positionUrl}` : x.canonicalPositionUrl,
      });
      if (!list.length) break;
      start += list.length;
      await new Promise((r) => setTimeout(r, 1000)); // Microsoft rate-limits (429) paging faster than this.
    }
    return out;
  },
  // SmartRecruiters (ServiceNow). Board: the company identifier.
  async smartrecruiters(b, term) {
    const out = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const j = await json(`https://api.smartrecruiters.com/v1/companies/${b}/postings?q=${encodeURIComponent(term)}&limit=100&offset=${offset}`);
      if (!offset) expect(j.totalFound, 1000, out);
      for (const x of j.content || []) out.push({
        id: x.id, title: x.name, posted: day(x.releasedDate), url: `https://jobs.smartrecruiters.com/${b}/${x.id}`,
        location: [x.location?.city, x.location?.region, x.location?.country?.toUpperCase(), x.location?.remote ? 'Remote' : ''].filter(Boolean).join(', '),
      });
      if (offset + 100 >= (j.totalFound ?? 0)) break;
    }
    return out;
  },
  // amazon.jobs: the 1,000 most recent US postings for the term.
  async amazon(b, term) {
    const out = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const j = await json(`https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(term)}&country=USA&sort=recent&result_limit=100&offset=${offset}`);
      if (!offset) expect(j.hits, 1000, out);
      for (const x of j.jobs || []) out.push({ id: x.id_icims, title: x.title, location: x.normalized_location || x.location, posted: day(x.posted_date), url: `https://www.amazon.jobs${x.job_path}` });
      if (!(j.jobs || []).length || offset + 100 >= j.hits) break;
    }
    return out;
  },
  // Google: results are embedded in the search page. Levels from scout.google_levels (all when unset), newest first.
  async google(b, term) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const html = await (await get(`https://www.google.com/about/careers/applications/jobs/results?q=${encodeURIComponent(term)}&location=United%20States${GOOGLE_LEVELS}&sort_by=date&page=${page}`)).text();
      const m = html.match(/AF_initDataCallback\(\{key: 'ds:1', hash: '\d+', data:([\s\S]*?), sideChannel: \{\}\}\);<\/script>/);
      const data = m ? JSON.parse(m[1]) : [];
      const rows = data[0] ?? [];
      if (page === 1) expect(data[2], 200, out);
      for (const r of rows) {
        const locs = (r.find((v) => Array.isArray(v) && Array.isArray(v[0]) && typeof v[0][0] === 'string' && Array.isArray(v[0][1])) || []).map((l) => l[0]);
        out.push({ id: r[0], title: r[1], location: locs.join('; '), posted: '', url: `https://www.google.com/about/careers/applications/jobs/results/${r[0]}` });
      }
      if (rows.length < 20) break;
    }
    return out;
  },
  // Apple: results are embedded in the search page as router data. Newest first.
  async apple(b, term) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const html = await (await get(`https://jobs.apple.com/en-us/search?search=${encodeURIComponent(term)}&sort=newest&location=united-states-USA&page=${page}`)).text();
      const m = html.match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("([\s\S]*?)"\);/);
      const data = m ? JSON.parse(JSON.parse(`"${m[1]}"`)) : {};
      const found = Object.values(data.loaderData || {}).find((v) => v?.searchResults);
      const rows = found?.searchResults ?? [];
      if (page === 1) expect(found?.totalRecords, 200, out);
      for (const x of rows) out.push({
        id: x.id, title: x.postingTitle, location: (x.locations || []).map((l) => l.name).join('; '), posted: day(x.postDateInGMT || x.postingDate),
        url: `https://jobs.apple.com/en-us/details/${x.id}/${x.transformedPostingTitle || ''}`,
      });
      if (rows.length < 20) break;
    }
    return out;
  },
  async talentbrew(b, term) {
    const [host, org] = b.split('/');
    const out = [];
    // The results endpoint pages properly at 100 per page. The /search-jobs/<q>/<org>/<page> path stops after page 2.
    for (let page = 1; page <= 10; page++) {
      const q = `ActiveFacetID=0&CurrentPage=${page}&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=${encodeURIComponent(term)}&Location=&ShowRadius=False&IsPagination=False&FacetType=0&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&OrganizationIds=${org}`;
      const html = (await json(`https://${host}/search-jobs/results?${q}`, { headers: { 'x-requested-with': 'XMLHttpRequest' } })).results ?? '';
      // TalentBrew sites use two layouts: the title in an <h2> inside the job link (Intuit), or the link inside the <h2>
      // (Rady Children's). Read each job link, then take the first location that follows it.
      const links = [...html.matchAll(/<a[^>]*href="(\/job\/[^"]+\/(\d+))"[^>]*>([\s\S]*?)<\/a>/g)];
      const items = links.map((m, i) => {
        const after = html.slice(m.index, links[i + 1]?.index ?? m.index + 4000);
        // Keep the page's own data-job-id when the link has one (Intuit's differs from the URL number), so keys stay stable.
        return [m[1], m[0].match(/data-job-id="([^"]+)"/)?.[1] ?? m[2], text(m[3].match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? m[3]), text(after.match(/job-location[^>]*>([^<]*)</)?.[1] ?? '')];
      }).filter(([, , title]) => title);
      const ids = new Set(out.map((o) => o.id));
      for (const [path, id, title, location] of items) if (!ids.has(id)) { ids.add(id); out.push({ id, title, location, posted: '', url: `https://${host}${path}` }); }
      if (page === 1) expect(+(html.match(/data-total-results="(\d+)"/)?.[1] ?? NaN), 1000, out);
      const pages = +(html.match(/data-total-pages="(\d+)"/)?.[1] ?? html.match(/pagination-total-pages">of (\d+)/)?.[1] ?? 1);
      if (page >= pages || !items.length) break;
    }
    return out;
  },
  // Oracle Recruiting Cloud. Board: "<host>/<site number>", for example "jpmc.fa.oraclecloud.com/CX_1001". Newest first, capped.
  async oracle(b, term) {
    const [host, site] = b.split('/');
    const out = [];
    for (let offset = 0; offset < 200; offset += 25) {
      const j = await json(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${site},keyword=${encodeURIComponent(term)},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`);
      const it = j.items?.[0] ?? {};
      if (!offset) expect(it.TotalJobsCount, 200, out);
      const list = it.requisitionList ?? [];
      for (const x of list) out.push({
        id: String(x.Id), title: x.Title, posted: day(x.PostedDate), url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${x.Id}`,
        location: [x.PrimaryLocation, ...(x.secondaryLocations || []).map((l) => l.Name), x.WorkplaceType].filter(Boolean).join('; '),
      });
      if (list.length < 25) break;
    }
    return out;
  },
  // SAP SuccessFactors career sites (Career Site Builder). Board: the site's host, optionally followed by "?" and extra
  // search parameters, for example "careers.ey.com?locationsearch=United%20States". Newest first, capped.
  async successfactors(b, term) {
    const [host, extra = ''] = b.split('?');
    const out = [];
    for (let start = 0; start < 200; start += 25) {
      const html = await (await get(`https://${host}/search/?q=${encodeURIComponent(term)}&locale=en_US&sortColumn=referencedate&sortDirection=desc&startrow=${start}${extra ? `&${extra}` : ''}`)).text();
      const rows = html.match(/<tr class="data-row[\s\S]*?<\/tr>/g) ?? [];
      if (!start) expect(+(html.match(/of <b>([\d,]+)<\/b>/)?.[1] ?? '').replace(/,/g, '') || NaN, 200, out);
      for (const r of rows) {
        const a = r.match(/<a[^>]*href="([^"]+)"[^>]*class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>|<a[^>]*class="jobTitle-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!a) continue;
        const href = a[1] ?? a[3], id = href.match(/\/(\d+)\/?$/)?.[1] ?? href;
        out.push({ id, title: text(a[2] ?? a[4]), location: text(r.match(/class="jobLocation"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''),
          posted: (() => { const d = text(r.match(/class="jobDate"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''); return d && !isNaN(Date.parse(d)) ? day(d) : ''; })(),
          url: `https://${host}${href}` });
      }
      if (rows.length < 25) break;
    }
    return out;
  },
  // iCIMS career portals. Board: the portal's host, for example "careers-peraton.icims.com". Up to 10 pages of 50.
  async icims(b, term) {
    const out = [];
    for (let page = 0; page < 10; page++) {
      const html = await (await get(`https://${b}/jobs/search?ss=1&searchKeyword=${encodeURIComponent(term)}&in_iframe=1&pr=${page}`)).text();
      const cards = html.match(/<li class="iCIMS_JobCardItem[\s\S]*?<\/li>/g) ?? [];
      for (const c of cards) {
        const a = c.match(/<a href="(https:\/\/[^"]+\/jobs\/(\d+)\/[^"]+)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/);
        if (!a) continue;
        // The remote note counts as a place only when it allows remote work ("No remote/telework allowed" doesn't).
        const remote = text(c.match(/Telecommute Options<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/)?.[1] ?? '');
        const when = c.match(/title="(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        out.push({ id: a[2], title: text(a[3]), url: a[1].replace(/&amp;/g, '&'),
          location: [text(c.match(/<div class="col-xs-6 header left">[\s\S]*?<span\s*>([\s\S]*?)<\/span>/)?.[1] ?? ''), /^no\b/i.test(remote) ? '' : remote].filter(Boolean).join('; '),
          posted: when ? `${when[3]}-${when[1].padStart(2, '0')}-${when[2].padStart(2, '0')}` : '' });
      }
      const pages = +(html.match(/Page \d+ of (\d+)/)?.[1] ?? 1);
      if (page + 1 >= pages || !cards.length) break;
    }
    return out;
  },
  // Any other careers site (the fallback). Board: a URL without "https://", either the site's job sitemap
  // ("careers.example.com/sitemap.xml") or a careers page that lists its jobs in plain HTML. Respects robots.txt.
  // Titles that pass the screen get their job page read for the place, since lists rarely show it.
  async page(b) {
    const url = `https://${b}`;
    if (!(await robotsAllow(url))) throw new Error(`robots.txt asks crawlers to stay off ${url}`);
    const body = await (await get(url)).text();
    let out = [];
    if (/<(urlset|sitemapindex)[\s>]/.test(body)) {
      // A sitemap index points at other sitemaps: follow the ones that look like job lists.
      const maps = /<sitemapindex/.test(body) ? [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /job|career|position|opening/i.test(u)).slice(0, 5) : [url];
      for (const m of maps) {
        const xml = m === url ? body : await (await get(m)).text();
        for (const e of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
          const loc = decode(e[1].match(/<loc>([^<]+)<\/loc>/)?.[1] ?? '');
          if (!JOBLINK.test(loc)) continue;
          out.push({ id: new URL(loc).pathname, url: loc, location: '', posted: (e[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? '').slice(0, 10), title: slugTitle(loc) });
        }
      }
    } else {
      const ld = ldPostings(body);
      if (ld.length) out = ld.map((x) => ({ id: new URL(x.url || url, url).pathname, url: new URL(x.url || url, url).href, title: x.title, location: ldPlace(x), posted: String(x.datePosted ?? '').slice(0, 10) }));
      else for (const m of body.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        const href = new URL(decode(m[1]), url).href, title = text(m[2]).replace(/\s+/g, ' ');
        if (JOBLINK.test(href) && title.length >= 4 && title.length <= 150) out.push({ id: new URL(href).pathname, url: href, title, location: '', posted: '' });
      }
    }
    out = [...new Map(out.map((o) => [o.id, o])).values()];
    for (const o of out.filter((x) => titleOk(x.title) && !x.location).slice(0, 40)) {
      try { const x = ldPostings(await (await get(o.url)).text())[0]; if (x) Object.assign(o, { title: x.title || o.title, location: ldPlace(x), posted: String(x.datePosted ?? o.posted).slice(0, 10) }); } catch {}
    }
    return out;
  },
};

// ---- Helpers for the fallback reader ----
const JOBLINK = /\/(jobs?|careers?\/job|positions?|openings?|postings?|requisitions?|job-details?|vacanc(y|ies))\/[^/?#]+|[?&](gh_jid|jobid|job_id|jid)=/i;
const slugTitle = (u) => decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).filter((p) => !/^\d+$/.test(p)).at(-1) ?? '')
  .replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Every schema.org JobPosting on a page, from its JSON-LD blocks (including lists and @graph).
function ldPostings(html) {
  const out = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') {
    if ([].concat(x['@type']).includes('JobPosting')) out.push(x);
    for (const k of ['@graph', 'itemListElement', 'item']) if (x[k]) walk(x[k]); } };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) { try { walk(JSON.parse(m[1])); } catch {} }
  return out;
}
const ldPlace = (x) => [...[].concat(x.jobLocation ?? []).map((l) => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry?.name ?? l.address?.addressCountry].filter(Boolean).join(', ')),
  x.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''].filter(Boolean).join('; ');
// Honors the robots.txt rules for all crawlers ("User-agent: *") on the fallback reader's pages.
async function robotsAllow(url) {
  const u = new URL(url);
  let txt = '';
  try { const r = await fetch(`${u.origin}/robots.txt`, { headers: UA }); if (!r.ok) return true; txt = await r.text(); } catch { return true; }
  let applies = false, rules = [], inAgents = false;
  for (const line of txt.split('\n').map((l) => l.replace(/#.*/, '').trim())) {
    const [k, ...v] = line.split(':'), val = v.join(':').trim();
    if (/^user-agent$/i.test(k)) { if (!inAgents) applies = false; inAgents = true; if (val === '*' || /roleforward/i.test(val)) applies = true; continue; }
    inAgents = false;
    if (applies && /^disallow$/i.test(k) && val) rules.push(val);
  }
  return !rules.some((r) => u.pathname.startsWith(r));
}

// Runs a feed for every search term and merges the results. Feeds that list everything (no search) run once.
const LISTS = new Set(['greenhouse', 'ashby', 'lever', 'page']);
async function fetchFeed(source, board) {
  if (LISTS.has(source)) return FEEDS[source](board);
  if (!TERMS.length) throw new Error('workspace.yaml scout.search_terms is empty');
  const seenIds = new Set(), out = [];
  for (const term of TERMS) {
    const jobs = await FEEDS[source](board, term);
    out.expected = Math.max(out.expected ?? 0, jobs.expected ?? 0) || undefined;
    if (jobs.partial) out.partial = `"${term}": ${jobs.partial}`;
    for (const j of jobs) if (!seenIds.has(j.id)) { seenIds.add(j.id); out.push(j); }
  }
  return out;
}

// ---- Detail: plain-text description plus whatever the feed knows about pay and dates ----
const parseKey = (key) => { const [source, ...rest] = key.split(':'); const id = rest.pop(); return { source, board: rest.join(':'), id }; };
async function detail(key, row) {
  const { source, board, id } = parseKey(key);
  const s = row ?? readCsv(SEEN).find((r) => r.key === key) ?? {};
  if (source === 'greenhouse') {
    const x = await json(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?pay_transparency=true`);
    const pay = (x.pay_input_ranges || []).map((p) => `${p.title ? p.title + ': ' : ''}$${(p.min_cents / 100).toLocaleString()} - $${(p.max_cents / 100).toLocaleString()} ${p.currency_type}`).join('; ');
    return { title: x.title, location: x.location?.name, pay, published: day(x.first_published || x.updated_at), url: x.absolute_url, body: text(x.content), via: 'Greenhouse public job board API' };
  }
  if (source === 'ashby') {
    const j = await json(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`);
    const x = j.jobs.find((y) => y.id === id) ?? (() => { throw new Error(`not found: ${key}`); })();
    return { title: x.title, location: x.location, team: x.team || x.department, pay: x.compensation?.compensationTierSummary ?? '', published: day(x.publishedAt), url: x.jobUrl, body: x.descriptionPlain, via: 'Ashby public posting API' };
  }
  if (source === 'lever') {
    const x = await json(`https://api.lever.co/v0/postings/${board}/${id}`);
    const lists = (x.lists || []).map((l) => `${l.text}\n${text(l.content)}`).join('\n\n');
    const pay = x.salaryRange ? `$${x.salaryRange.min.toLocaleString()} - $${x.salaryRange.max.toLocaleString()} ${x.salaryRange.currency}` : '';
    return { title: x.text, location: x.categories?.location, team: x.categories?.team, pay, published: day(x.createdAt), url: x.hostedUrl, body: [x.descriptionPlain, lists, x.additionalPlain].filter(Boolean).join('\n\n'), via: 'Lever public postings API' };
  }
  if (source === 'workday') {
    const [t, w, site] = board.split('/');
    const x = (await json(`https://${t}.${w}.myworkdayjobs.com/wday/cxs/${t}/${site}${id}`)).jobPostingInfo;
    return { title: x.title, location: [x.location, ...(x.additionalLocations || [])].join('; '), pay: '', published: x.startDate || '', url: x.externalUrl, body: text(x.jobDescription), via: 'Workday public careers site API' };
  }
  if (source === 'talentbrew') {
    const html = await (await get(s.url)).text();
    const x = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const loc = (x.jobLocation || []).map((l) => [l.address?.addressLocality, l.address?.addressRegion].filter(Boolean).join(', ')).join('; ');
    const published = String(x.datePosted || '').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return { title: x.title, location: loc, pay: '', published, url: x.url, body: text(x.description), via: `${parseKey(key).board.split('/')[0]} page, JobPosting structured data` };
  }
  if (source === 'eightfold') {
    const [host, domain, api] = board.split('/');
    const x = api === 'pcsx'
      ? (await json(`https://${host}/api/pcsx/position_details?position_id=${id}&domain=${domain}&hl=en`)).data
      : await json(`https://${host}/api/apply/v2/jobs/${id}?domain=${domain}`);
    return { title: x.name, location: (x.locations || []).join('; '), team: x.department, pay: '', published: day((x.postedTs ?? x.t_create) * 1000), url: s.url, body: text(x.jobDescription ?? x.job_description), via: `${host} careers API (Eightfold)` };
  }
  if (source === 'smartrecruiters') {
    const x = await json(`https://api.smartrecruiters.com/v1/companies/${board}/postings/${id}`);
    const sec = x.jobAd?.sections || {};
    return { title: x.name, location: s.location, team: x.department?.label, pay: '', published: day(x.releasedDate), url: x.postingUrl || s.url,
      body: ['jobDescription', 'qualifications', 'additionalInformation'].map((k) => sec[k] && `${sec[k].title}\n${text(sec[k].text)}`).filter(Boolean).join('\n\n'), via: 'SmartRecruiters public postings API' };
  }
  if (source === 'apple') {
    // Apple renders job pages with JavaScript. The text lives in the page's router data, not the HTML.
    const html = await (await get(s.url)).text();
    const m = html.match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("([\s\S]*?)"\);/);
    const x = m ? JSON.parse(JSON.parse(`"${m[1]}"`)).loaderData?.jobDetails?.jobsData ?? {} : {};
    const parts = [['Summary', x.jobSummary], ['Description', x.description], ['Responsibilities', x.responsibilities],
      ['Minimum Qualifications', x.minimumQualifications], ['Preferred Qualifications', x.preferredQualifications],
      ['Pay and Benefits', x.postingFooters?.[0]?.localizations?.en_US?.[0]?.content]];
    return { title: x.postingTitle ?? s.title, location: s.location, team: x.teamNames?.join?.(', '), pay: '', published: day(x.postDateInGMT || x.postingDate) || s.posted, url: s.url,
      body: parts.filter(([, v]) => v).map(([h, v]) => `${h}\n${text(v)}`).join('\n\n'), via: 'jobs.apple.com page data' };
  }
  if (source === 'oracle') {
    const [host, site] = board.split('/');
    const x = (await json(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${id}%22,siteNumber=${site}`)).items?.[0] ?? {};
    const body = [x.ExternalDescriptionStr, x.ExternalResponsibilitiesStr, x.ExternalQualificationsStr, x.CorporateDescriptionStr].filter(Boolean).map(text).join('\n\n');
    return { title: x.Title, location: [x.PrimaryLocation, x.WorkplaceType].filter(Boolean).join('; '), team: x.Organization || x.JobFunction, pay: '',
      published: day(x.ExternalPostedStartDate), url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`, body, via: 'Oracle Recruiting Cloud public careers API' };
  }
  if (source === 'successfactors') {
    const html = await (await get(s.url)).text();
    const meta = (p) => decode(html.match(new RegExp(`itemprop="${p}"[^>]*content="([^"]*)"`))?.[1] ?? '');
    const desc = html.match(/<span class="jobdescription">([\s\S]*?)<\/span>\s*<\/div>/)?.[1] ?? html.match(/itemprop="description"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '';
    const when = meta('datePosted');
    return { title: text(html.match(/itemprop="title"[^>]*>([\s\S]*?)</)?.[1] ?? '') || s.title, location: meta('streetAddress') || s.location, pay: '',
      published: when && !isNaN(Date.parse(when)) ? day(when) : s.posted, url: s.url, body: text(desc), via: `${board.split('?')[0]} (SAP SuccessFactors career site)` };
  }
  if (['amazon', 'google', 'icims', 'page'].includes(source)) return pageDetail(s, source);
  throw new Error(`unknown source: ${source}`);
}

// Career pages without a detail API: use the page's JobPosting structured data if it has one, else its visible text.
async function pageDetail(s, source) {
  const html = await (await get(s.url)).text();
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .flat().find((x) => x?.['@type'] === 'JobPosting');
  const body = ld ? text(ld.description) : text(html.replace(/<(script|style|noscript|svg|header|footer|nav)[\s\S]*?<\/\1>/gi, '')).slice(0, 20000);
  const pay = ld?.baseSalary?.value ? `$${ld.baseSalary.value.minValue?.toLocaleString?.() ?? ''} - $${ld.baseSalary.value.maxValue?.toLocaleString?.() ?? ''}` : '';
  return { title: ld?.title ?? s.title, location: s.location, pay, published: ld?.datePosted?.slice(0, 10) || s.posted, url: s.url, body, via: `${source} careers page` };
}

// ---- Whether postings awaiting a decision are still open ----
// Each shortlisted or interested posting is checked on its own, one request each: the source's job-detail endpoint when
// the scout found it (scout_key), else the posting link in posting.md. A search listing never decides it, since search
// feeds stop at their newest few hundred postings. Each site's "gone" signal was read from the live site:
//   404 or 410                                   most sources, for a job that no longer exists
//   Oracle: no items     SuccessFactors: a redirect to /errorpage/
//   Google: the search page instead of the job   Apple: page data that says jobDetails 404
//   Ashby: missing from its board, which always lists every posting
// Anything else (an error, maintenance, a page with no clear signal) is "can't tell": the posting is left alone, and
// after CHECK_AFTER runs in a row it's flagged [check] for the user to open by hand. Wording such as "no longer available"
// is never trusted: open pages carry it too (in hidden templates).
const CLOSURE = join(apps, 'data', 'closure-checks.csv');
const CLOSURE_COLS = ['folder', 'unknown_runs', 'last_checked', 'last_reason'];
const CHECK_AFTER = 3;
function awaiting() {
  const out = [];
  for (const c of readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'data'))
    for (const p of readdirSync(join(apps, c.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const file = join(apps, c.name, p.name, 'posting.md');
      if (!existsSync(file)) continue;
      const { data } = readFrontmatter(file);
      const last = (data.events || []).map(parseEvent).at(-1);
      if (['shortlisted', 'interested'].includes(last?.stage)) out.push({ folder: `applications/${c.name}/${p.name}`, key: data.scout_key, url: data.posting, company: data.company, role: data.role });
    }
  return out;
}

// Where to ask about a posting: its source's detail endpoint, or its own page.
function checkTarget(s) {
  if (!s.key) return { kind: 'page', url: s.url };
  const { source, board, id } = parseKey(s.key);
  if (source === 'greenhouse') return { kind: 'api', url: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}` };
  if (source === 'lever') return { kind: 'api', url: `https://api.lever.co/v0/postings/${board}/${id}` };
  if (source === 'ashby') return { kind: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${board}`, id };
  if (source === 'smartrecruiters') return { kind: 'api', url: `https://api.smartrecruiters.com/v1/companies/${board}/postings/${id}` };
  if (source === 'workday') { const [t, w, site] = board.split('/'); return { kind: 'api', url: `https://${t}.${w}.myworkdayjobs.com/wday/cxs/${t}/${site}${id}` }; }
  if (source === 'eightfold') {
    const [host, domain, api] = board.split('/');
    return { kind: 'api', url: api === 'pcsx' ? `https://${host}/api/pcsx/position_details?position_id=${id}&domain=${domain}&hl=en` : `https://${host}/api/apply/v2/jobs/${id}?domain=${domain}` };
  }
  if (source === 'oracle') { const [host, site] = board.split('/'); return { kind: 'oracle', url: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${id}%22,siteNumber=${site}` }; }
  return { kind: source, url: s.url };
}

// 'open', 'closed', or 'unknown', with a short reason.
async function postingState(s) {
  const t = checkTarget(s);
  if (!t.url) return ['unknown', 'no posting link in posting.md'];
  let r, body;
  try { r = await fetch(t.url, { headers: UA, redirect: 'follow' }); body = await r.text(); } catch (e) { return ['unknown', e.message]; }
  if (isDown(r)) return ['unknown', 'the site is under maintenance'];
  if ([404, 410].includes(r.status)) return ['closed', `the site answers ${r.status} for it`];
  if (!r.ok) return ['unknown', `the site answered ${r.status}`];
  if (t.kind === 'ashby') return (JSON.parse(body).jobs ?? []).some((x) => x.id === t.id) ? ['open', ''] : ['closed', 'no longer on its Ashby board'];
  if (t.kind === 'oracle') return (JSON.parse(body).items ?? []).length ? ['open', ''] : ['closed', 'Oracle returns no requisition for it'];
  if (/\/errorpage\b/i.test(r.url)) return ['closed', 'the posting link now redirects to an error page'];
  if (t.kind === 'google') return /<title[^>]*>\s*Jobs search/i.test(body) ? ['closed', 'the link now shows the job search page'] : ['open', ''];
  if (t.kind === 'apple') {
    const m = body.match(/window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("([\s\S]*?)"\);/);
    const d = m ? JSON.parse(JSON.parse(`"${m[1]}"`)) : null;
    if (d?.errors?.jobDetails?.status === 404) return ['closed', 'Apple reports the job as not found'];
    return d?.loaderData?.jobDetails ? ['open', ''] : ['unknown', 'the page has no job data'];
  }
  if (t.kind === 'api') return ['open', ''];
  // A posting page: open when it carries the job's structured data or names the role, otherwise unclear.
  if (ldPostings(body).length || (s.role && body.includes(s.role))) return ['open', ''];
  return ['unknown', "the page loads but doesn't show the job"];
}

// Checks every posting awaiting a decision and keeps the run of "can't tell" results per posting.
async function closureChecks(record = true) {
  const streak = new Map(readCsv(CLOSURE).map((r) => [r.folder, r]));
  const closed = [], check = [], states = [];
  for (const s of awaiting()) {
    const [state, why] = await postingState(s);
    states.push({ ...s, state, why });
    if (state === 'closed') {
      closed.push({ folder: s.folder, why }); streak.delete(s.folder);
      // Expire it in place: the ending event, and the job description copy goes (posting.md stays for the stats).
      if (record) { appendEvent(join(root, s.folder, 'posting.md'), `${today} | expired | posting closed`, today); rmSync(join(root, s.folder, 'jd.md'), { force: true }); }
      continue;
    }
    if (state === 'open') { streak.delete(s.folder); continue; }
    const runs = (+streak.get(s.folder)?.unknown_runs || 0) + 1;
    streak.set(s.folder, { folder: s.folder, unknown_runs: runs, last_checked: today, last_reason: why });
    if (runs >= CHECK_AFTER) check.push({ folder: s.folder, why, runs });
  }
  if (record) { mkdirSync(dirname(CLOSURE), { recursive: true }); writeCsv(CLOSURE, CLOSURE_COLS, [...streak.values()].filter((r) => awaiting().some((s) => s.folder === r.folder))); }
  return { closed, check, states };
}

// ---- Commands ----
const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  const seen = new Map(readCsv(SEEN).map((r) => [r.key, r]));
  const errors = [], fresh = [], counts = {}, warnings = [], down = {};
  const health = new Map(readCsv(HEALTH).map((r) => [r.company, r]));
  let fetched = 0, matched = 0, placeDrops = 0, freshDrops = 0;
  await Promise.all(watchlist().map(async (w) => {
    try {
      const jobs = await fetchFeed(w.source, w.board);
      fetched += jobs.length;
      counts[w.company] = jobs.length;
      // Completeness: fewer postings than the site itself reports usually means broken paging or parsing.
      const unique = new Set(jobs.map((j) => j.id)).size;
      if (jobs.partial) warnings.push(`[partial] ${w.company}: the site refused more pages (${jobs.partial}). Kept those, newest first; the oldest weren't checked.`);
      else if (jobs.expected >= 10 && unique < 0.9 * jobs.expected)
        warnings.push(`[short] ${w.company}: got ${unique} postings, but the site reports ${jobs.expected}. Paging or parsing may be broken.`);
      if (unique < jobs.length) warnings.push(`[repeat] ${w.company}: ${jobs.length - unique} duplicate postings. Pages may be repeating.`);
      // Sudden drop against this company's recent history.
      const prev = (health.get(w.company)?.recent ?? '').split(' ').filter(Boolean).map(Number);
      const med = prev.length ? [...prev].sort((a, b) => a - b)[prev.length >> 1] : 0;
      if (prev.length >= 2 && med >= 10 && unique < 0.4 * med)
        warnings.push(`[drop] ${w.company}: ${unique} postings vs. a usual ${med}. The site may have changed.`);
      health.set(w.company, { company: w.company, source: w.source, board: w.board, last_run: today, last_count: unique, expected: jobs.expected ?? '', recent: [...prev, unique].slice(-6).join(' ') });
      for (const j of jobs) {
        const key = `${w.source}:${w.board}:${j.id}`;
        if (!titleOk(j.title)) continue;
        // A matching title that's remote, but only in another country, is dropped and kept as one seen.csv line, so the
        // user can check the country call. An office somewhere else is only counted.
        const verdict = placeVerdict(j.location);
        if (verdict === 'elsewhere') { placeDrops++; continue; }
        if (verdict === 'fits') matched++; else placeDrops++;
        const prev = seen.get(key);
        if (prev) { prev.last_seen = today; continue; }
        const fits = verdict === 'fits';
        const row = { key, company: w.company, title: j.title, location: j.location, posted: j.posted, url: j.url, first_seen: today, last_seen: today,
          decision: fits ? 'new' : 'dropped', reason: fits ? '' : `Wrong place: ${j.location}` };
        seen.set(key, row);
        if (fits) fresh.push(row); else freshDrops++;
      }
    } catch (e) {
      if (e.down) (down[w.source] ??= []).push(w.company);
      else errors.push(`${w.company} (${w.source} ${w.board}): ${e.message}`);
    }
  }));
  mkdirSync(dirname(SEEN), { recursive: true });
  writeCsv(SEEN, SEEN_COLS, [...seen.values()].sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title)));
  // Held postings come back for reconsideration while they're still listed.
  const held = [...seen.values()].filter((r) => r.decision === 'held' && r.last_seen === today);
  const pending = [...seen.values()].filter((r) => r.decision === 'new');
  const { closed, check } = await closureChecks();
  writeCsv(HEALTH, HEALTH_COLS, [...health.values()].sort((a, b) => a.company.localeCompare(b.company)));
  const validated = existsSync(VALIDATED) ? JSON.parse(readFileSync(VALIDATED, 'utf8')) : {};
  const lastValidated = validated.date ?? '';
  // A source that was under maintenance at the last validation still needs checking.
  const wasDown = Object.values(validated.results ?? {}).some((v) => v.startsWith('down'));
  const validationDue = !lastValidated || (Date.parse(today) - Date.parse(lastValidated)) / 864e5 > 30 || warnings.some((w) => !w.startsWith('[partial]')) || errors.length > 0 || wasDown;
  const empty = Object.keys(counts).filter((c) => !counts[c]);
  const out = { run: today, fetched, matched, new: fresh.length, place_drops: freshDrops, to_screen: pending, held, closed, check, errors, down, warnings, empty, counts, last_validated: lastValidated, validation_due: validationDue };
  mkdirSync(join(root, 'output', 'scout'), { recursive: true });
  writeFileSync(join(root, 'output', 'scout', 'latest.json'), JSON.stringify(out, null, 2));
  if (visaOn() && deadlineLine()) console.log(deadlineLine());
  console.log(`Scout ${today}: ${fetched} postings fetched from ${watchlist().length} companies, ${matched} matched the title and location screen, ${fresh.length} new.`
    + (placeDrops ? ` ${placeDrops} more had a matching title in the wrong place${freshDrops ? ` (${freshDrops} new remote roles in another country, recorded as dropped: Wrong place)` : ''}.` : ''));
  console.log(`To screen: ${pending.length} new, ${held.length} held from earlier runs. Closed shortlisted postings: ${closed.length}.`);
  for (const r of [...pending, ...held]) console.log(`  [${r.decision}] ${r.key} | ${r.company} | ${r.title} | ${r.location} | posted ${r.posted || '?'}`);
  for (const c of closed) console.log(`  [closed] ${c.folder}: ${c.why}. Marked expired.`);
  for (const c of check) console.log(`  [check] ${c.folder}: couldn't tell whether it's still open for ${c.runs} runs in a row (${c.why}). Open the posting by hand.`);
  for (const w of warnings) console.log(`  ${w}`);
  for (const e of errors) console.log(`  [error] ${e}`);
  for (const [source, cs] of Object.entries(down))
    console.log(`  [down] ${source}: ${cs.length} ${cs.length === 1 ? 'employer' : 'employers'} under maintenance, so not checked this run (${[...cs].sort().join(', ')}). Re-run once the site is back. The feeds aren't broken.`);
  // A board that returns nothing usually means a changed board name or page layout, not zero openings.
  for (const c of empty) console.log(`  [empty] ${c}: the feed returned no postings. Check its board in the watchlist.`);
  console.log(`Feed validation: last run ${lastValidated || 'never'}.${validationDue ? ' Due now: run `scout.mjs validate` from the plugin tools folder.' : ''}`);
  console.log('Details: output/scout/latest.json');
} else if (cmd === 'show') {
  const d = await detail(args[0]);
  const check = payCheck(d);
  // With the visa module on: what the posting says about sponsorship, and the employer's H-1B record.
  let visa = '';
  if (visaOn()) {
    const v = sponsorshipText(d.body), company = readCsv(SEEN).find((r) => r.key === args[0])?.company ?? '';
    visa = `\nSponsorship check: ${v.says === 'no' ? `says no sponsorship ("${v.quote}")` : v.says === 'citizens' ? `requires citizenship or a clearance ("${v.quote}")` : v.says === 'yes' ? `says sponsorship is available ("${v.quote}")` : 'not mentioned'}`
      + (company ? `\nSponsor history: ${historyLine(company)}` : '');
  }
  const described = !d.pay && parsePay(d.body);
  console.log(`${d.title}\n${d.location}\nPay: ${d.pay || (described ? `${payText(described)} (from the description)` : 'not published')}${check ? `\nPay check: ${check}` : ''}${visa}\nPublished: ${d.published || '?'}\n${d.url}\n\n${d.body}`);
} else if (cmd === 'capture') {
  const [key, folder] = args;
  const d = await detail(key);
  const s = readCsv(SEEN).find((r) => r.key === key) ?? {};
  const q = (v) => JSON.stringify(String(v ?? ''));
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, 'jd.md'), `---
title: ${q(`Job Description: ${d.title}`)}
company: ${q(s.company)}
location: ${q(d.location)}
team: ${q(d.team ?? '')}
compensation: ${q(d.pay || (parsePay(d.body) ? `${payText(parsePay(d.body))} (from the description)` : 'Not published'))}
published: ${d.published || s.posted || ''}
url: ${d.url}
captured: ${today}
captured_via: ${q(d.via)}
---
<!-- Plain text of the posting as published, captured for reference. Do not edit. -->

${d.body.replace(/\$/g, '\\$')}
`);
  console.log(`Wrote ${folder}/jd.md (${d.body.split(/\s+/).length} words). Pay: ${d.pay || (parsePay(d.body) ? `${payText(parsePay(d.body))} (from the description)` : 'not published')}`);
} else if (cmd === 'mark') {
  const [key, decision, reason = ''] = args;
  if (!['dropped', 'held', 'shortlisted'].includes(decision)) throw new Error('decision must be dropped, held, or shortlisted');
  const rows = readCsv(SEEN);
  const r = rows.find((x) => x.key === key) ?? (() => { throw new Error(`not in seen.csv: ${key}`); })();
  Object.assign(r, { decision, reason });
  writeCsv(SEEN, SEEN_COLS, rows);
  console.log(`${r.company}, ${r.title}: ${decision}${reason ? ` (${reason})` : ''}`);
} else if (cmd === 'validate') {
  // One real posting per source type, opened end to end: the feed lists it, and its detail has a title and a full description.
  const bySource = new Map();
  for (const w of watchlist()) if (!bySource.has(w.source)) bySource.set(w.source, []), bySource.get(w.source).push(w); else bySource.get(w.source).push(w);
  const results = {};
  for (const [source, ws] of bySource) {
    let verdict = 'fail: no company in this source returned postings';
    for (const w of ws.slice(0, 3)) {
      try {
        const jobs = await fetchFeed(source, w.board);
        if (!jobs.length) { verdict = `fail: ${w.company} feed returned nothing`; continue; }
        const j = jobs[0];
        const d = await detail(`${source}:${w.board}:${j.id}`, { ...j, company: w.company });
        const words = String(d.body ?? '').split(/\s+/).filter(Boolean).length;
        verdict = d.title && words >= 150 ? `ok: ${w.company}, "${d.title}" (${jobs.length} listed, ${words}-word description)` : `fail: ${w.company}, title "${d.title ?? ''}", ${words}-word description`;
        if (verdict.startsWith('ok')) break;
      } catch (e) { verdict = `${e.down ? 'down' : 'fail'}: ${w.company}: ${e.message}`; if (e.down) break; }
    }
    results[source] = verdict;
    console.log(`${verdict.split(':')[0].toUpperCase().padEnd(4)} ${source.padEnd(16)} ${verdict.replace(/^(ok|fail|down): /, '')}`);
  }
  writeFileSync(VALIDATED, JSON.stringify({ date: today, results }, null, 2) + '\n');
  const nDown = Object.values(results).filter((v) => v.startsWith('down')).length;
  console.log(`Saved to applications/data/feed-validation.json. ${Object.values(results).filter((v) => v.startsWith('fail')).length} source type(s) failed.`
    + (nDown ? ` ${nDown} under maintenance: run validate again once ${nDown === 1 ? 'it is' : 'they are'} back.` : ''));
} else if (cmd === 'closed') {
  for (const s of (await closureChecks(false)).states) console.log(`${s.state.padEnd(7)} ${s.folder}${s.why ? ` (${s.why})` : ''}`);
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
