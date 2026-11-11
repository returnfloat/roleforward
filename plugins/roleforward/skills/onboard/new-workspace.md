# Onboarding a New Workspace

The onboard skill's New mode: the full onboarding for a folder with no `workspace.yaml`. The skill's Ground Rules hold throughout. `<tools>` and `<templates>` are the plugin's `tools/` and `templates/` folders.

## 1. Check the Basics

- **Requirements:** run `node <tools>/doctor.mjs` before anything else. Outside a workspace it checks Node (18 or later) and a browser for the PDFs (Chrome, Chromium, Edge, or Brave, found on macOS, Windows, and Linux, or named in `render.chrome`). If either is a problem, say what's needed and stop until the person has it. Don't install it for them without asking.
- **Copy the templates:** copy everything in `<templates>` into the workspace, except the files the plugin keeps for itself: `site-template.html` (the website reads it from the plugin), and `applications/README.md` and the `applications/*-template.md` files (the posting, company, lead, and offer templates: the skills read them from the plugin, so a plugin update reaches them). The workspace's `README.md` is copied from the plugin by the first tracker run, so don't write one. Set `workspace_version` in workspace.yaml to the plugin's version (in its `.claude-plugin/plugin.json`). Rename `portfolio.md` and `resume.md` if the person prefers names like `<first>-portfolio.md` and `<first>-resume.md`, and record the names under `files` in workspace.yaml. When the person declines an optional module later (LinkedIn in step 7, interview prep in step 9), delete its copied file and comment out its `files` entry, so the index doesn't list it as missing.
- **Name the person:** fill `person.name`, `person.file_stem` (for example `Jane-Doe`, used in the PDF names), and `person.pronouns` if they offer them. Replace `<Name>` throughout the copied files.

## 2. The Interview: Goals and Constraints

Cover these, in roughly this order, and write the answers into the career direction file (`files.direction`) and workspace.yaml `targets` as you go. In workspace.yaml's inline lists, quote any item that contains a comma (`["Director, SAP GRC", GRC Lead]`), or it splits in two:

1. **Where they are now:** current title, employer, field, and years in it. This sets `targets.field` and `targets.level_baseline`.
2. **Where they want to go:** target titles and level, and whether they want to lead people, stay an individual contributor, or consult. Ask what a step too junior and a step too senior would look like. This sets `targets.titles`.
3. **Where and how:** the country they work in, their home city and the nearby towns they'd commute to, whether remote roles anywhere in that country suit them, and whether relocation is ever an option. This sets the place screen in `targets`, and the work-style line:
   - **`targets.country`:** the two-letter code (US). Everything below is in this one country. The job feeds search the US only today, so say so if theirs is another.
   - **`targets.places`:** one place by default, written `"City, Region": [nearby town, another nearby town]`. List the towns and neighborhoods postings use for the area, with their common short forms (for example `"Denver, CO": [Boulder, Aurora, Lakewood, Englewood]`). Ask whether there's another area they'd work in without moving, and add it the same way, for at most three places. A place they'd only move to belongs in the career direction file, not here.
   - **`targets.remote`:** true when remote roles anywhere in their country pass, false when they want an office they can reach.
   Remote roles in other countries, and onsite or hybrid roles anywhere else, drop on their own. The scout records the remote ones as Wrong place, so the person can check its country call, and only counts the rest. The plugin knows which country a city or region is in.
4. **Dealbreakers:** what should never be shown at all, for example travel over 25%, on-call, contract roles, or industries they won't work in. These go in the career direction file's Dealbreakers list, **at most five**, and fewer is better. Say why: every dealbreaker hides postings they'll never see, and the Stats tab counts how many each one drops. Show the difference from a preference with one pair: "never hybrid outside my city" is a dealbreaker (dropped), while "remote is better than three office days" is a preference (ranked).
5. **What they're optimizing for, and their preferences:** first write the "What <Name> Is Optimizing For" section. Then turn it into **at most five preferences**, each with a weight (high, medium, or low), in the career direction file's Preferences table. Before asking, show this menu so they see what kind of thing fits, and let them pick, reword, or write their own:

   | Example preference | Judged from |
   |---|---|
   | Work location and office days | the posting's location, and remote or hybrid terms |
   | Level or ladder (stay a manager, move into leadership, stay hands-on) | reports, title, and scope |
   | A stable, multi-year home | company signals: ownership, layoffs, growth, funding |
   | Company size or stage (startup, mid-size, large) | headcount, funding stage, public or private |
   | Industry or mission | what the company makes, and who it serves |
   | Hands-on versus strategic work | how much of the role is doing versus directing |
   | Travel | stated travel percentage |
   | Learning and growth (new domain, bigger scope) | what's new in the role compared with their record |
   | Schedule flexibility | core hours, shifts, and time-zone expectations |

   Explain the cap: five keeps the scoring readable and stops a long wish list from crowding out good postings. Keep a preference off the list when a dealbreaker already covers it, so nothing counts twice. Pay and visa sponsorship aren't preferences: each is its own setting (steps 7 and 8). Each shortlisted posting then gets two scores, never blended: Role fit (how well their record matches the role) and Preference fit (how well the role matches these). `node <tools>/fit.mjs list` shows what was written and flags problems.
