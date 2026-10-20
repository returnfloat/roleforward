# RoleForward

Move your career forward, one role at a time.

RoleForward is a private career workspace for [Claude Code](https://claude.com/claude-code). It keeps a sourced record of your work and builds everything else from it: a reviewed resume, LinkedIn copy, a weekly job scout across the employers you choose, application tracking with a Google Sheet, company research, interview prep, an optional check of who you know at each company, and an optional personal website. It adapts to any field.

The plugin is the engine. Your data lives in your own career workspace folder on your computer, never inside the plugin.

## Requirements

- Claude Code.
- Node.js 18 or later. Check with `node --version`. No npm packages are needed.
- macOS, Windows, or Linux, with Google Chrome, Chromium, Microsoft Edge, or Brave for rendering PDFs. RoleForward finds the browser on its own.
- Optional: Google Sheets and Google Drive connected in Claude, for the tracking sheet.

## Install

In Claude Code, add this repository as a plugin marketplace and install the plugin:

```
/plugin marketplace add returnfloat/roleforward
/plugin install roleforward@roleforward
```

From a downloaded or unzipped copy, use the folder path instead, for example `/plugin marketplace add ~/Documents/roleforward`. Keep that folder, because Claude Code installs from it. Restart Claude Code if the skills don't show up right away.

## Get Started

1. Make an empty folder for your career data, for example `~/Documents/My-Career-Workspace`.
2. Open Claude Code in it (`cd` into the folder, then run `claude`).
3. Type `/onboard`, or just say "onboard me".

After that, ask in plain words:

- "Run the scout" finds new postings and shortlists a few.
- "I'm interested in the second one" checks your fit and helps you apply.
- "Add this project to my portfolio" records new work.
- "Change this resume line" updates it everywhere and re-renders the PDF.
- "Sync the sheet" picks up anything you changed in the Google Sheet.

- "Who do I know at this company?" checks your LinkedIn connections, if you turned that module on.

The skills also appear as `/roleforward:scout`, `/roleforward:apply`, and so on.

## What It Does

### Career Record and Resume (`/resume`)

- **One source of facts:** a portfolio, built with you during onboarding from your old resume, LinkedIn export, or reviews and a short interview. Every number in it carries a source tag (verified, from a document, self-reported, or secondhand) and a scope tag (your own work, a team you led, or an organization-wide result), and its disclosure rules say what must stay private, such as internal project or client names. No number reaches a resume unless it's in the portfolio.
- **A reviewed default resume,** drafted with you and checked against a house style guide and audit rubric. Every bullet is proven by a number when there's an honest one, and by concrete evidence (scale, adoption, what shipped) when there isn't. Nothing is estimated to fill a formula.
- **Sections that fit your field:** a Summary or none, Core Competencies or Skills, and Projects, Publications, or Open Source sections, which appear in the PDF, the plain-text copy, and the website.
- **Rendering:** an application PDF (with phone and email), a plain-text copy for pasting into application forms, and a page-count check. The PDF is built for resume parsers: one column of real text, each job's title, place, and dates on one line, and no ligatures (single glyphs for letter pairs such as "fi", which a parser can misread).
- **Standing variants,** such as leadership and technical versions, kept in step with the default when facts change.
- **LinkedIn copy** in first person, kept consistent with the resume.
- **One change, everywhere:** a fact or wording change goes to the resume, portfolio, LinkedIn copy, variants, website, and sheet in one pass.

### Job Scout (`/scout`)

- **Your watchlist:** searches the public career sites of the employers you list, plus any you approve from discovery (below). It never signs in, applies, or contacts anyone.
- **A watchlist you manage:** ask to add, pause, or remove an employer, and the scout finds which job system its careers page uses. Employers are grouped by domain (such as Fintech or Health), and you can also edit the list in the sheet's Employers tab.
- **Supported job systems:** Greenhouse, Ashby, Lever, Workday, SAP SuccessFactors, Oracle Recruiting Cloud, iCIMS, TalentBrew, Eightfold, and SmartRecruiters, which many employers share, plus the career sites of Amazon, Google, and Apple. Each has known limits, listed under [Job Sources](#job-sources).
- **A fallback for everything else:** for any other employer, the scout reads the careers site's job sitemap or a careers page that lists its jobs as plain links, and it honors the site's robots.txt. A site that builds its job list with JavaScript and has no job sitemap stays on the watchlist as a manual reminder to check it yourself.
- **Two-step screening:** a keyword screen on title and location, then a judgment call against your **Dealbreakers**, at most five (for example wrong role, wrong level, or wrong place). Only your dealbreakers, plus three settings (how old a posting can be, an optional pay floor, and visa sponsorship), drop a posting. A reason you give when passing on one posting stays with that posting and never becomes a rule unless you say so. The sheet's Stats tab counts how many postings each dealbreaker dropped, so an over-eager rule is easy to spot.
- **Where you can work:** one place by default, or up to three in one country, each with the nearby towns postings use for it (for example Denver with Boulder and Aurora), and whether remote roles anywhere in your country count. A built-in place list, built from Natural Earth's public-domain data, tells which country a city or region is in, so "Remote, US" passes while a remote role in London or "EMEA" doesn't. A matching title that's remote only in another country is dropped but listed in the sheet's Scout Log, so you can check the country call.
- **Two scores, never blended:** every shortlisted posting gets a **Role fit** (how well your record matches the role) and a **Preference fit** (how well the role matches up to five weighted preferences you choose, such as office days, a stable multi-year home, or hands-on versus strategic work). The shortlist ranks by the lower of the two, so a role that's strong on both comes first. Onboarding shows a menu of example preferences to pick from.
- **Optional pay floor,** its own setting, off by default and recommended off. If you give a minimum (or your current pay) during onboarding, a posting is dropped only when the top of its published range is more than 10% below it (adjustable), so near misses still show up with a note. Hourly ranges count at 40 hours a week. Pay never changes a score, and you choose whether postings that publish no pay are kept or dropped.
- **A shortlist at your pace:** up to 10 a run by default, fewer for a few careful moves, or 10 to 20 at a daily cadence for a steady search, where applying early matters. Each posting gets a brief triage note: location, published pay, level check, and both scores. How old a posting can be is a setting too.
- **Finding employers you don't know yet (optional):** each month, the scout reads Hacker News's "Who is hiring?" thread through its public API, screens the posts the same way, and proposes the new employers that fit, with their job boards already found. Nothing joins your watchlist without your OK, and a skipped employer isn't proposed again. A board finder checks Greenhouse, Ashby, Lever, and the employer's careers page for any company you name.
- **Feed health checks** on every run, so a broken feed never passes for a quiet week (a job site in planned maintenance is named as such, with the employers it skipped), plus a monthly end-to-end validation.
- **Closed postings** are noticed and marked expired. Every posting waiting on your decision is checked on its own each run, through the job's own page, so one that a search simply stops listing is never mistaken for closed. One that stays unclear for three runs is flagged for you to open.
- **Scheduled runs (optional):** a weekly scout, a daily sheet sync, and monthly discovery can run on their own as Claude Code Desktop scheduled tasks, in your workspace folder at the times you choose, while the Desktop app is open. Nothing is installed on your computer. All are off by default. Turn them on during onboarding or later. A run with no one watching never asks a question, applies, or contacts anyone, and you read its report in Desktop.

### Applications (`/apply`)

`/apply` helps you apply. It never applies for you. It prepares everything an application needs, stops for your decision at each step, and leaves the submitting to you. Bring it any posting: one from the scout's shortlist, a link you found, or a recruiter's message.

- **Two depths:** `light` (the default for new workspaces) gives each posting a short fit note and saves full company research for when an interview is scheduled, so a steady stream of applications stays quick. `full` researches every company before you apply, for a few high-stakes moves.
- **Fit analysis** against your record, with a level check that compares the posting's title to your current level (on levels.fyi where it covers your field, or the company's own ladder and published pay bands). It ends with a recommendation: apply, ask the recruiter first, or pass.
- **Company research** in two passes, with every claim cited: a quick check (stability, how mature your function is there, why the role is open), then full research from primary sources. At full depth both come before you apply, and at light depth they come when an interview is scheduled.
- **Resume choice:** reuse the default or a standing variant first. A tailored resume needs a written reason and your OK.
- **ATS check:** before you apply, the resume's PDF is read the way an applicant tracking system's parser reads it, and checked against the posting's required and preferred terms. You see what a parser would misread, each term found with its context, and each one missing. Only missing terms your portfolio truthfully backs are suggested as changes.
- **Form answers** drafted from your record and the company research. Salary questions are left for you. If you ask, it can fill the form in Chrome, but Submit is never clicked for you.
- **Freezing:** once you say you've applied, the exact resume and answers you sent are kept, with file hashes, so you quote what you actually sent in interviews.
- **Applied somewhere else?** Say so ("I applied to Acme through Easy Apply"), and one command logs it, with the resume you sent, so your stats stay complete.
- **After you apply:** log recruiter screens, interviews, rejections, and offers as they happen. It suggests follow-ups when an application goes quiet, preps you for each interview, and refreshes the company research before an offer decision.
- **Tracking** from shortlist to offer: every stage is a dated event, and a generated tracker shows what needs attention, the funnel, response rates and times, and breakdowns by referral, source, resume, and track, with CSVs for your own analysis. The same numbers appear on the sheet's Stats tab.

### Tracking Sheet (`/sheet`)

A Google Sheet that mirrors your search, in two colors you choose during onboarding:

- **Shortlist:** roles judged a good fit, with Role fit and Preference fit side by side, and your LinkedIn connections at each company when the connections module is on. Its **Status** column is a dropdown. Pick `passed` (or any stage), and the next sync records it in your workspace. Referral stays blank until you mark a role interested, when you're asked.
- **Scout Log:** every posting that passed the first screen in the last 14 days, with the scout's call and reason, so you can see what was dropped and why.
- **History:** postings that ended in the last 30 days, plus every role you applied to, which stays for good, with the same Contacts column. Its **Reason** column is yours to edit, which helps tune the scout.
- **Stats:** the tracker's numbers: a summary, the funnel from application to offer, and response rates broken down by referral, source, resume, track, and company type.
- **Employers:** every employer you know in one table: the scout's watchlist with each one's domain, status, and how many postings it has produced, next to your research scores and verdicts. Type a new row to add an employer, change Domain to regroup it, or set Status to paused or not watched. The next sync updates the watchlist and finds the new employer's job feed.
- **Career:** your roles, with dates and durations.

Every tab can be sorted and filtered from its header row. A sort lasts until the next sync, which puts rows back in the default order, and your filters stay.

**A Drive folder (optional):** the sheet can live in a Google Drive folder of its own. Ask for a posting's packet (its fit analysis, the company's bottom line and interview questions, your form answers, and its prep plan) or your interview prep, and it appears there as a Google Doc to read in a browser or on your phone, and the sheet links each packet from its posting. Docs are made only when you ask, since each one passes through Claude in full (about 12,000 tokens for a typical packet). A fresh copy replaces the old one, and a posting's packet moves to an Archive folder when the posting ends. Voluntary self-identification answers never leave your workspace.

