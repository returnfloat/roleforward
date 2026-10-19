// Synthetic job-feed responses for the feed tests, one employer per source type. Each follows the structure the live
// site returned on 2026-10-17 (field names, nesting, value formats, paging), with every value a placeholder. Nothing
// here was copied from a real posting. When `scout.mjs validate` shows a site changed, fix the parser and update that
// source here from the new live structure in the same change.
//
// respond(url, init, scenarios) returns { status, json | text, redirect } for a URL, or undefined (served as a 404).
// Scenarios switch on the edge cases the scout must handle:
//   workday-down          every Workday request redirects to a maintenance page
//   eightfold-429         the first Eightfold search request gets a 429, then works
//   eightfold-429-always  every Eightfold search request gets a 429
//   eightfold-retry-after the first Eightfold search request gets a 429 asking for a 7-second wait
//   eightfold-429-later   every Eightfold search page after the first gets a 429
//   greenhouse-detail-503 Greenhouse's job-detail endpoint answers 503 (a posting whose state can't be told)
//
// A job that doesn't exist gets each site's own "gone" answer, as the live sites gave it on 2026-10-18: a 404 from most
// (the default below), no items from Oracle, a redirect to /errorpage/ from SuccessFactors, the search page from Google,
// and page data saying jobDetails 404 from Apple.
//   greenhouse-short      Greenhouse reports 30 postings but lists 3
//   greenhouse-closed     the shortlisted Greenhouse posting is gone
//   greenhouse-renumbered the shortlisted Greenhouse posting is gone, but a new one has the same title
//   lever-repeat          Lever lists one posting twice
//   ashby-empty           Ashby lists nothing
//   apple-stub            Apple's job page holds only a short summary (the 2026-10-05 bug)
//   page-robots-block     the fallback site's robots.txt disallows everything

const at = (n) => new Date(Date.now() - n * 864e5);
const iso = (n) => at(n).toISOString();
const ymd = (n) => iso(n).slice(0, 10);
const secs = (n) => Math.floor(at(n).getTime() / 1000);
const words = (n = 160) => Array.from({ length: n }, (_, i) => ['Placeholder', 'description', 'text', 'for', 'tests.'][i % 5]).join(' ');
const para = (n) => `<p>${words(n)}</p>`;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ldPosting = (x) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', ...x })}</script>`;
const page = (body) => `<!doctype html><html><head><title>Example</title><script>var x = 1;</script></head><body><nav>Example nav</nav>${body}<footer>Example footer</footer></body></html>`;

// discover.mjs reads the Hacker News "Who is hiring?" thread and careers pages; those are near the end.
//
// The watchlist the feed tests use: the fixture's Employers A to E, plus one employer for each other source type.
export const WATCHLIST = [
  ['Employer A', 'greenhouse', 'test-employer-a'],
  ['Employer B', 'ashby', 'test-employer-b'],
  ['Employer C', 'lever', 'test-employer-c'],
  ['Employer D', 'workday', 'test-employer-d/wd1/Careers'],
  ['Employer E', 'manual', ''],
  ['Employer G', 'eightfold', 'careers.example.invalid/example.invalid/pcsx'],
  ['Employer H', 'eightfold', 'jobs.example.invalid/example.invalid/v2'],
  ['Employer I', 'smartrecruiters', 'TestEmployerI'],
  ['Employer J', 'amazon', '-'],
  ['Employer K', 'google', '-'],
  ['Employer L', 'apple', '-'],
  ['Employer M', 'talentbrew', 'talentbrew.example.invalid/1001'],
  ['Employer N', 'oracle', 'oracle.example.invalid/CX_1'],
  ['Employer O', 'successfactors', 'sf.example.invalid?locationsearch=United%20States'],
  ['Employer P', 'icims', 'icims.example.invalid'],
  ['Employer Q', 'page', 'page.example.invalid/sitemap.xml'],
];

