# Stages 2 and 3: Company Research and Preparing the Application

Read this when the user wants to apply to a posting (Stage 2 at full depth, then Stage 3), and at light depth when the first `recruiter-screen` or later event is logged on a posting without full research (Stage 2). The apply skill's principles and rules still hold: reuse first, a per-job resume only with the user's OK, and the user submits every application themselves.

## Stage 2: Company Research (the user wants to apply)

At full depth, do this before preparing anything, since it can change the decision. At light depth, skip to Stage 3, and run this stage (with the Quick Check first, if company.md doesn't exist yet) when the first `recruiter-screen` or later event is logged.

1. Read the career direction file's **Research Notes**, the field-specific signals to look for, and use them in both the Quick Check and the full research. Then build on the Quick Check already in `company.md`, and fill the Full Research table and evidence, within about 900 words. If its `researched` date is under 90 days old, refresh only what changed (news, filings, leadership) and say so.
2. **Use primary sources first:**
   - Public companies: SEC EDGAR (the 10-K business and risk sections, the proxy for executive changes, and any sections on the user's function, such as Item 1C for cybersecurity roles).
   - Layoffs: state WARN notices, then layoffs.fyi and reputable press. Private funding: Crunchbase and press.
   - Public sector, healthcare, and education employers: budgets, board minutes, accreditation and regulator reports.
   - The team's shape and turnover: public profiles and press.
   - Glassdoor, Blind, Reddit, and similar sites only as hearsay.

   Use web search and fetch, and cite every claim with its source.
3. **Be honest about gaps.** Write "Not found", and turn each gap into a question for the recruiter or interviewers.
4. **Score and conclude:** fill the frontmatter scores (1 to 5: stability, growth, and the maturity field named by `workspace.yaml` tracker.maturity_field) and the verdict, then the Bottom Line. These are facts about the company. Then rate again any preference the research settles (for example a stable, multi-year home) on each of the user's postings at this company with `fit.mjs set`, so their Preference fit reflects what was found. Present the Bottom Line, top red flags, and open questions in chat with the link to company.md, and give a recommendation. The user confirms before Stage 3.
5. Run `node <tools>/tracker.mjs` so the scores join the application data.

## Stage 3: Prepare (the user confirms after the research)

1. **Reused resume:** set `resume:` to the chosen file and make sure its render is current (`node <tools>/render.mjs` for the default, or `node <tools>/render.mjs variants/<name>.md`). The PDF to upload is `output/<file_stem>-Resume-Apply.pdf` or `output/variants/<file_stem>-Resume-<Name>.pdf`.
2. **Tailored resume, only after the user's OK:**
   - Copy the closest existing resume to `resume.md` in the posting folder. Set `title`, `variant: "Tailored: <company>, <role>"`, and `base:`.
   - Change as little as possible. Use portfolio lines and numbers only, keep the scope framing, and follow the workspace's guide and disclosure rules.
   - Show each changed line in full with two to four options and a recommendation, and wait for the user's call. Log the accepted changes under `## Tailoring Log`.
   - Render with `node <tools>/render.mjs applications/<company>/<folder>/resume.md`, confirm the page limit, and read the PDF.
3. **ATS check:** run `node <tools>/ats.mjs <folder>` on the resume chosen in step 1 or 2. It reads the PDF's text the way an applicant tracking system's parser does, and checks the posting's terms against it.
   - **The terms:** first write `keywords.md` in the posting folder from jd.md: a `## Required` and a `## Preferred` group, one `- term` per line, with alternatives after ` | ` (for example `- threat modeling | threat model`). Take them from the posting's must-haves and nice-to-haves, in its own words.
   - **Parsing:** a `FIX` line means a parser would misread the resume. A current render clears the character and reading-order checks, so re-render and check again before anything else.
   - **Missing terms:** sort each one into two groups. "The portfolio supports it" means a resume line, or a fact behind one, shows it truthfully. "Can't claim it" means it doesn't. Before proposing a term, read that portfolio line's caveats, attribution notes, and "if they probe" answers, and don't propose a line that overstates the user's role. Propose wording only for the first group, show each changed line in full, and wait for the user's call. A change that would help any posting (a competency the record backs) goes to the default resume too, under the workspace's sync rules. Show the user the count before and after.
   - **Matches:** read the context printed with each match. A word inside another phrase (for example "consultant" for "consult") isn't a real match.
4. **`answers.md`:** pre-fill from `applications/profile.md`, then draft the posting-specific answers: why this company, why this role, short answers, and a cover note if asked. Gaps from rung 2 of the ladder go here, and specifics from company.md make the "why this company" answers concrete. Leave salary blank and ask the user each time. Write a number in only if they say to.
5. **Optional form fill:** if the user asks and a browser-automation skill is available, fill the form from answers.md and attach the right PDF. Never click Submit. The user reviews and submits. Anything typed that differs from answers.md goes back into answers.md.