Edits go both ways safely: each sync records what it wrote, so only a cell you actually changed counts as your edit, and a change made in the workspace since the last sync is never undone by an older value in the sheet.

The two windows are settings in `workspace.yaml`: `scout_log_days` (14) for the Scout Log, and `history_days` (30) for History. When a posting you never applied to leaves History, its folder is removed from your workspace too, so files don't pile up, and one line in an archive file keeps it in your stats. The scout keeps one line per posting it has screened, so it never shows you the same posting twice.

### LinkedIn Connections (`/connections`, optional)

- **Who you know there:** for every posting on your shortlist or in your history, the 1st-degree LinkedIn connections who work at that company, as possible referral paths. Your own field comes first, then recruiters, then everyone else.
- **From LinkedIn's own export:** you download your data archive from LinkedIn and hand it over. Only its `Connections.csv` is read, and the plugin keeps each connection's full name, company, title, profile link, and connected-on date. Email addresses are dropped.
- **Never your messages:** messages, message counts, invitations, and everything else in the archive are never opened, and the plugin never signs in to LinkedIn or automates it.
- **Shows up where you decide:** a Contacts line in the scout's triage notes, a Referral Paths section in each fit analysis, and a Contacts column on the sheet's Shortlist and History tabs. It's display only and never changes a fit score or the shortlist.
- **Company names that differ,** such as a parent and its brands, can be listed as aliases. Similar names are shown for you to confirm, never counted on their own.
- **A gentle nudge** to download a fresh export once yours is more than a month old, since people change jobs.
- **Never contacts anyone.** It drafts a referral request only when you ask, for you to send.
- **Off by default.** Turn it on during onboarding or any time later, and turn it off to delete the imported connections.

