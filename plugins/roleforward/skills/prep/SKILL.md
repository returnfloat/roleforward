---
name: prep
description: Builds and maintains the workspace owner's interview prep and learning path for their field and target roles, with free, live-checked resources, "be ready to say" lines tied to their own record, a story bank, and practice prompts. Runs scored mock interviews (coding, system design, SQL, product sense, behavioral, leadership, scenario, case, portfolio review) with spaced review of weak spots, coaches take-home assignments, and debriefs real interviews. Use when the user asks for a study guide, learning path, interview prep, a refresher on a topic, a mock interview or practice round, help with a take-home, prep for a specific interview, or wants to debrief one.
---

# Interview Prep and Learning Path

## Working With the Workspace

- **The workspace** is the current folder (or the nearest parent with a `workspace.yaml`).
- **The prep file** is `files.interview_prep` (default `interview-prep.md`).
- **Targets:** `targets.field` and `targets.titles` say what the path is for.
- **Source material:** the portfolio holds the user's record, and its "if they probe" lines are the answer bank.
- **The workspace's own instructions win.** The workspace's `CLAUDE.md` and `MEMORY.md` override this skill where they conflict.
- **Practice log:** `practice/practice.csv`, kept by `node <tools>/practice.mjs` (`<tools>` is the plugin's `tools/` folder, two levels above this skill's base directory). Scoring rubrics are in `rubrics.md` next to this file.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## The Format (keep it the same in every workspace)

- **Header:** what the path is for, and the goal. Speak current framework language about work the user has already done, close the gaps postings keep asking about, and tell their own stories crisply.
- **How to Use This:** a short path (the ★ items plus practice, about 10 hours), and the full path with an estimate.
- **Tracks.** Each track has sections, and each section has:
  - *Backs up* or *Goal*: the resume claim or gap it serves.
  - **Resources**, each as `- **Name** (what it is, time estimate): URL`, with ★ on the must-dos.
  - *Be ready to say:* one or two sentences the user should be able to say confidently, tied to their own record. If they can already say it, they skip the section.
- **The usual tracks:**
  1. Refresh what the resume claims.
  2. Close the common gaps in target postings.
  3. The altitude of the target level.
  4. Practice from their own material: a story bank in STAR format, practice exercises, and a before-each-interview checklist. Point it at the practice rounds below, and list the formats the user's target interviews use.
  5. Optional field-specific tracks the user asks for, such as technical strategy.
- **Notes:** dated entries for when tracks were added and when links were checked.

## Building or Extending a Track

1. **Ground it in the user's record and targets:** read the portfolio, the default resume, the career direction file, and three or four target postings (shortlisted or applied ones under `applications/`). Gaps come from what postings ask for that the record shows lightly.
2. **Prefer free resources** from standards bodies, nonprofits, universities, professional associations, and major vendors. Pick current editions and versions.
3. **Check every link live before writing it.** Check the HTTP status and the page title, since some sites return a "not found" page with status 200. Drop anything that can't be verified. Note the check date in the Notes section.
4. **Write "Be ready to say" lines from the user's own stories,** with the portfolio's numbers and the framing it allows. Never put a number in the prep file that the portfolio doesn't clear.
5. **Add practice:** at least one timed prompt per track that tests judgment, such as a case, a design walkthrough, a 90-day plan, or a board update, sized to the field.
6. **Estimate time honestly,** update the totals, and add a dated note.

## Prepping for a Specific Interview

- **Material:** use the posting's frozen `resume.md`, `jd.md`, and `answers.md` (run `freeze.mjs --check` first), plus `company.md`.
- **Their sent resume:** pick the 4 to 6 stories that best match the posting's must-haves, and rehearse the "if they probe" answers for every number on the resume they sent.
- **Practice in the loop's formats:** plan practice rounds between now and the interview date, starting with what `practice.mjs due` lists in those formats, and finish with one full mock of the hardest round a day or two before.
- **Their questions:** turn company.md's open questions into questions for each interviewer. Put the user's dealbreaker questions first, for example on-call or travel, from the Dealbreakers in the career direction file.

