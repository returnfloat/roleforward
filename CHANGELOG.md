# Changelog

Every RoleForward release, newest first. RoleForward follows [semantic versioning](https://semver.org): within a major version, your workspace's settings and files keep working as they are.

## 1.3.2

- **The sheet sync writes only the cells that changed:** the workspace keeps a copy of what each sync wrote, and `sheet.mjs patch` works out the changed cells from it, so a stage change on one posting writes and reads back a few cells instead of the whole tab. A patch first checks that the sheet's rows are still in the order the last sync wrote them, from columns the sync already reads (or one small read for the Scout Log and Stats), and a tab you sorted, or one where rows were added or removed by hand, is rewritten whole instead. The first sync after this update rewrites the tabs that changed, as before, to make that copy.

## 1.3.1

- **The Next column is never empty:** a live posting with no next action set now shows the usual next step for its stage, marked "(suggested)", in the sheet's Next column, the tracker's table, and `next.mjs list`. For example, a shortlisted posting shows a decision due a week after it was shortlisted, and an application shows a follow-up two weeks after you applied. A suggestion is display only: one you set replaces it, and only a set one quiets the "no update in 21 days" flag.

## 1.3.0

- **Leads without a posting (new):** a role someone describes to you, or a recruiter's message, gets a record through `lead.mjs`. A new `conversation` stage sits between `interested` and `applied`, and a `lead.md` records what was said about the role, by whom, what's still unknown, and the questions to ask, dealbreakers first.
- **Next actions (new):** each posting can carry a `next` date and action, set with `next.mjs` and proposed whenever a stage is logged. The tracker's Needs Attention list and the scout's report show what's overdue or due soon, and a decision left waiting a week is flagged. A next action set for a later date quiets the "no update in 21 days" flag.
- **A Next column on the sheet's Shortlist:** it sits after Last event. For a sheet made before this release, the next sync adds the column with `sheet.mjs upgrade`. This resets the Shortlist's color rules, so one you added yourself is listed for you first, and clears that tab's filter choices once.
- **The offer stage (new):** an `offer.md` for the terms, the answer deadline, promises made in conversation and whether the written offer includes them, a comparison with your Preferences and current role, and a negotiation plan. Pay figures stay out of the file unless you say to save them. The tracker flags an offer with no `offer.md`.
- **Title screen audit (new):** `scout.mjs audit` shows the titles the keyword screen nearly let through (one `title_all` pattern short, or excluded by `title_none`), collapsed and counted, and the searches that hit a site's cap. Each run saves its postings for it, and the run and the doctor say when it's due: monthly, or after a title pattern change.
- **The scout keeps its own run history:** one line per run in `applications/data/scout-runs.csv`, shown with `scout.mjs runs`. A run no longer adds a report to `MEMORY.md`. It keeps one "Last scout run" line there up to date, and older run reports can be removed.
- **A smaller sheet sync:** a routine sync reads only the columns you can edit and rewrites only the tabs that changed, so when nothing changed it writes nothing. Checking the sheet for hand edits outside those columns now runs when you ask.
- **The skills load less on everyday tasks:** setup, discovery, scheduling, feed help, application preparation, and new-workspace onboarding moved into files read only when needed.
- **Closure checks cover postings in conversation,** and a lead with no posting link is never expired.
- **Search caps described correctly:** onboarding said every searchable site returns the newest 200 postings per term. The caps run from 200 to 1,000 by job system, as the README's Job Sources table lists.

## 1.2.1

- **Pay written as "between $X and $Y" is read:** a posting that gave its range as "between $272,000 USD and $408,000 USD" showed as "Pay: not published", so a pay floor could drop it (with `unlisted: drop`) or miss that it pays too little. A range in another currency beside it, such as CAD, is still left out, and "between X and Y" without a $ or USD isn't taken for pay.

## 1.2.0

- **A Drive folder (optional):** the tracking sheet can live in a Google Drive folder, with an Archive folder inside it. On request, the folder holds Google Docs to read in a browser or on a phone: your interview prep, and a packet for any posting you're interested in or have applied to (the fit analysis, the company's bottom line and interview questions, your form answers without voluntary self-identification, the posting's prep plan, and the text of the resume you sent). Docs are made only when you ask, through Drive's Markdown import. A fresh copy replaces the old one, a packet moves to Archive when its posting ends, and the sheet links each packet from its posting's role. `docs.mjs` builds them.

## 1.1.0

- **ATS check (new):** `ats.mjs` reads a resume's PDF the way an applicant tracking system's parser does, then checks the posting's terms against it. The parsing checks cover the text layer, the contact line, section headings, characters a parser can mangle, and whether every line of the plain-text copy comes through as written. The keyword check takes required and preferred terms from a `keywords.md` in the posting folder, and prints each match with its context. `/apply` runs it before you apply, and suggests only changes your portfolio backs.
- **Resume PDFs read cleanly to parsers:** each job's title, place, and dates are now one line of text ("Title · Place · Dates"); before, a parser read the title and place run together. Ligatures are off, so words such as "certified" no longer hold a single "fi" glyph a parser can misread. The website shows role lines the same way.
- **Sheet sync keeps changes made in the workspace:** each sync records what it wrote, and the next sync counts a cell as your edit only when it differs from that record. Before, a stage, a reason, or a watchlist change made in the workspace since the last sync could be read as an edit in the sheet and undone.

## 1.0.0

The first release.

- **Career record and resume:** a portfolio with a source tag on every fact, a reviewed resume, standing variants, LinkedIn copy, and a PDF, plain-text, and website render.
- **Job scout:** a watchlist of employers across Greenhouse, Ashby, Lever, Workday, SAP SuccessFactors, Oracle Recruiting Cloud, iCIMS, TalentBrew, Eightfold, SmartRecruiters, Amazon, Google, Apple, and any careers site with a job sitemap; a place screen for up to three places in one country, with remote roles; your Dealbreakers and up to five weighted Preferences, with two scores per posting; feed health checks and monthly validation; a check of each posting waiting on your decision; and optional discovery of new employers from Hacker News.
- **Applications:** a fit analysis, a resume choice, cited company research, form answers, and a frozen record of what you sent.
- **Tracking:** a generated tracker, CSV data, and an optional Google Sheet with a shortlist, pipeline, employers, and stats.
- **Interview prep:** prep notes, practice rounds with spaced review, and a learning path from free resources.
- **Optional modules:** LinkedIn connections, visa sponsorship, a personal website, and scheduled runs in Claude Code Desktop.
- **Setup and upkeep:** onboarding for any field, and a doctor that checks the workspace.
- Runs on macOS, Windows, and Linux.