### Visa Sponsorship (optional)

For anyone who needs an employer to sponsor a work visa. Turn it on during onboarding, or by setting `targets.visa` in `workspace.yaml`.

- **Reads each posting's words:** the scout drops postings that say they won't sponsor, or that require citizenship or a security clearance, and quotes the sentence so you can check it. Postings that say nothing are kept.
- **Each employer's record:** new and continuing H-1B approvals from USCIS's public H-1B Employer Data Hub, shown in the scout's triage notes and the fit analysis. Exact filing names are counted, similar names are shown for you to confirm, and subsidiaries can be added as aliases.
- **A countdown,** if your status runs out on a date (after a layoff, say): days left at the top of every scout run and the tracker.
- **Your status stays private** in your workspace. The data comes from a one-time download of about 7 MB from uscis.gov, and newer years can be added from the hub's own export.

### Interview Prep (`/prep`)

- **A learning path** for your field and target roles, built only from free resources whose links are checked.
- **"Be ready to say" lines** tied to your own record, a story bank, and practice prompts.
- **Mock interviews in the format you'll face:** coding, system design, ML design, SQL and analytics, product sense, execution, behavioral, leadership, scenario (the situational questions nursing, teaching, and many other fields use), case, and portfolio review. Claude plays the interviewer, keeps the time box, asks the follow-ups, and scores each round against a rubric calibrated to your target level.
- **Spaced review of weak spots:** every round is logged, and a topic you struggled with comes back in a day or two, with a new problem, while strong ones come back in weeks. A trend per format shows when you're ready.
- **Take-home coaching** within the company's rules on AI help: scoping, recruiter questions, a time plan, and a review before you submit. The work stays yours.
- **Debriefs after real rounds:** the questions asked, weak answers turned into practice topics, and prep for the next round.
- **Prep for a specific interview,** using the frozen resume, job description, and company research for that posting.

