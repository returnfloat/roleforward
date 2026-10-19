---
title: "Company: Role (fit analysis)"
company:
role:
track:
level:
work_mode:
location:
posting:
jd: jd.md
comp_min:
comp_max:
source:
referral: false
referrer:
resume: tbd
resume_reason:
scout_key:
role_fit:
preference_fit:
why: ""
events:
  - YYYY-MM-DD | shortlisted
updated: YYYY-MM-DD
---

<!-- Template for applications/<company-slug>/<YYYY-MM-DD>-<role-slug>/posting.md. Field values are in applications/README.md.
     Two layers. /scout writes the frontmatter and the Triage section only (about 150 words) when it shortlists.
     /apply adds everything from The Posting down once the user marks it interested.
     Length budget for the full analysis: about 550 words. Tables for scanning, then short narrative (two to four sentences per item) under
     Fit in Detail. Company findings live in ../company.md; link them here, don't repeat them.
     Fit rows cite the portfolio area or line, and use only facts and numbers from portfolio resume lines.
     Skip any section that has nothing to say. -->

# Company: Role

## Triage

| | |
|---|---|
| Location | City, work mode, and whether it fits the places in workspace.yaml (`targets.places`, or remote in `targets.country`) |
| Pay | Published range, or "not published". With a pay floor set, the pay check line from `scout.mjs show` |
| Level | Rung vs. the user's current level (see the level check in the apply skill) |
| Dealbreakers | Any signal from the description for a dealbreaker in the career direction file, or "none mentioned" |
| Scores | Role fit and Preference fit (fit.mjs), with each preference's rating in one line, for example "Location 5, Office days 3, Stability unknown" |
| Sponsorship | Only with the visa module: what the posting says about sponsorship, and the employer's H-1B record (visa.mjs) |
| Contacts | Only with the connections module: how many LinkedIn connections work there, and the top one or two, or "none" |

- **Why it's here:** two or three fit points tied to portfolio areas.
- **Watch out for:** the main gap or risk.
- **Company:** one line (public or private, size, any recent layoffs).

**Recommendation:** one sentence: apply, ask first, or pass, and why. Company: see [company.md](../company.md).

## The Posting

| | |
|---|---|
| Team and boss | |
| Location | |
| Published comp | |
| Scope | |
| Must-haves | |
| Nice-to-haves | |

## Dealbreakers

- **Location:** ok, or the question to ask
- **Each dealbreaker in the career direction file:** ok, or the question to ask
- **Level:** the rung on the company's ladder vs. the user's baseline, with market medians for both, and any title step-down

## Fit

| Strong | Gap |
|---|---|
| short phrase (portfolio area) | short phrase |

### Fit in Detail

- **Strongest case:** the two or three things that make the user credible for this specific role, and why they map to the posting's words.
- **Biggest gaps and how to handle them:** for each gap, whether it's a screen-out risk, and the honest answer or adjacent experience.
- **How the role would use the user:** what the first year likely looks like, and whether that plays to their strengths and career direction.

## Referral Paths

Only with the connections module, and only when someone matches. Display only: it never changes the recommendation.

| Connection | Title | Why |
|---|---|---|
| [Full Name](profile link) | their title | same field, recruiting, or other; connected since YYYY |

## Resume

- **Choice:** which existing resume, and why (see the ladder in the apply skill), in two or three sentences
- **Keyword coverage:** about N%. Misses: short list
- **Gaps for a cover note or form answers:** short list
- **Do not claim:** short list

## Tailoring Log

Only if `resume: tailored`. One line per accepted change.