// ---- Greenhouse: one list call, numeric ids, HTML content escaped twice in the detail ----
const greenhouse = (on) => {
  const job = (id, title, place) => ({ absolute_url: `https://example.invalid/employer-a/jobs/${id}`, id, title, location: { name: place },
    updated_at: iso(4), first_published: iso(5), requisition_id: `R-${id}`, metadata: [], company_name: 'Employer A', language: 'en' });
  const jobs = [job(1001, 'Senior Data Engineer', 'Remote, US'), job(1002, 'Example Recruiter', 'Example City, ST'), job(1003, 'Staff Data Engineer', 'London')];
  if (on.has('greenhouse-closed')) jobs.shift();
  if (on.has('greenhouse-renumbered')) jobs[0] = job(1099, 'Senior Data Engineer', 'Remote, US');
  return jobs;
};

// ---- Ashby: one list call with descriptions and compensation inline; unlisted postings are skipped ----
const ashby = (on) => on.has('ashby-empty') ? [] : [
  { id: 'test-ashby-1', title: 'Senior Data Engineer', team: 'Example Team', location: 'Example City, ST', secondaryLocations: [{ location: 'Remote, US' }],
    publishedAt: iso(3), isListed: true, isRemote: true, workplaceType: 'Hybrid', jobUrl: 'https://example.invalid/employer-b/test-ashby-1',
    descriptionPlain: words(), compensation: { compensationTierSummary: '$150K – $190K' } },
  { id: 'test-ashby-2', title: 'Senior Data Engineer, Unlisted', location: 'Remote, US', publishedAt: iso(3), isListed: false, jobUrl: 'https://example.invalid/employer-b/test-ashby-2', descriptionPlain: words() },
  { id: 'test-002', title: 'Staff Data Engineer', location: 'Example City, ST', publishedAt: iso(9), isListed: true, isRemote: false, workplaceType: 'Hybrid',
    jobUrl: 'https://example.invalid/employer-b/test-002', descriptionPlain: words(), compensation: {} },
];

// ---- Lever: one list call, millisecond timestamps, locations in categories ----
const lever = (on) => {
  const jobs = [
    { id: 'test-lever-1', text: 'Lead Data Engineer', categories: { location: 'Example City, ST', allLocations: ['Example City, ST', 'Remote, US'], team: 'Example Team', commitment: 'Full Time' },
      workplaceType: 'hybrid', createdAt: at(2).getTime(), hostedUrl: 'https://example.invalid/employer-c/test-lever-1' },
    { id: 'test-lever-2', text: 'Example Recruiter', categories: { location: 'Example City, ST', allLocations: ['Example City, ST'] }, workplaceType: 'onsite', createdAt: at(2).getTime(), hostedUrl: 'https://example.invalid/employer-c/test-lever-2' },
  ];
  return on.has('lever-repeat') ? [...jobs, jobs[0]] : jobs;
};

// ---- Workday: POST search, 20 per page, the total on the first page only ----
// 45 postings over three pages, so a fetch that stops at 40 (the 2026-10-05 bug) misses posting 41. Posting 2 has no
// locationsText (the place is in bulletFields), and posting 41 has neither (the place is in its path).
const WORKDAY = Array.from({ length: 45 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { title: `Example Role ${n}`, externalPath: `/job/Example-City-ST/Example-Role-${n}_test-wd-${n}`, locationsText: 'Example City, ST', postedOn: 'Posted 3 Days Ago', bulletFields: [`test-wd-${n}`] };
});
WORKDAY[0] = { title: 'Senior Data Engineer', externalPath: '/job/Example-City-ST/Senior-Data-Engineer_test-wd-01', locationsText: 'Example City, ST', postedOn: 'Posted Today', bulletFields: ['test-wd-01'] };
WORKDAY[1] = { title: 'Staff Data Engineer', externalPath: '/job/Remote/Staff-Data-Engineer_test-wd-02', postedOn: 'Posted Yesterday', bulletFields: ['test-wd-02', 'Remote, US'] };
WORKDAY[40] = { title: 'Lead Data Engineer', externalPath: '/job/Example-City-ST/Lead-Data-Engineer_test-wd-41', postedOn: 'Posted 30+ Days Ago', bulletFields: ['test-wd-41'] };
// Still open, but older than anything the search returns: only its own detail endpoint knows it.
const WORKDAY_OLD = { title: 'Senior Data Engineer, Archive', externalPath: '/job/Example-City-ST/Senior-Data-Engineer-Archive_test-wd-99', locationsText: 'Example City, ST', postedOn: 'Posted 30+ Days Ago' };