### Personal Website (`/website`, optional)

- **A one-page site** built from your default resume, with no phone or email in the page text, and optional LinkedIn and GitHub buttons.
- **Found by search engines:** structured profile data built from your settings, with your title and location, plus your employer, schools, and areas of expertise if you add them.
- **A guided design round:** a few preference questions, three layouts, color palettes, and preview screenshots.
- **Guided hosting setup:** whether to go live now, a domain or a free address, a choice of static hosts with rough costs, the first deploy, and DNS. No particular host is assumed.
- **Hosting changes are yours to approve.** Nothing is deployed and no hosting is changed without your OK.

### Setup and Upkeep (`/onboard`)

- **New:** an interview about your goals and limits, intake of an old resume or LinkedIn export, your portfolio, a line-by-line resume review, your job-search screens and watchlist, and your colors. It can span several sittings, and your progress is saved.
- **Adjust:** changes one part of a working workspace, such as targets, screens, modules, or scheduled runs.

### Throughout

- **Plain Markdown,** readable in any editor, and it opens as an Obsidian vault.
- **A generated index** (`INDEX.md`) that links every note and file in the workspace.
- **A setup check:** ask Claude to "run the doctor" (`tools/doctor.mjs`). It checks Node, the browser, every setting in `workspace.yaml` (catching typos, wrong types, and leftover placeholders), the files it names, your Dealbreakers and Preferences, and the watchlist, and changes nothing.
- **Always current with the plugin:** the record format and the posting, company, and website templates are read from the plugin, never copied into your workspace, so an update reaches them at once. Your `CLAUDE.md` and `MEMORY.md` are yours, and the plugin never overwrites them.
- **Your workspace's own instructions win** on how Claude works: its `CLAUDE.md` and `MEMORY.md` override the plugin's defaults. What drops or ranks a posting comes only from your Dealbreakers, Preferences, and settings, so a stray note can't quietly hide postings.

## Job Sources

The scout reads each job system the way that system's own careers pages do, so what it can see differs by system.

