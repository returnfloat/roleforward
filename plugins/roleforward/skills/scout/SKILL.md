---
name: scout
description: Weekly job scout for the workspace owner. Searches the career sites of the employers on their watchlist, screens postings against their criteria, and shortlists a few for their review with light research, in the workspace and the Google Sheet. Use when the user says "scout", "run the scout", "find me jobs", asks what's new on the watchlist, or wants employers added to or removed from the watchlist. Never applies or contacts anyone.
---

# Scout

`/scout` fills the user's review queue. It searches, screens, and shortlists. It never applies, never contacts anyone, and never signs in to a job site. The user decides what happens next, through `/apply`.

## Working With the Workspace

- **Statuses set in the sheet come first.** If the workspace has a sheet, pull its Shortlist status changes (the `sheet` skill's Sync, step 2) before the run, so a posting the user passed in the sheet isn't treated as still waiting.
- **The workspace** is the current folder (or the nearest parent with a `workspace.yaml`). Read `workspace.yaml`: `scout.*` holds the title screen, search terms, and the shortlist cap, and `targets.*` holds goals, the place screen (`country`, `remote`, and up to three `places` with their nearby names), and the optional pay floor.
- **Read these before the first run in a session:** the plugin's `<templates>/applications/README.md` (stages and record format; `<templates>` is the plugin's `templates/` folder, two levels above this skill's base directory) and the career direction file (`files.direction`), especially its **Dealbreakers** and **Preferences** sections. `node <tools>/fit.mjs list` prints both, and flags problems such as more than five preferences.
- **The workspace's own instructions win, except on what drops or ranks a posting.** The workspace's `CLAUDE.md` and `MEMORY.md` override this skill on how to work. But only the Dealbreakers, the Preferences, and the `workspace.yaml` settings drop or rank a posting. A note in MEMORY.md or CLAUDE.md, something said in chat, or a reason the user gave when passing on another posting never adds a criterion. If one looks like it should, ask the user whether to add it to the career direction file, and act on it only after they say yes.
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory. Run them from the workspace root as `node <tools>/scout.mjs`.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## Rules

- **Volume:** at most `scout.max_shortlist` postings per run (10 if unset), at the cadence in `scout.cadence` (weekly if unset). Everything else stays one line in `applications/data/seen.csv`, with no files. Only a shortlisted posting gets a folder.
- **Sources:** only the employers in `applications/watchlist.md`, unless the user adds other sources.
- **Pay:** its own setting, separate from Dealbreakers and Preferences, and off by default. Only when the user set a floor in `targets.pay` (during onboarding) does pay drop a posting, and only when the top of its published range is more than `targets.pay.drop_below` percent (10 by default) below the floor. Pay never changes a score. Either way, show each posting's published range so the user can judge it.
- **Expiry:** a posting awaiting a decision (shortlisted or interested) expires only when the posting itself says it's gone. Every run checks each one on its own, through its job's detail page or link, never by whether a search still lists it.
- **Facts:** fit notes use only portfolio facts, as in `/apply`. Mark guesses (inferred).
- **Visa, only when `targets.visa.needs_sponsorship` is true:** the user needs an employer to sponsor a work visa. A posting that says it won't sponsor, or that requires citizenship or a clearance, is dropped. When `targets.visa.deadline` is set, the scout's run and the tracker start with the days left, and the report leads with it too.

## Steps

1. **Run the fetch:** `node <tools>/scout.mjs`. It prints every posting to screen: new ones that passed the title and place screens, earlier `held` ones that are still listed, and shortlisted postings that have closed. A matching title in the wrong place needs nothing: an office elsewhere is only counted in the run's first line, and a role that's remote only in another country is already recorded as dropped ("Wrong place: <its location>"), so it shows in the sheet's Scout Log. If one of those looks like a real match (a country call that's wrong, or a nearby town that isn't listed), tell the user, and with their OK fix it: a nearby name goes in that place's list in `targets.places`.
2. **Check feed health before trusting "nothing new."** A parsing failure must never pass for a quiet week. Fix every warning line, or report it to the user in the run report. Never skip one silently.
   - `[error]`: the feed failed. A 429 (rate limit) usually clears by the next day. Anything else, check the board in the watchlist.
   - `[down]`: a job site is in planned maintenance (Workday has it on many weekends), so its employers weren't checked this run. Nothing to fix: re-run the scout once the site is back, and say in the report which employers were skipped.
   - `[empty]`: nothing came back. That usually means a changed board name or page layout, not zero openings.
   - `[short]`: fewer postings than the site itself reports, which usually means broken paging.
   - `[partial]`: the site refused later pages (a rate limit), so only the newest postings were checked. Nothing to fix: the next run tries again.
   - `[repeat]`: duplicate postings, which means pages are repeating.
   - `[drop]`: far below the employer's usual count (history is in `applications/data/feed-health.csv`).
   - `[check]`: the scout couldn't tell whether a posting awaiting a decision is still open, for three runs in a row (the reason is on the line). Don't expire it. Open the posting by hand, and expire it only if it's gone.
3. **Validate the feeds end to end** with `node <tools>/scout.mjs validate` whenever the run says it's due: monthly, or after any warning or error. It opens one real posting per source type and checks for a title and a full description. A `FAIL` blocks shortlisting from that source until it's fixed, because screening on a stub description gives wrong calls. Results go to `applications/data/feed-validation.json`.
4. **Known quirks** (already handled in `tools/scout.mjs`, so check these first when a feed breaks):
   - **Workday** reports its total on the first page only.
   - **TalentBrew** has two page layouts. Its path-based paging stops at page 2, so the scout uses its results endpoint, and job IDs must come from `data-job-id`, not the URL.
   - **Eightfold** returns 10 per page whatever is asked, and some tenants (Microsoft) rate-limit fast paging, so the scout pauses a second between pages and, after a 429, waits as long as the site's Retry-After asks.
   - **Apple** job pages need their router data for the description, and **Google** embeds results in the page.
   - **iCIMS** shows a "Telecommute Options" note. It counts as a place only when it allows remote work.
   - **The `page` fallback** has no location in a sitemap, so it reads the job pages of titles that pass the screen (up to 40) for their place.
5. **Closed postings:** each `[closed]` line is already handled. The run added the event `YYYY-MM-DD | expired | posting closed` to that posting.md and deleted its `jd.md`, keeping posting.md so the stats still count it. Name them in the report. `node <tools>/scout.mjs closed` shows each waiting posting's state without changing anything.
6. **Screen each posting** from its title, location, and date first. Load the description (`node <tools>/scout.mjs show <key>`) only when the title can't settle it. Drop it only when it breaks one of the **Dealbreakers** in the career direction file (at most five; `fit.mjs list` flags more, and only the first five apply), with `node <tools>/scout.mjs mark <key> dropped "<Dealbreaker name>: <short reason>"`. Start every drop reason with the dealbreaker's name exactly as the file writes it ("Wrong level: first-line manager"), so the Stats tab can count drops per dealbreaker. A posting that breaks none is kept, however it compares with postings the user passed on before. When a posting looks wrong for a reason no dealbreaker covers, keep it, say so in its triage note, and ask in the report whether that reason should become a dealbreaker. If the file has no Dealbreakers section yet, use these defaults and offer to write them in:
   - **Wrong role:** outside the target field or titles in `targets`.
   - **Wrong level:** outside `targets.titles` and the level range.
   - **Wrong place:** the place screen already dropped postings that are clearly elsewhere. What reaches you here can still break this: "Remote" with no country, only the country, or "Multiple locations" passes the screen for the description to settle, so check it for the country or office the role needs.

   Three more checks come from settings, not the Dealbreakers list, and drop with their own name as the reason's start:
   - **Stale:** posted more than `scout.stale_days` days ago (60 if unset), with the reason "Stale: posted <date>".
   - **Sponsorship, only when `targets.visa.needs_sponsorship` is true:** load every posting that passes the other screens with `node <tools>/scout.mjs show <key>`, which adds a "Sponsorship check" line (what the description says, quoted) and a "Sponsor history" line (the employer's H-1B approvals in USCIS data). Drop "says no sponsorship" ("Sponsorship: no visa sponsorship") and "requires citizenship or a clearance" ("Sponsorship: citizens only"). Keep "not mentioned", which is common. If `applications/data/sponsors.csv` doesn't exist yet, run `node <tools>/visa.mjs fetch` first (about 7 MB from uscis.gov, so say so the first time). Its files stop at fiscal year 2023. For newer years, the user can export a CSV from the USCIS H-1B Employer Data Hub (Crosstab view, then Download) and run `node <tools>/visa.mjs import <file>`. `node <tools>/visa.mjs status` shows which years are loaded.
   - **Pay, only when `targets.pay.min` is set:** `node <tools>/scout.mjs show <key>` adds a "Pay check" line. Drop only when it says "drop" (the top of the range is more than `drop_below` percent under the floor), with the reason "Pay: <the check line>". A range below the floor but within that margin stays: put the check line in the triage note. When no pay is published, follow `targets.pay.unlisted`: `keep` (the default) keeps it and says so in the triage note, and `drop` drops it ("Pay: not published").
   - **Already in the workspace:** mark it `shortlisted`, set `scout_key` in its posting.md, and move on.
7. **Score and rank what's left.** Give each posting two scores (never blended into one):
   - **Role fit (1 to 5):** how well the user's record matches the role, judged against the default resume and portfolio.
   - **Preference fit:** rate each preference from the career direction file 1 to 5 from the posting, or `unknown` when the posting doesn't say (company signals such as stability are often unknown until `/apply` researches the company). Unknowns don't count against a posting.

   Rank by the lower of the two scores first, then the higher, then the newest posting, and take the top postings up to the cap. Mark each additional good one `held` with a reason, so it comes back next run while it's still listed. Shortlist fewer when fewer are worth the user's time. An empty week is fine.
8. **Shortlist** each pick:
   - Run `node <tools>/scout.mjs mark <key> shortlisted "<one line>"`.
   - Create `applications/<company-slug>/<YYYY-MM-DD>-<role-slug>/`, where the date is the shortlist date.
   - Run `node <tools>/scout.mjs capture <key> <folder>` to write `jd.md`.
   - Write `posting.md` from `<templates>/applications/posting-template.md`, filling the frontmatter (`source: scout`, `scout_key`, `why`, and `events: - YYYY-MM-DD | shortlisted`) and only the **Triage** section, in about 150 words: location and work mode, published pay, the level check (see the apply skill, two or three lookups), any dealbreaker signal, two or three fit points, and a one-line company snapshot. No `company.md` yet. That waits until the user is interested.
   - **Sponsorship, only with the visa module:** fill the Triage table's Sponsorship row from the two `show` lines. When the history names similar filing names, judge which belong to the employer (a subsidiary that files for it does, an unrelated business with a similar name doesn't), and suggest adding the ones that belong under `targets.visa.aliases`. No record at all is a risk to note, not a reason to drop: the employer may file under a parent's name, or have never been asked. When ranking, a posting from an employer with a steady sponsorship record beats an equal fit without one.
   - **Scores:** run `node <tools>/fit.mjs set <folder> --role <1-5> <preference-key>=<1-5|unknown> ...` (keys from `fit.mjs list`, shortened while unique). It writes `role_fit`, each rating, and the computed `preference_fit` into posting.md. Put both scores and the ratings in the Triage table's Scores row, and let `why` name what drove them.
   - **Contacts, only if `connections.enabled` is true:** run `node <tools>/connections.mjs match <company>` and fill the Triage table's Contacts row with the count and the top one or two (name and title), or "none". It's display only, so it never changes a score or which postings make the cut (the `connections` skill).
9. **Update:** run `node <tools>/sheet.mjs prune --apply` (it archives postings that ended more than `sheet.history_days` ago without an application, whether or not the workspace has a sheet) and `node <tools>/tracker.mjs`, then sync the Google Sheet with the `sheet` skill if the workspace has one. That also refreshes the sheet's Scout Log tab, where the user can see every posting from the last two weeks that passed the first screen, with your call and reason.
10. **Report** in chat:
    - A table of the shortlist (company, role, location, pay, level, Role fit, Preference fit, why, plus contacts when the connections module is on).
    - The counts: fetched, screened, dropped, and held, with the drops per dealbreaker.
    - Any posting kept despite looking wrong for a reason no dealbreaker covers, with the question of whether that reason should become one.
    - With the visa module: the days left before the deadline (first line of the report), and how many postings were dropped for sponsorship.
    - With discovery on and a new month's thread up: the proposed employers (see Finding New Employers).
    - Anything closed, every feed warning and how it was handled, and the validation status.
    - The connections refresh nudge, if a script printed one (once per session, in one line).

    Then ask the user for a call on each shortlisted posting: **interested** or **pass**.

## After the Report

- **Interested:** hand off to `/apply` Stage 1, which adds the `interested` event and does the full fit analysis and the company quick check.
- **Pass:** add `YYYY-MM-DD | passed | <their reason>`, delete `jd.md`, and keep posting.md. The reason belongs to that posting only: never start dropping or down-ranking other postings for it. If it sounds like a general rule (for example "no consulting firms"), you may ask once whether to add it as a dealbreaker or preference, and change the career direction file only when the user says yes.
- **Tuning:** when the user says the screen is too loose or too tight, adjust `workspace.yaml` `scout.*` (the keyword screens), the Dealbreakers, or the Preferences, as they direct, and note the change in MEMORY.md. The Stats tab's Drops by dealbreaker or setting count shows which dealbreaker is cutting the most.

## Finding New Employers (discovery)

The watchlist only covers employers the user already knows. When `scout.discover` lists a source, propose new ones, and add only the ones the user approves.

- **`hn`:** the monthly Hacker News "Who is hiring?" thread, posted on the first weekday of each month and read through HN's public API. Run `node <tools>/discover.mjs hn` once a month, after the new thread is up. It lists posts from employers not on the watchlist (or proposed before) that pass the same title and place screens as the scout, with the job board each post links to and its open postings.
- **Judge each one** against the Dealbreakers, as in step 6, and drop the wrong ones with `node <tools>/discover.mjs mark "<Company>" skipped "<reason>"`. Read the post through its HN link when the first line doesn't settle it.
- **Propose the rest** in the run report: company, roles, place, and its board, with a one-line reason. Never contact an employer, even when a post says "email us": that's the user's call.
- **On the user's OK,** add the employer (find a missing board with `node <tools>/discover.mjs board "<Company>" [<careers URL>]`, then the steps under The Watchlist below), and run `node <tools>/discover.mjs mark "<Company>" added`. A skipped employer isn't proposed again.
- **Other ways to find employers,** when the user asks: web searches for lists in their field and place (for example recent funding rounds, or "best places to work" lists from reputable outlets), checked with `discover.mjs board`. Sites that need a login or ban automated access are out, as for the scout.

`node <tools>/discover.mjs list` shows proposals still waiting for the user's call.

## The Watchlist

`applications/watchlist.md` holds a table under `## Watchlist` with the columns Company, Source, Board, Why, and Domain. Domain groups employers by field (for example Fintech, Health, or Security), and the sheet's Employers tab can be filtered by it. A row whose Company starts with `~` is paused, and the scout skips it.

**Edit it with `node <tools>/watchlist.mjs`** rather than by hand, so the table and the sheet stay in step: `add "<Company>" --domain "<Domain>" --source <source> --board <board> --why "<reason>"`, `set "<Company>" --domain ...` (or `--source`, `--board`, `--why`), `pause`, `resume`, `remove`, and `list` (by domain). Pick the domain from the ones `list` shows, and make a new one only when nothing fits. The user can also edit the list in the sheet's Employers tab (new rows, Domain, and Status), and the next sheet sync brings those edits here (the `sheet` skill).

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

**To add an employer:**
1. Open its careers page and look for one of the hosts above in the page source (`curl -sL <url>` and search it).
2. Check the feed with the URL in the table, and add the employer with `watchlist.mjs add` (or `set` for an employer the user added in the sheet, which arrives as `manual`).
3. Run `node <tools>/scout.mjs` and confirm the employer doesn't come back `[empty]`.

If there's no supported feed, try `page` with the site's job sitemap or listing page, and confirm a run finds its postings. If that finds nothing, keep it as `manual` with its careers URL as the Board. Don't add a new source type without the user's OK, since each one needs a fetcher and a detail reader in `tools/scout.mjs`, plus a pass through `validate`.

## Scheduled Runs

Run the scout on demand while the screen is being tuned. Once it's settled, the user can have it run on its own through **Claude Code Desktop's local scheduled tasks**: Desktop starts a fresh session in the workspace folder at the chosen time, with the user's files, plugins, and connectors. Nothing is installed on the computer itself. There are three tasks, all off by default: the scout, a sheet sync, and monthly discovery.

1. **Pick the frequency** with the user, and record it in `workspace.yaml` under `schedule.<job>` (`every`: daily, weekdays, weekly, or monthly, `day`, and `at`). Match the scout's to `scout.cadence`.
2. **Print the task's fields:** `node <tools>/schedule.mjs <job>` gives the name, description, instructions, folder, schedule, and permission mode.
3. **Create it:** in a Desktop session that has a scheduled-tasks tool, create the task with those fields after the user says yes. Otherwise, walk the user through it: the Code tab, then Routines, New routine, and Local, pasting the fields. A monthly schedule isn't a preset, so they ask Claude in any Desktop session to set it.
4. **Test it once:** Run now with the user watching, and choose "always allow" for each permission prompt (node scripts, the Google Sheets connector), so later runs don't stall waiting for approval.
5. **Record it:** set `schedule.<job>.enabled: true` and note the date in MEMORY.md. To pause or stop a task, the user toggles it in Routines (or asks Claude in Desktop), and `enabled` goes back to false.

Tasks run only while the Desktop app is open and the computer is awake. A missed run is made up once on wake, so a prompt can't assume the time of day. `/loop` doesn't fit, since it lives in one session and expires after a week, and neither do cloud routines, which can't see a local folder.

**When the prompt says it's a scheduled run,** no one is watching:
- Never ask a question or wait for an answer. Where a step says to ask, take the safe choice and list it in the report instead.
- Run the steps as usual: shortlisting is fine, since it only fills the user's review queue. Never apply, contact anyone, or add an employer to the watchlist. Discovery only proposes.
- Fix nothing that needs a judgment call (a broken feed, a new source type, a pause of many employers). Report it.
- If the Google Sheets connector isn't available, do every local step, skip the sync, and say so in the report.
- Add one dated line to the workspace's MEMORY.md with the counts and anything waiting on the user, and end with the run report. Desktop keeps the session, so the user reads it under Scheduled in the sidebar.
