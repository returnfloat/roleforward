# Changelog

Every RoleForward release, newest first. RoleForward follows [semantic versioning](https://semver.org): within a major version, your workspace's settings and files keep working as they are.

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
