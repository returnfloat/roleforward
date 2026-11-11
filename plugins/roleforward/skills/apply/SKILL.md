---
name: apply
description: Job application flow for the workspace owner. Use when they share a job posting (link or pasted text) to discuss fit, share a recruiter's message or describe a role someone told them about that has no posting yet, say they're interested in a shortlisted posting, want to apply, ask about a company's prospects or the team the role sits in, need application form answers, say they have applied or sent a resume (freeze it), say they applied somewhere outside this flow (log it), report a hiring-process update (a conversation, screen, interview, rejection, or offer), get an offer to weigh or negotiate, ask what's waiting on them or what to follow up on, or ask about their application stats.
---

# Apply Flow

## Working With the Workspace

- **The workspace** is the user's private career folder: the current folder, or the nearest parent with a `workspace.yaml`. Read `workspace.yaml` first. `person.name` is the user, `files.*` are their file names (default resume, portfolio, guide, career direction), and `targets.*` are their goals, locations, and optional pay floor. Their Dealbreakers and Preferences are in the career direction file (`node <tools>/fit.mjs list` prints both).
- **Their own instructions win, except on what drops or ranks a posting.** The workspace's `CLAUDE.md` and `MEMORY.md` hold standing instructions on how to work. Where they conflict with this skill, follow the workspace. But only the Dealbreakers, the Preferences, and the `workspace.yaml` settings judge a posting: a note in MEMORY.md, something said in chat, or a reason the user gave when passing on another posting never becomes a criterion unless the user says to add it to the career direction file.
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory (shown when the skill loads). Run them from the workspace root, for example `node <tools>/tracker.mjs`. Below, `<tools>` means that folder.
- **Statuses set in the sheet come first.** If the workspace has a sheet, pull its Shortlist status changes (the `sheet` skill's Sync, step 2) before reading a posting's stage.
- **Templates** for postings, company research, and the record format live in the plugin's `templates/applications/` folder, two levels above this skill's base directory (`<templates>` below). Read them from there: the workspace has no copies.
- **Record format and stages** are in the plugin's `<templates>/applications/README.md`. Read it first. The posting.md frontmatter is the only source of truth. After any change to one, run `node <tools>/tracker.mjs` (which also rebuilds INDEX.md), then sync the Google Sheet if the workspace has one (the `sheet` skill).

Keep every file scannable: a summary table first, then short evidence paragraphs (two to four sentences each), within each template's word budget.

Three principles run through every stage:

- **Reuse first.** Send an existing resume (a standing variant in `variants/`, or the default in `files.resume`) unless a one-off is clearly necessary. Per-job resumes are the exception, need the user's OK, and carry a written reason.
- **Track everything.** Every posting the user looks at gets a record, including the ones they pass on, so the numbers mean something.
- **Judge the company, not just the role.** Every application gets company research covering business health, moat, stability, and the team or function the role sits in, kept in `applications/<company-slug>/company.md`. At light depth (below), that research comes when an interview is scheduled, before the user invests in the process.
- **Setup trouble:** when a script fails in a way that points to setup, run `node <tools>/doctor.mjs`, which changes nothing, and fix what it calls a problem.

## Depth

`apply.depth` in `workspace.yaml` sets how much work each posting gets before the user applies. Unset means `full`.

| | `full` (a few high-stakes applications) | `light` (a steady volume of applications) |
|---|---|---|
| Stage 1 | Full fit analysis (about 550 words) and the company quick check | A short fit note (about 150 words), and no company.md unless the user asks or a red flag shows |
| Stage 2 | Full company research before applying | Skipped before applying. The quick check and full research run when a `recruiter-screen` or later event is logged, before interview prep |
| Stage 3 | Resume choice, answers.md, optional form fill | The same, with answers.md only when the form asks more than the profile covers |
| Freeze | The same at both depths | |

The user can ask for full depth on any one posting ("do the full research on this one"). Say which depth applies the first time in a session, so the user knows what to expect.

**The light fit note** fills posting.md's Triage table and bullets (location, pay, level, dealbreakers, both scores through `fit.mjs set`, and contacts if the connections module is on) plus the Resume section's Choice line. Do a level check only when the title doesn't settle the rung, in one or two lookups. End with the one-sentence recommendation, as in full depth.

Per-job material is exempt from the sync rule and never changes the default resume, the portfolio, LinkedIn, or the website. If a new fact comes up, add it to the portfolio first, with its tags.

## Stage 1: Fit (the user is interested in a posting)

This stage starts in one of two ways. Either the user says "interested" about a posting `/scout` shortlisted, or they bring one in themselves (a link or a recruiter message). See the queue lifecycle in `<templates>/applications/README.md`.

- **From the shortlist:** the folder, `jd.md`, and the Triage section already exist. Add the event `YYYY-MM-DD | interested`, then skip to step 2. Build the full analysis under the Triage section, and keep the Triage section.
- **Brought in by the user:** start at step 1. The record starts at `interested`, with no `shortlisted` event.
- **No posting at all** (a recruiter's message about a role that isn't posted, or a role a contact described): see Leads Without a Posting below instead.

1. **Capture the job description** into `jd.md`: frontmatter (`title: "Job Description: <title>"`, `company`, `location`, `team`, `compensation`, `published`, `url`, `captured`, `captured_via`), then the posting's plain text as the body, unedited except for escaping any `$` as `\$` in the body (never in the frontmatter, where it breaks the YAML) so Obsidian doesn't render dollar amounts as math. Postings get taken down, and interviewers quote them.
   - If the company is on the watchlist, run `node <tools>/scout.mjs` so the posting has a key, then `node <tools>/scout.mjs capture <key> <folder>`, which writes jd.md in the right format.
   - Otherwise try the public job-board APIs with curl first: Greenhouse `https://boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>` (`content` is HTML, so strip the tags), Lever `https://api.lever.co/v0/postings/<company>/<id>`, Ashby `https://api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true` (pick the job by id and use `descriptionPlain`). Many career pages also carry `application/ld+json` JobPosting data in the HTML.
   - For anything else, use a browser-automation skill if one is available to read the page text, or ask the user to paste it.
2. **Check for siblings:** if `applications/<company-slug>/` already has postings, read them and say so up front (see Same Company below).
3. **Create the record** from `<templates>/applications/posting-template.md`: `applications/<company-slug>/<YYYY-MM-DD>-<role-slug>/posting.md`, with `resume: tbd` and an `interested` event. Ask the user for `source`, `referral` (true or false), and `referrer` if they aren't clear from context.
4. **Write the fit analysis** in the template's shape, within its budget of about 550 words:
   - **Dealbreakers:** check each one in the career direction file's Dealbreakers list, plus the place settings in `workspace.yaml` (`targets.country`, `targets.places` with their nearby names, and `targets.remote`).
   - **Standalone settings,** separate from the Dealbreakers and Preferences: pay and sponsorship each come from their own setting in `workspace.yaml`, and neither changes a score. If a pay floor is set (`targets.pay.min`), note whether the published range reaches it, or how far below it falls. Otherwise pay targets aren't in any file, so ask the user rather than judge pay. With the visa module (`targets.visa.needs_sponsorship`), check sponsorship: run `node <tools>/visa.mjs check <folder>/jd.md` and `node <tools>/visa.mjs history <company>`, quote what the posting says, and if it says nothing, make "Does this role support visa sponsorship (and an H-1B transfer, if that's the user's status)?" the first recruiter question. With a deadline set, say the days left and whether the company's usual hiring time plausibly fits.
   - **Level check** (two or three lookups): map the posting's title to the company's ladder, then compare that rung to the user's baseline (`targets.level_baseline`, on `targets.level_track`). Use levels.fyi where it covers the field, and otherwise the company's own ladder, published pay bands, or public salary data. Record the rung, whether it manages managers (for leadership roles), and the market medians for both. Note any title step-down, since the next title goes on the resume and LinkedIn. Public market medians aren't the user's targets, so they can go in the file. Mark any mapping inferred from forums as (inferred) or (hearsay).
   - **Fit** as a strong and gap table, each row tied to a portfolio area.
   - **Scores:** rate both again from the full posting with `node <tools>/fit.mjs set <folder> --role <1-5> <preference-key>=<1-5|unknown> ...`, and say in one line what changed from the scout's scores and why.
   - **Resume choice** (see the ladder below), keyword coverage, and what to leave to a cover note.
   - **Referral paths, only if `connections.enabled` is true:** run `node <tools>/connections.mjs match <company>` and fill the template's Referral Paths section with the top matches (up to five), linked to their profiles, and a few words on why each ranks where it does. Skip the section when nobody matches. Contacts never change the recommendation. Draft a referral request only if the user asks (the `connections` skill), and pass on its refresh nudge if it printed one.
   - **Quick company check** (about 10 to 15 lookups): create `applications/<company-slug>/company.md` from `<templates>/applications/company-template.md` and fill only its Quick Check (table, evidence, red flags, recruiter questions), within about 550 words. Reuse what the job board already showed (posting date, related openings). The fit analysis links to company.md rather than repeating it. If `company.md` already has a check under 90 days old, reuse it and look only for news since.
5. **Talk it through.** Give a clear recommendation: apply, ask the recruiter first, or pass. Stop here until the user decides. If they pass, add a `passed` event with a one-line reason, delete `jd.md`, and keep posting.md.

## Leads Without a Posting

When a lead arrives with no job posting, read `leads.md` next to this file before doing anything else. In short: create the record with `node <tools>/lead.mjs`, which writes `lead.md` in place of `jd.md`, write a fit note from what's known with the unknowns marked, run the company quick check as usual, list the questions to ask with the dealbreaker questions first, skip the keyword check until there's a posting, log each conversation as an event, and freeze when the user says they sent a resume or applied formally.

## Resume Choice Ladder

Work down the ladder and stop at the first rung that works:

1. **The best existing resume.** Compare the default and each standing variant against the posting's must-haves and title. Pick the closest.
2. **Close gaps outside the resume.** Gaps that a cover note, a form answer, or a message to the recruiter or referrer can carry go there instead.
3. **Tailor, only if all of these hold:** the posting has a must-have or screen-deciding requirement, the user truthfully meets it (backed by a portfolio resume line), no existing resume shows it, and step 2 can't carry it. A title that differs from the headline isn't enough on its own, and neither is reordering for taste. Propose it, get the user's OK, then set `resume: tailored` and write the reason in `resume_reason`.
4. **Promote repeats.** Before tailoring, check earlier tailored postings (`grep -l "resume: tailored" applications/*/*/posting.md`). If the same change was made before, propose updating a standing variant, or adding a new one, instead of another one-off.

## Stages 2 and 3: Research and Prepare (the user wants to apply)

Read `prepare.md` next to this file before going further. Stage 2 is the full company research (at full depth before applying; at light depth when the first `recruiter-screen` or later event is logged, before interview prep), and the user confirms after it. Stage 3 prepares the application: the resume from the ladder above (a tailored one only after the user's OK), the ATS check, `answers.md`, and an optional form fill. Two rules hold throughout: leave salary blank and ask the user each time, writing a number in only if they say to, and never click Submit, since the user reviews and submits.

## Stage 4: Freeze (the user says they applied)

Freeze only on the user's explicit word that the application is submitted. Never infer it.

1. Confirm the folder, the resume that was sent, and the applied date (default today) in one line.
2. Run `node <tools>/freeze.mjs applications/<company>/<folder> [YYYY-MM-DD]`. For a reused resume, it copies the current PDF, .txt, and Markdown into the folder as the record of what went out. In all cases it adds the `applied` event, records sha256 hashes, makes the sent files plus answers.md and jd.md (or lead.md, for a lead with no job description) read-only, and rebuilds the tracker. It refuses if the PDF is older than its source.
3. Report that it's frozen, and mention anything in the tracker's Needs Attention list. With the Drive folder on (`drive.enabled`), say the user can drag the sent PDF (give its path) into their Drive folder, and offer the posting's packet as a Google Doc (the `sheet` skill's `drive.md`).
4. Set `next` to a follow-up, 14 days after the applied date by default (see Next Actions).

After freezing, never edit those files. A later need, such as a recruiter asking for an updated copy, gets a new event and, if a new resume is sent, a new posting folder. `node <tools>/freeze.mjs --check` confirms nothing frozen has changed. Run it before an interview so the user quotes exactly what they sent.

## Applications Made Elsewhere (a quick log)

When the user says they already applied somewhere without this flow (LinkedIn Easy Apply, a referral form, a career fair), log it so the stats stay complete. Don't run the stages after the fact.

1. **Confirm in one line:** the company, the exact role title, the date, the source, and which resume they sent (the default, a variant, or `other` for an older or outside file). Ask only for what isn't clear.
2. **Run** `node <tools>/log.mjs "<Company>" "<Role>" --date YYYY-MM-DD --source <source> [--resume <file>|other] [--url <link>] [--referrer "<Name>"]`. It creates the record with an `applied` event, reuses the company's folder if one exists, and refuses a duplicate. For a default or variant resume it freezes the record with the current render, so if they applied days ago and the resume has changed since, say the snapshot may not match what they sent.
3. **Capture the posting** into `jd.md` if there's a link and it's still up (Stage 1, step 1), since interviewers quote it.
   Then set `next` to a follow-up, 14 days after the applied date by default (see Next Actions).
4. **Sync** the sheet if the workspace has one. Several applications at once are fine: run the command once per application, then sync once.

## Next Actions

Every live posting can carry one next action in posting.md: `next: YYYY-MM-DD | <what happens next>`, where the date is when to act or check back. It keeps decisions waiting on the user, and follow-ups waiting on the employer, from getting lost in notes. The tracker's Needs Attention list shows each one that is overdue or due within 3 days.

- **Whenever an event is logged, set or clear `next` in the same step,** with `node <tools>/next.mjs set <folder> <YYYY-MM-DD> "<action>"` or `node <tools>/next.mjs clear <folder>`. Both change only that line and `updated`, and rebuild the tracker. Propose the default in one line, and the user can change the date or the action:

  | After | Default next action |
  |---|---|
  | `interested` | The date the user plans to apply (or decide) |
  | `conversation` | When the contact said they'd get back, or a check-back in 7 days |
  | `applied` | Follow up in 14 days |
  | `recruiter-screen`, `hiring-manager`, `interviews`, `final` | Today, a thank-you note, if the user wants one. Once it's sent (or skipped), a check-back in 7 days |
  | `offer` | The deadline to answer the offer |
  | an ending | Clear it |

- **A posting with no next action** is fine while it's moving. A shortlisted or interested posting left 7 days without one shows in Needs Attention as waiting on the user's decision, and an application quiet for 21 days shows unless a future `next` says the user is waiting on purpose.
- **What's waiting on the user:** `node <tools>/next.mjs list` prints one line per live posting: overdue first, then due soon, then later, then the ones with no next action, each with how long it has been in its stage.
- **Follow-up messages** (a thank-you note, a check-in, a nudge to a quiet recruiter) are drafted only when the user asks, for the user to send themselves. The plugin never contacts anyone.
- **An ended posting's `next` is ignored everywhere,** so an ending logged from the scout or the sheet never leaves an open item behind. Clearing it anyway keeps the file tidy.

## Stage 5: Updates and Analysis

- **Hiring-process news:** add an event (`YYYY-MM-DD | stage | note`) using the stages in `<templates>/applications/README.md`, bump `updated`, set or clear `next` (see Next Actions), then run `node <tools>/tracker.mjs`. If an application has gone quiet, its `next` follow-up comes due in Needs Attention: offer to draft the follow-up, and log `no-response` once the user calls it.
- **The first interview at light depth** (a `recruiter-screen` or later event on a posting without full research): run Stage 2 (`prepare.md`) before any interview prep, and for a quick-logged posting, write the light fit note too.
- **Interview prep** for a posting uses its frozen resume.md, jd.md (or lead.md, for a lead), and answers.md, plus the workspace's interview prep file (the `prep` skill builds one, and runs mock rounds in the loop's formats). Turn company.md's open questions into questions for each interviewer. After each real round, offer the prep skill's debrief.
- **When the recruiter answers** a question from company.md (for example, new role vs. backfill), record it there, replacing the inference with the answer and its date.
- **An offer:** read `offer.md` next to this file (the steps, not the posting's own offer.md) before going further. It covers recording the offer and its answer deadline, filling the posting's offer.md from `<templates>/applications/offer-template.md`, the offer-stage company research, comparing offers, preparing the negotiation, and what to do on `accepted` or `declined-offer`.
- **What's waiting on the user:** run `node <tools>/next.mjs list` and answer from it, overdue first.
- **Stats questions:** run `node <tools>/tracker.mjs`, then answer from `tracker.md`, or analyze `applications/data/*.csv` with a short Node script for anything deeper. Say when sample sizes are too small to read much into.

## Same Company, Multiple Roles

Most applicant systems keep one candidate profile per company, so a recruiter will likely see every application there.

- Each posting gets its own folder and record. Prefer different standing variants over one-offs here too.
- Facts, dates, titles, and numbers must be identical across the applications. Only emphasis and line selection differ. Compare the resumes and flag anything that reads as contradictory side by side.
- Add a `## Postings Here` section to `company.md` with the postings, the recruiter contact if any, and a one-line story that makes the applications make sense together. Ask the user whether to mention the other application in a cover note or to the recruiter.
- Note any limits the careers site states on concurrent applications.