6. **Timeline and discretion:** actively looking or just preparing, and whether their current employer must not notice (that affects LinkedIn changes, an Open to Work badge, and website colors). Record it in MEMORY.md.
   - **Application pace:** about how many applications a month they expect. This sets `scout.max_shortlist` (10 by default; 3 to 5 for a few senior moves, 10 to 20 for a steady search), `scout.cadence` (weekly, or daily in a fast market, where early applicants get read first), `scout.stale_days` (60, or 21 to 30 for software and other fast-moving markets), and `apply.depth`: `light` (recommended for more than a few a month, which is most searches) gives each posting a short fit note and saves full company research for when an interview is scheduled. `full` researches every company before applying, which suits a handful of senior, high-stakes applications.
7. **Pay floor (optional, recommend leaving it off):** ask whether they want the scout to screen on pay. It's its own setting, not a dealbreaker or preference, and it never changes a score. Recommend off: published ranges are often missing or wide, a number in a file can leak if the folder is ever shared, and the level check already compares pay. If they want it, set `targets.pay`: `min`, their minimum or their current pay; `drop_below` (10 by default), which drops a posting only when the top of its published range is more than that percent below `min`, so near misses still show up with a note; and `unlisted`, which decides postings that publish no pay: `keep` (recommended, since many postings omit it) or `drop`. To cast a wider net later, they lower `min` or raise `drop_below`. Leave `targets.pay` out entirely when it's off.
8. **Work authorization:** whether they need an employer to sponsor a work visa, now or later. Like pay, this is its own setting, not a dealbreaker or preference, and it never changes a score. If yes, set `targets.visa` (`needs_sponsorship: true`, their `status`, such as H-1B or F-1 OPT, and a `deadline` if their status runs out on a date, for example 60 days after a layoff). Explain what it does: the scout drops postings that say they won't sponsor and shows each employer's H-1B record from USCIS's public data. Then, with their OK, run `node <tools>/visa.mjs fetch` (about 7 MB from uscis.gov). A deadline under 90 days changes the plan, so suggest a wider watchlist and `apply.depth: light`. Their status stays in workspace.yaml and is never published.
9. **Level track:** where levels in their field can be compared, such as levels.fyi for tech, published pay bands for government, or salary surveys for consulting. This sets `targets.level_track`.

## 3. Take In the Raw Material

Ask for whatever they have: an old resume, a LinkedIn data export, performance reviews, a brag document, project write-ups, award notices, or a conversation if there's nothing written.

- **Where it goes:** put the files in `intake/` inside the workspace, and record in MEMORY.md that it holds personal documents that are never published or shared.
- **LinkedIn exports:** the data archive is a zip. Unzip it into its own folder under `intake/`, and read `Positions.csv`, `Profile.csv`, `Education.csv`, `Certifications.csv`, `Skills.csv`, and `Honors.csv` when present.
- **PDFs and Word files:** read them with the pdf or docx skill when one is available.

## 4. Build the Portfolio

1. **The role timeline first.** List every role with employer, title, location, work mode, and start and end months. Confirm it with the person before anything else, since every claim hangs off it. Promotions within one employer are separate lines.
2. **Disclosure rules.** Ask what their employers would consider confidential: internal project, tool, or team names, client names, revenue, headcount, security or incident details, or anything under NDA. Write the rules and a name mapping (internal name to the generic wording to use) into the portfolio's Disclosure Rules. Every output follows them from here on.
3. **Impact areas.** Group the work into four to eight areas. For each one, write the situation, what they did, and outcomes, with a source tag (Verified, Doc-sourced, Self-reported, or Relayed) and a scope tag (Personal, Team-led, or Program-level) on every number. Ask about era and scope wherever the material is vague, for example "Was this your team's result or the whole company's?"
4. **Resume lines.** For each area, draft tagged lines (`[track][area][core or opt]`) in the guide's XYZ pattern: the outcome, a measure, then the action. When there's no honest number, use concrete evidence instead (scale, adoption, what shipped, who relied on it), and never estimate one to fill the pattern. Tracks are the person's own leans: leadership and technical for a manager, or, for example, backend and platform for an engineer. These are the only lines cleared for external use.
5. **"If they probe" answers** for every line likely to reach a resume.
6. **Earlier career, education, certifications, and recognition,** with the details the person wants shown (for example, whether to show graduation years).