| Job system | What one search covers |
|---|---|
| Greenhouse, Ashby, Lever | Every open posting on the board |
| Workday, Oracle Recruiting Cloud, SAP SuccessFactors | The first 200 results per search term |
| Eightfold | The newest 300 results per search term (on Eightfold's newer sites, the United States only) |
| iCIMS | The first 500 results per search term |
| SmartRecruiters, TalentBrew | The first 1,000 results per search term |
| Amazon | The newest 1,000 United States postings per search term |
| Google, Apple | The first 10 pages of results per search term (Apple: the United States only) |
| Any other careers site | Its job sitemap, or a careers page that lists its jobs as plain links, with the place read from up to 40 job pages per run |

**Known limits:**
- **Fixed caps:** a search stops at the numbers above, so for a very large employer, use specific search terms. A shortlisted posting is still checked on its own page every run, so one past the cap is never mistaken for closed.
- **Rate limits:** some Eightfold sites, Microsoft's among them, refuse fast paging. The scout paces its pages and waits when asked. If a site still refuses, the run keeps the postings it already has, newest first, and reports the feed as partial.
- **Posting dates:** TalentBrew and Google search results don't show when a job was posted, so the age limit applies to them only when the job page shows a date.
- **Planned maintenance:** Workday sites often go down for maintenance on weekends. The run names the employers it skipped, so re-run later.
- **Sites the scout can't read:** a careers site that builds its job list with JavaScript and has no job sitemap (Meta's, for example), or that blocks automated requests, stays on your watchlist as a reminder to check by hand. Sites that need a login are never read, and neither are LinkedIn or other job boards that forbid automated access.

## Versions

RoleForward follows [semantic versioning](https://semver.org). Within a major version (1.x), every update keeps your workspace's settings and files working as they are. A change that would need them converted comes only in a new major version, together with a step that converts them for you. What changed in each version is in the [changelog](https://github.com/returnfloat/roleforward/blob/main/CHANGELOG.md).

## Updating

Run `/plugin marketplace update roleforward`, then update the plugin from `/plugin`, and restart Claude Code. For a downloaded copy, replace the folder with the new one first. Your workspace's own README is a copy of this one, refreshed on every tracker run, and its first line shows the installed plugin version next to the version your workspace was last brought up to date with. When they differ, ask Claude to bring the workspace up to date (`/onboard`), which sets `workspace_version` in `workspace.yaml` and runs the doctor when it's done.

## Privacy

Your career workspace is a folder on your computer, and everything RoleForward writes stays in it. The plugin has no server, no account, and no telemetry.

**What leaves your computer, and only when you use the feature:**
- **Claude:** like any Claude Code session, the files Claude reads while working with you are sent to Anthropic under your Claude plan's terms.
- **Employers' career sites:** the scout requests public job listings and job pages from the employers on your watchlist. Nothing is submitted, and it never signs in.
- **Hacker News** (optional discovery): the monthly "Who is hiring?" thread, through its public API.
- **USCIS** (optional visa module): the public H-1B Employer Data Hub files, downloaded once.
- **Your own Google Sheet and Drive folder** (optional): written through the Google connectors you connect to Claude. Docs appear in the folder only when you ask for one.
- **Your website host** (optional): only when you choose to publish your site.

**What stays private:**
- Pay screening is off unless you turn it on. Without it, no pay target is written to a file: the plugin shows each posting's published range and compares the role's level with yours, and you judge the pay. Salary questions on a form are answered with you, one application at a time.
- The optional connections module reads only the connections file from your LinkedIn data export, never your messages or any other file in it, and keeps the result in your workspace. Names and titles appear in your Google Sheet only if you turn it on. Turning it off deletes the imported connections.

## Job-Site Etiquette

- The scout uses each job system's public listings: the job-board APIs employers publish for their own careers pages, or a site's job sitemap. It never signs in, never applies, and never contacts anyone.
- It names itself (`roleforward-scout`) in every request, paces its paging, waits when a site asks it to slow down, and stops at a fixed number of the newest postings per search.
- The fallback reader honors each site's robots.txt, and sites that block automated requests stay on your watchlist as reminders to check by hand.
- LinkedIn is never read or automated. Its terms forbid it, so the connections module uses the data export LinkedIn gives you instead.
- You're responsible for following each site's terms of use.

## Disclaimer

RoleForward helps you organize your own job search. It isn't career, legal, financial, or immigration advice, and the visa module's sponsorship data is public government data that can be incomplete or out of date. Check anything that matters with the employer, or with a qualified professional.

## Contributing

See [CONTRIBUTING.md](https://github.com/returnfloat/roleforward/blob/main/CONTRIBUTING.md) for the layout, the tests, and adding a job source.

## License

MIT. See [LICENSE](LICENSE).
