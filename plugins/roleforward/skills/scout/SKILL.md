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
- **Setup trouble:** when a script fails in a way that points to setup, run `node <tools>/doctor.mjs`, which changes nothing, and fix what it calls a problem.

## Rules

- **Volume:** at most `scout.max_shortlist` postings per run (10 if unset), at the cadence in `scout.cadence` (weekly if unset). Everything else stays one line in `applications/data/seen.csv`, with no files. Only a shortlisted posting gets a folder.
- **Sources:** only the employers in `applications/watchlist.md`, unless the user adds other sources.
- **Pay:** its own setting, separate from Dealbreakers and Preferences, and off by default. Only when the user set a floor in `targets.pay` (during onboarding) does pay drop a posting, and only when the top of its published range is more than `targets.pay.drop_below` percent (10 by default) below the floor. Pay never changes a score. Either way, show each posting's published range so the user can judge it.
- **Expiry:** a posting awaiting a decision (shortlisted, interested, or in conversation) expires only when the posting itself says it's gone. Every run checks each one on its own, through its job's detail page or link, never by whether a search still lists it. One with neither a `scout_key` nor a posting link (a lead from a conversation, usually) isn't checked, and never expires for lacking one.
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
4. **Audit the title screen** with `node <tools>/scout.mjs audit` whenever the run says it's due: monthly, and after any change to `scout.title_all` or `scout.title_none`. An over-tight pattern hides postings as silently as a broken feed. From the postings the last run saved, it lists those in a place that fits whose title fails exactly one `title_all` pattern or is excluded by `title_none`, grouped and counted (`--all` shows every title), and each search that came back at a site's cap, where a more specific `scout.search_terms` term would reach postings past it. Scan it with the user for wordings of their target titles. It never changes a setting by itself: for a real miss, propose a specific pattern change, name the titles it would let in, and show the changed `workspace.yaml` lines in full. Make it only on the user's OK, then re-run the scout, since the newly admitted postings arrive as new ones to screen. On a scheduled run, only report it.
5. **When a feed breaks,** read `feeds.md` next to this file before changing anything: its Known Quirks are already handled in `tools/scout.mjs`, so check those first.
6. **Closed postings:** each `[closed]` line is already handled. The run added the event `YYYY-MM-DD | expired | posting closed` to that posting.md and deleted its `jd.md`, keeping posting.md so the stats still count it. Name them in the report. `node <tools>/scout.mjs closed` shows each waiting posting's state without changing anything.
7. **Screen each posting** from its title, location, and date first. Load the description (`node <tools>/scout.mjs show <key>`) only when the title can't settle it. Drop it only when it breaks one of the **Dealbreakers** in the career direction file (at most five; `fit.mjs list` flags more, and only the first five apply), with `node <tools>/scout.mjs mark <key> dropped "<Dealbreaker name>: <short reason>"`. Start every drop reason with the dealbreaker's name exactly as the file writes it ("Wrong level: first-line manager"), so the Stats tab can count drops per dealbreaker. A posting that breaks none is kept, however it compares with postings the user passed on before. When a posting looks wrong for a reason no dealbreaker covers, keep it, say so in its triage note, and ask in the report whether that reason should become a dealbreaker. If the file has no Dealbreakers section yet, use these defaults and offer to write them in:
   - **Wrong role:** outside the target field or titles in `targets`.
   - **Wrong level:** outside `targets.titles` and the level range.
   - **Wrong place:** the place screen already dropped postings that are clearly elsewhere. What reaches you here can still break this: "Remote" with no country, only the country, or "Multiple locations" passes the screen for the description to settle, so check it for the country or office the role needs.

   Three more checks come from settings, not the Dealbreakers list, and drop with their own name as the reason's start:
   - **Stale:** posted more than `scout.stale_days` days ago (60 if unset), with the reason "Stale: posted <date>".
   - **Sponsorship, only when `targets.visa.needs_sponsorship` is true:** load every posting that passes the other screens with `node <tools>/scout.mjs show <key>`, and drop or keep it as `visa-and-pay.md` next to this file says.
   - **Pay, only when `targets.pay.min` is set:** `show` adds a "Pay check" line. Drop only when it says "drop", as `visa-and-pay.md` says, and never for a range that's only near the floor.
   - **Already in the workspace:** mark it `shortlisted`, set `scout_key` in its posting.md, and move on.
8. **Score and rank what's left.** Give each posting two scores (never blended into one):
   - **Role fit (1 to 5):** how well the user's record matches the role, judged against the default resume and portfolio.
   - **Preference fit:** rate each preference from the career direction file 1 to 5 from the posting, or `unknown` when the posting doesn't say (company signals such as stability are often unknown until `/apply` researches the company). Unknowns don't count against a posting.

   Rank by the lower of the two scores first, then the higher, then the newest posting, and take the top postings up to the cap. Mark each additional good one `held` with a reason, so it comes back next run while it's still listed. Shortlist fewer when fewer are worth the user's time. An empty week is fine.