## 5. Style and House Rules

Ask a few quick preference questions, then add the answers to the House Rules section of the guide (`files.guide`):
- Spelling (US or UK) and date format.
- Page limit (`render.max_pages`, usually 1 early in a career and 2 later).
- Punctuation and voice preferences, for example no em dashes, or no sentences starting with a bare verb in the summary.
- Words or phrases they dislike, and any they want to keep.

Add to these whenever they reject a draft for a style reason.

## 6. Draft and Review the Default Resume

1. **Assemble it** from the portfolio's `[core]` lines in the resume template's exact shape. Pick the headline and summary approach from the guide's Headlines and Summaries sections, aimed at `targets.titles`.
2. **Review it line by line** with the person: the headline, the summary, the competencies, then each role's bullets. Offer two to four options per line with a recommendation. When they reject a whole set, ask what feels off (length, tone, connecting words) before writing new ones.
3. **Render** with `node <tools>/render.mjs`. Read the PDF to check the page count, the contact line, and the layout, and confirm the `.txt` copy rendered.
4. **Audit** against the guide's rubric (Y or N per item), and fix every N.
5. **Lock it:** set `reviewed:` in the resume's frontmatter, and note the date in MEMORY.md. From now on it's edited in place through `/resume`, not regenerated.

## 7. LinkedIn (if they want it)

Ask whether to keep LinkedIn copy in the workspace (`linkedin.enabled`). If yes, draft `files.linkedin` from the reviewed resume: a headline, a first-person About section, and experience bullets that mirror the resume without the bold labels. Review it like the resume. Remind them they paste it into LinkedIn themselves, and of the discretion answer from step 2 (for example, turn off profile-update sharing before a big edit).

## 8. Set Up the Job Search

**Screens in workspace.yaml `scout`:**
- **`title_all`:** one regex pattern per required trait. A title must match every pattern, typically one for the field and one for the level. Use word boundaries (`\b`), and single-quote each pattern.
- **`title_none`:** titles to skip, such as intern, sales, or recruiter roles, plus anything the person ruled out.
- **`remote_words`:** the words that mean a role is remote. The default (`remote|anywhere|distributed|virtual`) suits most fields. Where a posting must be comes from `targets.places` (the interview's step 3).
- **`search_terms`:** the words sent to career sites that support search (Workday, Eightfold, and the big-company sites). The title screen does the narrowing, but each term returns only a site's first few hundred postings per employer (200 on Workday, Oracle, SuccessFactors, Google, and Apple, and up to 1,000 elsewhere), so at large employers a one-word term (like "SAP") buries the relevant roles. `scout.mjs audit` lists each term that came back at its cap. Use two or three specific phrases (like "SAP security", "GRC", "access control") rather than one broad word.

**Dealbreakers and Preferences:** write both sections of the career direction file from the interview. Dealbreakers (at most five): wrong role, wrong level, wrong place, and their own. Stale postings are a setting (`scout.stale_days`), not a dealbreaker. Preferences: the table from step 5. Then run `node <tools>/fit.mjs list` and fix anything it flags.

**Research notes:** write the career direction file's Research Notes from the field: the public signals that show how strong the function the person works in is at an employer (who leads it and how it reports, the filings, certifications, or regulations that apply, and the press that matters). `/apply` reads them during company research. Ask what they already look for.

**Where people in the field find jobs:** research this before building the watchlist, and cite sources. Look at the field's employers (for example product companies, consulting firms, and integrators in tech; hospital systems, clinics, and travel-nurse agencies in nursing; school districts and charter networks in teaching; and government, including federal jobs on USAJOBS, which the scout can't read, so those employers stay manual), the boards that matter (some fields lean on niche boards or staffing agencies more than company sites), and the professional associations and communities. Write a dated summary in the career direction file's Market Notes.

**The watchlist** (`applications/watchlist.md`):
1. **Propose 20 to 60 employers** that fit the person's field, location, and priorities (a local search in a field with a few large employers, such as nursing in one metro area, can be fewer), with a one-line reason each, grouped into four to eight domains (for example Fintech, Health, or Security vendors). The sheet's Employers tab can be filtered by domain, and the person can keep editing the list there. For software and other tech roles, where most employers are ones the person hasn't heard of, also offer discovery (`scout.discover: [hn]`, see the scout skill's `discovery.md`), and run `node <tools>/discover.mjs hn` once the screens are calibrated. With the visa module, check each one with `node <tools>/visa.mjs history <company>`, add its record to the reason, and favor employers with a steady sponsorship record. Ask them to add, cut, or rank the list. They know their market.
2. **Find each employer's feed** with the source table and steps in the scout skill's `feeds.md` (curl the careers page, look for a supported host, and check the feed URL). Run these checks a few at a time, and add each one with `node <tools>/watchlist.mjs add "<Company>" --domain "<Domain>" --source <source> --board <board> --why "<reason>"`. Employers with no supported feed are added without `--source`, which makes them `manual`. Don't add a new source type without the person's OK.
3. **Calibrate the screen:** run `node <tools>/scout.mjs`, then read the matched titles with the person.
   - Too many wrong roles: tighten `title_all` or extend `title_none`.
   - Known good titles missing: `node <tools>/scout.mjs audit` lists the titles one pattern away from passing. Loosen the patterns, and check the place screen.
   - `[empty]` or `[error]` lines: fix those boards before trusting the counts.

   Rerun until the matched set looks right. Calibration runs fill `applications/data/seen.csv` with rows that were never screened, and `applications/data/scout-runs.csv` with their run history, so delete both files once calibration is done. The first real `/scout` run then starts clean.
