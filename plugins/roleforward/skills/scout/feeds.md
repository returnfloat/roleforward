# Feeds: Sources, Adding an Employer, and Known Quirks

Read this when adding an employer to the watchlist, finding the feed for one the user added in the sheet (which arrives as `manual`), or fixing a feed that broke. The scout skill's rules still hold: don't add a new source type without the user's OK.

## Sources

| Source | Board | How to find it |
|---|---|---|
| `greenhouse` | board name | Links to `boards.greenhouse.io/<board>` or `job-boards.greenhouse.io/<board>`. Check with `https://boards-api.greenhouse.io/v1/boards/<board>/jobs` |
| `ashby` | board name | Links to `jobs.ashbyhq.com/<board>`. Check with `https://api.ashbyhq.com/posting-api/job-board/<board>` |
| `lever` | company name | Links to `jobs.lever.co/<company>`. Check with `https://api.lever.co/v0/postings/<company>?mode=json` |
| `workday` | `tenant/wdN/site` | Links to `<tenant>.wdN.myworkdayjobs.com/<site>`. Check with a POST to `https://<tenant>.wdN.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` |
| `talentbrew` | `<jobs host>/<org number>` | Career sites loading assets from `tbcdn.talentbrew.com/company/<number>` |
| `eightfold` | `<host>/<domain>/<pcsx or v2>` | Career sites on Eightfold. Try `/api/pcsx/search` first, then `/api/apply/v2/jobs` |
| `smartrecruiters` | company identifier | Links to `jobs.smartrecruiters.com/<Company>` |
| `oracle` | `<host>/<site number>` | Career sites on `<host>/hcmUI/CandidateExperience/.../sites/<site number>/...` (Oracle Recruiting Cloud). Check with `https://<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=<site number>,limit=5` |
| `successfactors` | `<host>`, optionally `?<extra search parameters>` | Career sites whose page source loads from `rmkcdn` or mentions `jobs2web` (SAP SuccessFactors Career Site Builder), with a `/search/?q=` page. For a large global employer, add a location filter such as `?locationsearch=United%20States` |
| `icims` | the portal host | Links to `careers-<company>.icims.com`. Check with `https://<host>/jobs/search?ss=1&in_iframe=1` |
| `amazon`, `google`, `apple` | `-` | Their own career sites |
| `page` | a URL without `https://` | The fallback for any other careers site. Point it at the site's job sitemap (look in `/robots.txt` or try `/sitemap.xml`) or at a careers page that lists jobs as plain links. It honors robots.txt. Pages that build their list with JavaScript show nothing, so those stay `manual` |
| `manual` | the careers URL | No supported feed. It stays on the list as a reminder to check by hand |

## To Add an Employer

1. Open its careers page and look for one of the hosts above in the page source (`curl -sL <url>` and search it).
2. Check the feed with the URL in the table, and add the employer with `watchlist.mjs add` (or `set` for an employer the user added in the sheet, which arrives as `manual`).
3. Run `node <tools>/scout.mjs` and confirm the employer doesn't come back `[empty]`.

If there's no supported feed, try `page` with the site's job sitemap or listing page, and confirm a run finds its postings. If that finds nothing, keep it as `manual` with its careers URL as the Board. Don't add a new source type without the user's OK, since each one needs a fetcher and a detail reader in `tools/scout.mjs`, plus a pass through `validate`.

## Known Quirks

Already handled in `tools/scout.mjs`, so check these first when a feed breaks:
- **Workday** reports its total on the first page only.
- **TalentBrew** has two page layouts. Its path-based paging stops at page 2, so the scout uses its results endpoint, and job IDs must come from `data-job-id`, not the URL.
- **Eightfold** returns 10 per page whatever is asked, and some tenants (Microsoft) rate-limit fast paging, so the scout pauses a second between pages and, after a 429, waits as long as the site's Retry-After asks.
- **Apple** job pages need their router data for the description, and **Google** embeds results in the page.
- **iCIMS** shows a "Telecommute Options" note. It counts as a place only when it allows remote work.
- **The `page` fallback** has no location in a sitemap, so it reads the job pages of titles that pass the screen (up to 40) for their place.