// ---- Eightfold (pcsx): 10 per page whatever num asks for, seconds for timestamps ----
const EIGHTFOLD = Array.from({ length: 25 }, (_, i) => ({ id: 7001 + i, displayJobId: String(7001 + i), name: `Example Role ${i + 1}`, locations: ['Example City, ST, United States'],
  postedTs: secs(4), department: 'Example Team', workLocationOption: 'onsite', positionUrl: `/careers/job/${7001 + i}` }));
EIGHTFOLD[0] = { ...EIGHTFOLD[0], name: 'Senior Data Engineer' };
EIGHTFOLD[12] = { ...EIGHTFOLD[12], name: 'Staff Data Engineer', locations: ['London, United Kingdom'], workLocationOption: 'remote' };
let eightfoldCalls = 0;

// ---- Eightfold (v2) ----
const EIGHTFOLD_V2 = [
  { id: 8001, name: 'Senior Data Engineer', locations: ['Remote, United States'], t_create: secs(6), work_location_option: 'remote', canonicalPositionUrl: 'https://jobs.example.invalid/careers/job/8001' },
  { id: 8002, name: 'Example Recruiter', locations: ['Example City, ST'], t_create: secs(6), work_location_option: 'onsite', canonicalPositionUrl: 'https://jobs.example.invalid/careers/job/8002' },
];

// ---- SmartRecruiters: country codes in lower case, remote as a flag ----
const SMARTRECRUITERS = [
  { id: '9001', name: 'Senior Data Engineer', releasedDate: iso(2), location: { city: 'Example City', region: 'ST', country: 'us', remote: false, hybrid: false, fullLocation: 'Example City, ST, United States' } },
  { id: '9002', name: 'Staff Data Engineer', releasedDate: iso(2), location: { city: 'Other City', region: 'ST', country: 'us', remote: true, hybrid: false, fullLocation: 'Other City, ST, United States' } },
];

// ---- Amazon: dates written out ("October 16, 2026"); job pages have no structured data ----
const longDate = (n) => at(n).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const AMAZON = [
  { id_icims: 'test-amz-1', title: 'Senior Data Engineer', normalized_location: 'Example City, ST, USA', location: 'US, ST, Example City', posted_date: longDate(1), job_path: '/en/jobs/test-amz-1/senior-data-engineer' },
  { id_icims: 'test-amz-2', title: 'Example Recruiter', normalized_location: 'Example City, ST, USA', location: 'US, ST, Example City', posted_date: longDate(1), job_path: '/en/jobs/test-amz-2/example-recruiter' },
];

// ---- Google: rows embedded in the page as positional arrays ----
const googleRow = (id, title, place) => [id, title, 'https://example.invalid/apply', [null, 'Example summary'], [[place, ['Example address'], 'Example City', '00000', 'ST', 'US']], 'Employer K', null, 'en', 'en-US'];
const GOOGLE = [googleRow('test-goog-1', 'Senior Data Engineer', 'Example City, ST, USA'), googleRow('test-goog-2', 'Example Recruiter', 'Example City, ST, USA')];

// ---- Apple: router data embedded in the page as an escaped JSON string ----
const appleData = (loaderData, errors) => `window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify({ loaderData, ...(errors ? { errors } : {}) }))});`;
const APPLE = [{ id: 'test-apl-1', postingTitle: 'Senior Data Engineer', transformedPostingTitle: 'senior-data-engineer', locations: [{ name: 'Example City', city: 'Example City', countryName: 'United States' }],
  postDateInGMT: iso(1), postingDate: 'Example date' }];