4. **Validate:** run `node <tools>/scout.mjs validate`, and fix any `FAIL`.
5. **Profile:** fill `applications/profile.md` (work authorization, sponsorship, relocation, work arrangement, travel, notice period, EEO choices). Anything they'd rather answer later stays TODO.

Then offer the first real `/scout` run.

## 9. Optional Modules

**Colors first,** if they want the sheet or the website (skip this otherwise). Both use the same two colors from `theme` in `workspace.yaml`: `primary` carries white text (sheet headers, the site's sidebar), and `accent` is the highlight (rules and pills). Offer three or four pairs with the question tool, the recommended pair first, chosen by:
- **Their taste:** ask for the feel in one question: classic and conservative, calm and warm, or bold and modern.
- **Their field:** conservative fields (finance, law, security, government) read best in deep navy, charcoal, or forest with a muted accent. Creative and consumer fields can carry more color.
- **What to avoid:** their current employer's brand colors (a site in those colors looks like corporate branding and can signal a job search), and any color they dislike.
- **Contrast:** white text on `primary` must reach WCAG AA (4.5:1), and `accent` must stand out against white and against `primary`.

Save the pair under `theme`, and record the choice in MEMORY.md. The website's design round can still refine it later.

Offer each module, and set it up only on a yes:
- **Tracking sheet:** a Google Sheet mirroring their shortlist (with a Status dropdown they can use to pass on a role), the scout's recent screening log, companies, and their career history. Follow Create in the `sheet` skill's `layout.md`. It needs the Google Sheets and Drive connectors.
- **Personal website:** follow the `website` skill's design round. Hosting costs money and needs accounts, so explain the options and let them decide. It can wait.
- **Interview prep:** a study path for their field and target level, from the `prep` skill.
- **LinkedIn connections:** shows who they already know at each shortlisted or evaluated company, from LinkedIn's own data export, as possible referral paths. It reads only the connections file, never messages, and never contacts anyone. Follow the `connections` skill's Turn It On section. Off unless they say yes.
- **Drive folder (optional, with the sheet):** the sheet goes in a Google Drive folder, where the user can ask for a posting's packet or their interview prep as a Google Doc to read in a browser or on a phone. Docs are made only on request, since each one passes through the conversation in full (about 12,000 tokens for a typical packet). Set `drive.enabled` and follow the `sheet` skill's `drive.md`.
- **Scheduled runs:** the scout, a sheet sync, and monthly discovery can run on their own as Claude Code Desktop scheduled tasks, which run in the workspace folder while the Desktop app is open and the computer is awake (each run uses their Claude plan like a chat would). Nothing is installed on the computer. All are off by default. Offer this only after the first real scout run, once the screen is calibrated. On a yes, ask how often for each (the scout's frequency follows `scout.cadence`, the sheet sync can be daily or weekdays, and discovery is monthly) and at what time, then follow the scout skill's `scheduling.md`. If they say not now, leave every job off and note in MEMORY.md that they can turn it on later.
- **Standing variants:** a second resume for a different kind of target, for example a leadership lean and a technical lean. List the ideas in `variants/README.md`, and draft them later through `/resume`.

## 10. Finish

1. **Fill the workspace's own files:**
   - **CLAUDE.md:** standing instructions, including deliberate differences between places (for example LinkedIn in the first person) and their style non-negotiables.
   - **MEMORY.md:** status, open items, preferences learned during onboarding, and the environment.
2. **Set `index.title`** in workspace.yaml, then run `node <tools>/tracker.mjs`, which also builds INDEX.md.
3. **Check the workspace:** run `node <tools>/doctor.mjs` and fix every problem it lists. Placeholder warnings for settings the person skipped are fine to leave, but say which ones.
4. **Report:** what's done, what's TODO, and the three things to try next, for example "run the scout", "add this project to my portfolio", and "I'm interested in the second one".