9. **Shortlist** each pick:
   - Run `node <tools>/scout.mjs mark <key> shortlisted "<one line>"`.
   - Create `applications/<company-slug>/<YYYY-MM-DD>-<role-slug>/`, where the date is the shortlist date.
   - Run `node <tools>/scout.mjs capture <key> <folder>` to write `jd.md`.
   - Write `posting.md` from `<templates>/applications/posting-template.md`, filling the frontmatter (`source: scout`, `scout_key`, `why`, and `events: - YYYY-MM-DD | shortlisted`) and only the **Triage** section, in about 150 words: location and work mode, published pay, the level check (see the apply skill, two or three lookups), any dealbreaker signal, two or three fit points, and a one-line company snapshot. No `company.md` yet. That waits until the user is interested.
   - **Sponsorship, only with the visa module:** fill the Triage table's Sponsorship row, as `visa-and-pay.md` says.
   - **Scores:** run `node <tools>/fit.mjs set <folder> --role <1-5> <preference-key>=<1-5|unknown> ...` (keys from `fit.mjs list`, shortened while unique). It writes `role_fit`, each rating, and the computed `preference_fit` into posting.md. Put both scores and the ratings in the Triage table's Scores row, and let `why` name what drove them.
   - **Contacts, only if `connections.enabled` is true:** run `node <tools>/connections.mjs match <company>` and fill the Triage table's Contacts row with the count and the top one or two (name and title), or "none". It's display only, so it never changes a score or which postings make the cut (the `connections` skill).
10. **Update:** run `node <tools>/sheet.mjs prune --apply` (it archives postings that ended more than `sheet.history_days` ago without an application, whether or not the workspace has a sheet) and `node <tools>/tracker.mjs`, then sync the Google Sheet with the `sheet` skill if the workspace has one. That also refreshes the sheet's Scout Log tab, where the user can see every posting from the last two weeks that passed the first screen, with your call and reason.
11. **Report** in chat:
    - A table of the shortlist (company, role, location, pay, level, Role fit, Preference fit, why, plus contacts when the connections module is on).
    - The counts: fetched, screened, dropped, and held, with the drops per dealbreaker.
    - Any posting kept despite looking wrong for a reason no dealbreaker covers, with the question of whether that reason should become one.
    - With the visa module: the days left before the deadline (first line of the report), and how many postings were dropped for sponsorship.
    - With discovery on and a new month's thread up: the proposed employers (see Finding New Employers).
    - Anything closed, every feed warning and how it was handled, and the validation and title audit status.
    - The connections refresh nudge, if a script printed one (once per session, in one line).
    - **Waiting on the user:** the lines `node <tools>/next.mjs list --due` prints (overdue and due soon first, then decisions and applications left waiting), as they are. Skip the section when it prints that nothing is waiting.

    Then ask the user for a call on each shortlisted posting: **interested** or **pass**.
12. **The last-run line:** replace the one "Last scout run" line in the workspace's MEMORY.md (add it under Status if it isn't there) with the date, the counts from `node <tools>/scout.mjs runs 1`, and any warning that still needs a fix. Add nothing else about the run to MEMORY.md: the scout keeps its run history in `applications/data/scout-runs.csv`, and `node <tools>/scout.mjs runs [n]` prints the recent runs, with how each one's postings were screened, when the user asks how recent weeks went. What's waiting on the user comes from `next.mjs list` and the tracker's Needs Attention list, never from notes carried forward.

## After the Report

- **Interested:** hand off to `/apply` Stage 1, which adds the `interested` event and does the full fit analysis and the company quick check.
- **Pass:** add `YYYY-MM-DD | passed | <their reason>`, delete `jd.md`, and keep posting.md. The reason belongs to that posting only: never start dropping or down-ranking other postings for it. If it sounds like a general rule (for example "no consulting firms"), you may ask once whether to add it as a dealbreaker or preference, and change the career direction file only when the user says yes.
- **Tuning:** when the user says the screen is too loose or too tight, adjust `workspace.yaml` `scout.*` (the keyword screens), the Dealbreakers, or the Preferences, as they direct, and note the change in MEMORY.md. The Stats tab's Drops by dealbreaker or setting count shows which dealbreaker is cutting the most. The title audit (step 4) shows what the title patterns hide.

## Finding New Employers (discovery)

When `scout.discover` lists a source and a new month's thread is up, when the prompt asks for discovery, or when the user asks to find new employers, read `discovery.md` next to this file and follow it. Discovery only proposes: never contact an employer, and add one to the watchlist only on the user's OK.

## The Watchlist

`applications/watchlist.md` holds a table under `## Watchlist` with the columns Company, Source, Board, Why, and Domain. Domain groups employers by field (for example Fintech, Health, or Security), and the sheet's Employers tab can be filtered by it. A row whose Company starts with `~` is paused, and the scout skips it.

**Edit it with `node <tools>/watchlist.mjs`** rather than by hand, so the table and the sheet stay in step: `add "<Company>" --domain "<Domain>" --source <source> --board <board> --why "<reason>"`, `set "<Company>" --domain ...` (or `--source`, `--board`, `--why`), `pause`, `resume`, `remove`, and `list` (by domain). Pick the domain from the ones `list` shows, and make a new one only when nothing fits. The user can also edit the list in the sheet's Employers tab (new rows, Domain, and Status), and the next sheet sync brings those edits here (the `sheet` skill).

**To add an employer** (or find the feed for one the user added in the sheet), read `feeds.md` next to this file: the source table, with how to find and check each source's board, and the steps. Don't add a new source type without the user's OK.

## Scheduled Runs

To set up, change, or stop scheduled runs, read `scheduling.md` next to this file.

**When the prompt says it's a scheduled run,** no one is watching:
- Never ask a question or wait for an answer. Where a step says to ask, take the safe choice and list it in the report instead.
- Run the steps as usual: shortlisting is fine, since it only fills the user's review queue. Never apply, contact anyone, or add an employer to the watchlist. Discovery only proposes.
- Fix nothing that needs a judgment call (a broken feed, a new source type, a pause of many employers). Report it.
- If the Google Sheets connector isn't available, do every local step, skip the sync, and say so in the report.
- Replace the "Last scout run" line in MEMORY.md (step 12), add nothing else to it, and end with the run report. Desktop keeps the session, so the user reads it under Scheduled in the sidebar.