## Practice Rounds (mock interviews)

The rounds that decide most technical offers are live problem-solving, not recall, so practice them the way they're run.

1. **Pick the format and topic.** Start with `node <tools>/practice.mjs due`, which lists weak topics that are due again. With an interview coming, use that loop's formats (from the recruiter, the posting's jd.md, or company.md). Otherwise use the formats the target titles usually face: coding and system design for engineers, SQL, analytics, and ML design for data roles, product sense and execution for product managers, portfolio review for designers, behavioral for everyone, and leadership for managers. Say which and why in one line.
2. **Set it up like the real thing.** State the time box from `rubrics.md`, and give one problem at the target level, worded the way an interviewer would, without hints. Pick problems that test the pattern, not trivia. For behavioral rounds, ask a question the story bank should answer.
3. **Play the interviewer.**
   - Answer clarifying questions as an interviewer would, and leave out what they didn't ask about.
   - Ask the follow-ups a real interviewer asks: "What's the complexity?", "What if traffic grows tenfold?", "What did you do when that failed?"
   - Give a hint only when they ask or stall for a long time, and note it, since a hint lowers the score.
   - For coding, they write the code in chat, or in a file under `practice/` if they prefer. Trace it by hand with a test case, or ask before running it.
   - For system design, ask them to walk through the design out loud in chat. A diagram is optional.
4. **Score it** with `rubrics.md`: each dimension 1 to 4 with one line of evidence, then the overall call. Be honest. A generous score teaches nothing. Lead with the most important fix, then show a strong answer for the part they missed (a reference solution, a better design, or a tighter story).
5. **Log it:** `node <tools>/practice.mjs log <format> "<topic>" <score> "<the one thing to fix>" --prompt "<the question>"`. The topic is the pattern or skill, not the problem title ("graphs: BFS on a grid", "rate limiter", "conflict with a peer"), so the same weakness resurfaces with a new problem.
6. **Behavioral stories** that improved go back into the story bank in the prep file, using portfolio facts and scope only.

`node <tools>/practice.mjs stats` shows the trend per format. Use it when the user asks whether they're ready: two or three rounds in a row at 3 or 4 in each of the loop's formats is a fair sign.

## Take-Home Assignments

The submitted work must be the user's own, within the company's rules.

1. **Ask what the company allows** on AI tools, and follow it. If the instructions don't say, suggest the user ask the recruiter. Without a clear yes, help only as a coach: explain concepts, ask questions, review their choices, and point at problems, without writing the deliverable.
2. **Scope it:** list the questions to send the recruiter (time expected, what's graded, language or stack limits), and plan the time box with the core requirements first and stretch goals last.
3. **Review before they submit** against the take-home rubric: what's missing, what breaks, and whether the README explains decisions and tradeoffs. Run their tests if they ask.
4. **Log it** as format `take-home` after they submit, and keep their notes for the follow-up interview, which usually walks through the work.

## Debriefing a Real Interview

Right after a round, while it's fresh:

1. **Capture** the round in `interviews.md` in the posting's folder (create it if needed): date, interviewer and role, the format, each question as close to its wording as they remember, how they answered, what the interviewer pressed on, and their own read. These are the user's notes, so they stay private.
2. **Log the stage** through the apply skill (for example `recruiter-screen` or `interviews`), which rebuilds the tracker.
3. **Turn gaps into practice:** each weak answer becomes a `practice.mjs log` entry with an honest score, so it comes back for review before the next round. A question their stories couldn't answer becomes a new story bank entry.
4. **Prepare the next round:** what that interviewer or the next one is likely to probe, from the questions asked so far and company.md.
5. **A thank-you note,** if they want one: a short draft for them to send, mentioning one specific point from the conversation.