// ---- TalentBrew: HTML results inside JSON, in two layouts; the page's job id differs from the number in the link ----
const TALENTBREW_PAGES = [
  `<section id="search-results" data-total-results="3" data-total-pages="2"><ul>
<li><a href="/job/example-city/senior-data-engineer/1001/5550001" data-job-id="tb-101"><h2>Senior Data Engineer</h2><span class="job-location">Example City, ST</span></a></li>
<li><h2><a href="/job/remote/staff-data-engineer/1001/5550002">Staff Data Engineer</a></h2><span class="job-location">Remote, US</span></li>
</ul></section>`,
  `<section id="search-results" data-total-results="3" data-total-pages="2"><ul>
<li><a href="/job/example-city/lead-data-engineer/1001/5550003" data-job-id="tb-103"><h2>Lead Data Engineer</h2><span class="job-location">Example City, ST</span></a></li>
<li><a href="/job/example-city/senior-data-engineer/1001/5550001" data-job-id="tb-101"><h2>Senior Data Engineer</h2><span class="job-location">Example City, ST</span></a></li>
</ul></section>`,
];
const unpadded = (n) => { const d = at(n); return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`; };

// ---- Oracle Recruiting Cloud ----
const ORACLE = [
  { Id: '3001', Title: 'Senior Data Engineer', PostedDate: ymd(2), PrimaryLocation: 'Example City, ST, United States', secondaryLocations: [{ Name: 'Remote, US' }], WorkplaceType: 'Hybrid' },
  { Id: '3002', Title: 'Example Recruiter', PostedDate: ymd(2), PrimaryLocation: 'Example City, ST, United States', secondaryLocations: [], WorkplaceType: 'On-site' },
];

// ---- SuccessFactors: HTML table rows; each title link appears twice (desktop and phone), in either attribute order ----
const shortDate = (n) => at(n).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const sfDatePosted = (n) => { const d = at(n); return `${d.toUTCString().slice(0, 3)} ${d.toUTCString().slice(8, 11)} ${String(d.getUTCDate()).padStart(2, '0')} 02:00:00 UTC ${d.getUTCFullYear()}`; };
const SUCCESSFACTORS = `<div class="pagination-label">Results 1 – 2 of <b>2</b></div><table>
<tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a href="/job/Example-City-Senior-Data-Engineer/2001/" class="jobTitle-link">Senior Data Engineer</a></span><div class="jobdetail-phone visible-phone"><span class="jobTitle visible-phone"><a class="jobTitle-link" href="/job/Example-City-Senior-Data-Engineer/2001/">Senior Data Engineer</a></span></div></td><td class="colLocation hidden-phone"><span class="jobLocation"> Example City, ST, US <small class="nobr">+2 more&hellip;</small></span></td><td class="hidden-phone"></td></tr>
<tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Remote-Staff-Data-Engineer/2002/">Staff Data Engineer</a></span></td><td class="colLocation hidden-phone"><span class="jobLocation">Remote, US</span></td><td class="colDate"><span class="jobDate">${shortDate(6)}</span></td></tr>
</table>`;

// ---- iCIMS: job cards; the place in an unlabeled span, the date in a title attribute, remote work in a field list ----
const icimsDate = (n) => { const d = at(n); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} 11:02 AM`; };
const icimsCard = (id, slug, title, place, telecommute) => `<li class="iCIMS_JobCardItem">
<div class="row">
<div class="col-xs-6 header left">
<span class="sr-only field-label">Job Locations</span>
<span >
${place}</span>
</div>
<div class="col-xs-6 header right">
<span class="sr-only field-label">Posted Date</span>
<span title="${icimsDate(1)}">
1 day ago<span class="sr-only">(${icimsDate(1)})</span></span>
</div>
<div class="col-xs-12 title">
<a href="https://icims.example.invalid/jobs/${id}/${slug}/job?in_iframe=1" class="iCIMS_Anchor" title="${id} - ${title}">
<span class="sr-only field-label">Title</span>
<h3 >
${title}</h3>
</a>
</div>
<div class="col-xs-12 additionalFields">
<dl class="iCIMS_JobHeaderGroup">
<div class="iCIMS_JobHeaderTag">
<dt class="iCIMS_JobHeaderField">Telecommute Options</dt>
<dd class="iCIMS_JobHeaderData"><span >
${telecommute}</span>
</dd>
</div>
</dl>
</div>
</div>
</li>`;
const ICIMS = `<div class="iCIMS_Paging">Page 1 of 1</div><ul>
${icimsCard('4001', 'senior-data-engineer', 'Senior Data Engineer', 'US-ST-Example City', 'No remote/telework allowed')}
${icimsCard('4002', 'staff-data-engineer', 'Staff Data Engineer', 'US-ST-Other City', 'Remote')}
</ul>`;

