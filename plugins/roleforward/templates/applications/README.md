---
title: Applications (record format and tracker)
updated: YYYY-MM-DD
---

# Applications

One folder per posting, grouped by company, so two roles at the same company sit side by side. The flow (fit, resume choice, answers, freeze) is in the RoleForward plugin's `/apply` skill, and the weekly search is `/scout`.

```
applications/
  README.md                          this file: the record format
  tracker.md                         generated: funnel, breakdowns, needs-attention list, all postings
  data/applications.csv              generated: one row per posting, for analysis
  data/events.csv                    generated: one row per dated event, for time-in-stage analysis
  profile.md                         reusable form answers
  company-template.md                company research template (quick check, then full research)
  posting-template.md                posting record and fit analysis template
  <company-slug>/
    company.md                       company research (business, moat, stability, the team the role sits in), shared by its postings
    <YYYY-MM-DD>-<role-slug>/         date = when the posting was shortlisted, or brought in by the user
      posting.md                     the record (frontmatter) + fit analysis + tailoring log
      jd.md                          plain-text copy of the job description, captured at first look
      answers.md                     what was typed into the online form, as submitted
      resume.md, <stem>-Resume.pdf/.txt   what was sent (a snapshot copied at freeze, or the tailored one)
```

The posting.md frontmatter is the only source of truth. The tracker and CSVs are rebuilt from it with the plugin's `tools/tracker.mjs`, and are never edited by hand.

## Record Format (posting.md frontmatter)

```yaml
company: Example Corp
role: Senior Manager, Example Team      # the posting's exact title
track: leadership                       # the resume lean this posting fits, from the guide's variant leans (for example leadership, technical, balanced)
level: Senior Manager                   # the rung on the company's ladder, as the company names it (for example L5, Senior, Staff, Director)
work_mode: remote                       # remote | hybrid | onsite
location: Example City, ST
posting: https://...                    # the live link
jd: jd.md                               # the local text copy
comp_min: 240000
comp_max: 300000                        # published range only, never the user's targets
source: referral                        # scout | recruiter-inbound | referral | linkedin | company-site | job-board | network
referral: true                          # true | false (shows as a checkbox in Obsidian; a referral can come with any source)
referrer: First Last                    # who referred, if anyone
resume: variants/leadership.md          # <default resume> | variants/<name>.md | tailored | other (an older or outside file, set by log.mjs) | tbd
resume_reason: ""                       # required when resume is tailored: why no existing version fit
scout_key: greenhouse:example:123       # set by /scout: links the record to its seen.csv line and live feed
role_fit: 4                             # 1 to 5: how well the user's record matches the role (fit.mjs set --role)
preference_fit: 3.7                     # 1 to 5: the weighted average of the preference ratings below (fit.mjs computes it)
preferences:                            # one rating per preference in the career direction file: 1 to 5, or unknown
  work-location-and-office-days: 5
  a-stable-multi-year-home: unknown
why: "One line on why it's worth a look"   # shown in the Google Sheet
events:                                 # "YYYY-MM-DD | stage | optional note", in date order
  - 2026-10-03 | shortlisted
  - 2026-10-04 | interested
  - 2026-10-05 | applied
  - 2026-10-12 | recruiter-screen | 30 min with the recruiter
updated: 2026-10-12
```

The plugin's `tools/freeze.mjs` adds `frozen:` and `frozen_files:` (sha256 hashes) when the application is submitted. Don't edit those by hand.

## Stages

The current status is always the latest event, so there is no separate status field to keep in step.

- **Pipeline, in order:** `shortlisted`, `interested`, `applied`, `recruiter-screen`, `hiring-manager`, `interviews`, `final`, `offer`, `accepted`.
- **Endings:** `expired` (the posting closed before the user decided), `passed` (the user chose not to apply), `rejected`, `withdrawn`, `no-response` (log it after a follow-up goes unanswered), `declined-offer`.

## The Queue

Postings reach the user through a light lifecycle, so the workspace only holds what's worth their time:

| Stage | Set by | What's in the vault |
|---|---|---|
| seen | `/scout` | One line in `data/seen.csv` (decision `dropped`, `held`, or `shortlisted`). No files |
| shortlisted | `/scout`, up to the weekly cap | A folder with `jd.md` and a short posting.md (frontmatter plus Triage) |
| interested | the user, via `/apply` | The full fit analysis and the company quick check in `company.md` |
| passed or expired | the user, or the posting closing | `jd.md` is deleted, and posting.md stays so the stats count it |
| archived | `sheet.mjs prune`, once a posting that never reached an application ended more than `sheet.history_days` (30) days ago | The folder is deleted. One line in `data/archive.csv` keeps it in the stats. Anything that reached an application is never archived |

A posting the user brings in themselves (a link, or a recruiter message) starts at `interested`. The watchlist of employers `/scout` checks is `watchlist.md`.

Any event after `applied` other than `withdrawn` or `no-response` counts as a response. A rejection is still a response. The tracker flags anything active with no event for 21 days.

## Company Research (company.md)

Every company the user looks at gets a `company.md`, built from `company-template.md`. Its Quick Check (stability snapshot, the function's visibility, rules or funding that keep the function strong, and why the role is open) is filled before they decide. The full research is added once they decide to apply, before anything is submitted. Together they cover business health, moat and prospects, stability signals, the team the role sits in, red flags, and questions to ask, with every claim sourced and tagged. Its frontmatter scores (`stability`, `growth`, and the maturity field named in workspace.yaml `tracker.maturity_field`, 1 to 5) and `ownership` are joined onto each posting in the tracker and CSVs. The tracker flags active applications whose research is missing or more than 90 days old.

## Analysis

`tracker.md` covers the common questions: the funnel, and response and interview rates by referral, source, resume used, track, ownership type, Role fit, and Preference fit, plus how many postings each dealbreaker dropped. For anything deeper, open `data/applications.csv` in Numbers or Excel, or ask Claude to analyze the CSVs.