// ---- The fallback reader: robots.txt, a job sitemap, and job pages with JobPosting structured data ----
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://page.example.invalid/about</loc><lastmod>${ymd(30)}</lastmod></url>
<url><loc>https://page.example.invalid/jobs/5001/senior-data-engineer</loc><lastmod>${ymd(3)}</lastmod></url>
<url><loc>https://page.example.invalid/jobs/5002/example-recruiter</loc><lastmod>${ymd(3)}</lastmod></url>
</urlset>`;

// ---- Hacker News "Who is hiring?" (Algolia API): the thread, then its posts, links escaped as &#x2F; ----
const hnLink = (u) => `<a href="${u.replace(/\//g, '&#x2F;')}" rel="nofollow">${u.replace(/\//g, '&#x2F;')}</a>`;
const HN_POSTS = [
  { id: 9100001, text: `Employer R | Senior Data Engineer | Remote (US) | ${hnLink('https://boards.greenhouse.io/test-employer-r')}<p>Example post text.` },
  { id: 9100002, text: 'Employer A | Senior Data Engineer | Remote (US)<p>Already on the watchlist.' },
  { id: 9100003, text: 'Employer S | Example Recruiter | Remote (US)<p>Not a matching title.' },
  { id: 9100004, text: 'Employer T | Senior Data Engineer | London<p>Not a matching place.' },
  { id: 9100005, text: 'Employer U | Staff Data Engineer | Example City, ST<p>No board linked.' },
  { id: 9100006, text: null },
];

export function respond(url, init, on) {
  const u = new URL(url), q = u.searchParams, path = u.pathname;
  const qnum = (k) => +(q.get(k) ?? 0);
  switch (u.host) {
    case 'boards-api.greenhouse.io': {
      // Employer R is not on the watchlist: discover.mjs finds its board.
      if (path === '/v1/boards/test-employer-r/jobs') return { json: { jobs: greenhouse(new Set()).slice(0, 2), meta: { total: 2 } } };
      const m = path.match(/^\/v1\/boards\/test-employer-a\/jobs(?:\/(\d+))?$/);
      if (!m) return;
      const jobs = greenhouse(on);
      if (!m[1]) return { json: { jobs, meta: { total: on.has('greenhouse-short') ? 30 : jobs.length } } };
      if (on.has('greenhouse-detail-503')) return { status: 503, text: 'Service Unavailable' };
      const j = jobs.find((x) => String(x.id) === m[1]);
      return j && { json: { ...j, content: escape(para(160)), pay_input_ranges: [{ min_cents: 15000000, max_cents: 19000000, currency_type: 'USD', title: 'Example Range', blurb: '' }],
        departments: [{ id: 1, name: 'Example Team' }] } };
    }
    case 'api.ashbyhq.com':
      return path === '/posting-api/job-board/test-employer-b' ? { json: { jobs: ashby(on), apiVersion: '1' } } : undefined;
    case 'api.lever.co': {
      if (path === '/v0/postings/test-employer-c') return { json: lever(on) };
      const j = lever(on).find((x) => path === `/v0/postings/test-employer-c/${x.id}`);
      return j && { json: { ...j, descriptionPlain: words(160), lists: [{ text: 'Requirements', content: '<li>Example requirement</li>' }], additionalPlain: 'Example additional text.',
        salaryRange: { currency: 'USD', interval: 'per-year-salary', min: 150000, max: 190000 } } };
    }
    case 'test-employer-d.wd1.myworkdayjobs.com': {
      if (on.has('workday-down')) return { redirect: 'https://community.workday.com/maintenance-page', text: '<html>Example maintenance page</html>' };
      if (path === '/wday/cxs/test-employer-d/Careers/jobs' && init.method === 'POST') {
        const { offset = 0, limit = 20 } = JSON.parse(init.body);
        return { json: { total: offset ? 0 : WORKDAY.length, jobPostings: WORKDAY.slice(offset, offset + limit), facets: [], userAuthenticated: false } };
      }
      const j = [...WORKDAY, WORKDAY_OLD].find((x) => path === `/wday/cxs/test-employer-d/Careers${x.externalPath}`);
      return j && { json: { jobPostingInfo: { id: 'x', title: j.title, jobDescription: para(160), location: j.locationsText ?? 'Remote, US', additionalLocations: ['Remote, US'],
        postedOn: j.postedOn, startDate: ymd(2), externalUrl: `https://test-employer-d.wd1.myworkdayjobs.com/en-US/Careers${j.externalPath}` }, hiringOrganization: { name: 'Employer D' } } };
    }
    case 'careers.example.invalid': {
      if (path === '/api/pcsx/search') {
        eightfoldCalls++;
        if (on.has('eightfold-429-always') || (on.has('eightfold-429') && eightfoldCalls === 1)) return { status: 429, text: 'Too Many Requests' };
        if (on.has('eightfold-retry-after') && eightfoldCalls === 1) return { status: 429, headers: { 'Retry-After': '7' }, text: 'Too Many Requests' };
        if (on.has('eightfold-429-later') && qnum('start') > 0) return { status: 429, text: 'Too Many Requests' };
        const start = qnum('start');
        return { json: { status: 200, data: { positions: EIGHTFOLD.slice(start, start + 10), count: EIGHTFOLD.length } } };
      }
      const j = path === '/api/pcsx/position_details' && EIGHTFOLD.find((x) => String(x.id) === q.get('position_id'));
      return j ? { json: { status: 200, data: { ...j, jobDescription: para(160) } } } : undefined;
    }
    case 'jobs.example.invalid': {
      if (path === '/api/apply/v2/jobs') return { json: { positions: qnum('start') ? [] : EIGHTFOLD_V2, count: EIGHTFOLD_V2.length } };
      const j = EIGHTFOLD_V2.find((x) => path === `/api/apply/v2/jobs/${x.id}`);
      return j && { json: { ...j, department: 'Example Team', job_description: para(160) } };
    }
    case 'api.smartrecruiters.com': {
      if (path === '/v1/companies/TestEmployerI/postings') return { json: { offset: qnum('offset'), limit: 100, totalFound: SMARTRECRUITERS.length, content: qnum('offset') ? [] : SMARTRECRUITERS } };
      const j = SMARTRECRUITERS.find((x) => path === `/v1/companies/TestEmployerI/postings/${x.id}`);
      return j && { json: { ...j, department: { label: 'Example Team' }, postingUrl: `https://example.invalid/employer-i/${j.id}`,
        jobAd: { sections: { jobDescription: { title: 'Job Description', text: para(160) }, qualifications: { title: 'Qualifications', text: '<p>Example qualification.</p>' } } } } };
    }
    case 'www.amazon.jobs': {
      if (path === '/en/search.json') return { json: { hits: AMAZON.length, jobs: qnum('offset') ? [] : AMAZON } };
      const j = AMAZON.find((x) => path === x.job_path);
      return j && { text: page(`<main><h1>${j.title}</h1>${para(170)}</main>`) };
    }
    case 'www.google.com': {
      if (path === '/about/careers/applications/jobs/results')
        return { text: page(`<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([q.get('page') === '1' ? GOOGLE : [], null, GOOGLE.length, 20])}, sideChannel: {}});</script>`) };
      const id = path.match(/^\/about\/careers\/applications\/jobs\/results\/(.+)$/)?.[1], r = GOOGLE.find((x) => x[0] === id);
      return r ? { text: page(ldPosting({ title: r[1], datePosted: ymd(2), description: para(160) })) }
        : id ? { text: '<!doctype html><html><head><title>Jobs search — Google Careers</title></head><body>Example search page</body></html>' } : undefined;
    }
    case 'jobs.apple.com': {
      if (path === '/en-us/search')
        return { text: page(`<script>${appleData({ root: {}, search: { searchResults: q.get('page') === '1' ? APPLE : [], totalRecords: APPLE.length } })}</script>`) };
      const j = APPLE.find((x) => path === `/en-us/details/${x.id}/${x.transformedPostingTitle}`);
      if (!j) return path.startsWith('/en-us/details/') ? { text: page(`<script>${appleData({ root: {} }, { jobDetails: { status: 404, statusText: '', internal: false, data: '', __type: 'RouteErrorResponse' } })}</script>`) } : undefined;
      const jobsData = on.has('apple-stub') ? { postingTitle: j.postingTitle, jobSummary: words(69) }
        : { postingTitle: j.postingTitle, jobSummary: words(60), description: words(100), minimumQualifications: 'Example qualification.', preferredQualifications: 'Example preference.',
          teamNames: ['Example Team'], postDateInGMT: j.postDateInGMT, postingFooters: [{ localizations: { en_US: [{ displayOrder: 1, name: 'Pay', content: 'Example pay range $150,000 - $190,000.' }] } }] };
      return { text: page(`<script>${appleData({ root: {}, jobDetails: { jobsData } })}</script>`) };
    }
    case 'talentbrew.example.invalid': {
      if (path === '/search-jobs/results') return { json: { results: TALENTBREW_PAGES[qnum('CurrentPage') - 1] ?? '', hasJobs: true } };
      const m = path.match(/^\/job\/[^/]+\/([^/]+)\/1001\/\d+$/);
      return m && { text: page(ldPosting({ title: m[1].replace(/-/g, ' '), datePosted: unpadded(5), description: para(160), url: url,
        jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Example City', addressRegion: 'ST', addressCountry: 'US' } }] })) };
    }
    case 'oracle.example.invalid': {
      if (path.endsWith('/recruitingCEJobRequisitions')) {
        const offset = +(url.match(/offset=(\d+)/)?.[1] ?? 0);
        return { json: { items: [{ TotalJobsCount: ORACLE.length, Offset: offset, Limit: 25, requisitionList: offset ? [] : ORACLE }] } };
      }
      if (!path.endsWith('/recruitingCEJobRequisitionDetails')) return;
      const j = ORACLE.find((x) => url.includes(`Id=%22${x.Id}%22`));
      return { json: { items: j ? [{ ...j, ExternalPostedStartDate: iso(2), Organization: 'Example Team', ExternalDescriptionStr: para(160), ExternalQualificationsStr: '<p>Example qualification.</p>' }] : [], count: j ? 1 : 0 } };
    }
    case 'sf.example.invalid': {
      if (path === '/search/') return { text: page(qnum('startrow') ? '' : SUCCESSFACTORS) };
      if (/^\/job\/[^/]+\/200[12]\/$/.test(path)) return { text: page(`<span itemprop="title">${path.includes('Senior') ? 'Senior Data Engineer' : 'Staff Data Engineer'}</span>
<meta itemprop="datePosted" content="${sfDatePosted(2)}"><div class="job"><span class="jobdescription">${para(160)}</span>
</div>`) };
      return path.startsWith('/job/') ? { redirect: 'https://sf.example.invalid/errorpage/?errortype=Exception', text: page('Example error page') } : undefined;
    }
    case 'icims.example.invalid': {
      if (path === '/jobs/search') return { text: page(ICIMS) };
      const m = path.match(/^\/jobs\/(400[12])\/([^/]+)\/job$/);
      return m && { text: page(ldPosting({ title: m[2].replace(/-/g, ' '), datePosted: ymd(1), description: para(160) })) };
    }
    case 'hn.algolia.com': {
      if (path === '/api/v1/search_by_date') return { json: { hits: [{ objectID: '9100000', title: 'Ask HN: Who is hiring? (Example Month 2026)' }, { objectID: '9000000', title: 'Ask HN: Who wants to be hired? (Example Month 2026)' }] } };
      if (path === '/api/v1/items/9100000') return { json: { id: 9100000, title: 'Ask HN: Who is hiring? (Example Month 2026)', children: HN_POSTS.map((c) => ({ ...c, author: 'example', children: [] })) } };
      return;
    }
    case 'page.example.invalid': {
      if (path === '/robots.txt') return { text: on.has('page-robots-block') ? 'User-agent: *\nDisallow: /\n' : 'User-agent: ExampleBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n' };
      if (path === '/sitemap.xml') return { text: SITEMAP };
      // A careers page for discover.mjs board: a Greenhouse link and an Eightfold marker.
      if (path === '/careers') return { text: page('<a href="https://boards.greenhouse.io/test-employer-r">Open roles</a><script src="https://static.eightfold.ai/x.js"></script>') };
      const m = path.match(/^\/jobs\/(500[12])\/([^/]+)$/);
      return m && { text: page(ldPosting({ title: m[2] === 'senior-data-engineer' ? 'Senior Data Engineer' : 'Example Recruiter', datePosted: iso(3), description: para(160),
        jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Example City', addressRegion: 'ST', addressCountry: 'US' } } })) };
    }
  }
}
