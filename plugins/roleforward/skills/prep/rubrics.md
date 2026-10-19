# Practice Rubrics

Score each dimension 1 to 4, then give the round one overall score on the same scale for `practice.mjs log`. The overall score is the hiring call, not an average: one dimension at 1 usually caps the round at 2.

| Score | Call | Means |
|---|---|---|
| 4 | Strong hire | Would pass this round at the target level at most companies |
| 3 | Lean hire | Would pass with an interviewer who's on the fence. One clear gap |
| 2 | Lean no | Several gaps, or one that a strict interviewer would stop at |
| 1 | No hire | Didn't reach a working answer, or a red flag |

Calibrate to the target level in `workspace.yaml` (`targets.titles`). A senior engineer's system design is judged on tradeoffs and failure modes, and a new graduate's on a working design. A nurse manager's scenario answer is judged on the unit as a whole (staffing, safety, escalation), and a new charge nurse's on the shift in front of them.

## Coding

- **Understanding:** restates the problem, asks about input size, edge cases, and constraints before coding. A 4 finds the tricky case unprompted.
- **Approach:** names a brute-force answer, then improves it, and says why. A 2 jumps to code with no plan.
- **Correctness:** the code runs and handles the edge cases. Test it by hand, or run it if the user agrees. A bug found and fixed by the user still counts.
- **Code quality:** clear names, small functions, no dead code. Idiomatic for the language they chose.
- **Complexity:** states time and space correctly, and knows which part dominates.
- **Communication:** thinks aloud, takes hints well, and doesn't go silent for long stretches.

Timing: 35 to 45 minutes for one medium problem, including questions.

## System Design (and ML System Design)

- **Requirements:** functional and non-functional (scale, latency, consistency, cost), with numbers, agreed before drawing anything.
- **High-level design:** the main components and the data flow, at the right altitude first.
- **Data model and APIs:** concrete schemas and endpoints, with access patterns driving storage choices.
- **Scale and bottlenecks:** finds the hot spot, and uses caching, partitioning, queues, and replication where they earn their cost.
- **Tradeoffs and failure modes:** what breaks, how it degrades, and the alternatives rejected and why. This is what separates senior from mid-level.
- **ML design adds:** problem framing and the metric, data and labels, features, model choice with a baseline, offline and online evaluation, serving, and monitoring for drift.

Timing: 45 to 60 minutes.

## SQL and Analytics

- **Query correctness:** right joins, grouping, and filters, with nulls and duplicates handled.
- **Approach:** breaks a hard question into steps (CTEs), and checks intermediate results.
- **Metrics judgment:** defines the metric precisely and names its pitfalls (denominators, seasonality, selection bias).
- **Interpretation:** says what the result means for the business, and what they'd check next.

## Product Sense

- **Users and problem:** picks a user segment and a real pain point, with reasons.
- **Prioritization:** several options, a clear pick, and the reasoning behind it.
- **Solution:** concrete enough to build, with the first version scoped.
- **Success metrics:** one primary metric, guardrails, and how they'd know it failed.
- **Structure:** easy to follow, and checks in with the interviewer.

## Execution and Metrics

- **Diagnosis:** for "metric X dropped", separates data problems from real changes, then segments (platform, region, cohort, funnel step).
- **Goal setting:** picks a north-star metric that matches the product's value, with counter-metrics.
- **Tradeoffs:** makes a call when two teams' metrics conflict, and says what would change their mind.

## Behavioral

- **Structure:** situation and task in two sentences, then most of the time on actions, then a result.
- **Ownership:** "I" for their own actions, and credit to others where it's due. The portfolio's scope tags decide the framing.
- **Evidence:** a concrete result, a number where the portfolio clears one, and what they learned.
- **Fit to the question:** answers what was asked, and handles a follow-up without a new story.
- **Length:** two to three minutes. Longer than four is a 2 at best.

## Scenario (situational judgment: clinical, classroom, operational)

Common in nursing, teaching, healthcare and retail management, and government panels: "Two nurses call out before a full day shift. What do you do?"

- **Priorities first:** names what matters most right now (safety, the people affected, legal or policy limits) before acting.
- **Concrete steps:** says what they'd do, in order, and who they'd involve or escalate to. A 2 stays general ("I'd communicate with the team").
- **Rules and standards:** applies the policy, regulation, or practice standard that governs the situation, and says where they'd check it.
- **Follow-through:** how they'd close the loop: documentation, a debrief, and what changes so it doesn't recur.
- **Judgment under pressure:** handles a follow-up twist ("and the manager on call doesn't answer") without losing the thread.

Timing: three to five minutes a scenario, three or four scenarios a round.

## Leadership and Strategy (manager and director rounds)

- **Altitude:** talks about outcomes, org design, and tradeoffs, not tasks.
- **People:** hiring, growing, and managing out, with specifics.
- **Influence:** how they moved peers and executives without authority.
- **Judgment:** a hard call, what they weighed, and what they'd do differently.
- **Plans:** a 30-60-90-day plan or a strategy that starts by listening and ends with measurable outcomes.

## Case (consulting style)

- **Structure:** a clear issue tree, mutually exclusive and collectively exhaustive.
- **Math:** quick, correct, and sanity-checked out loud.
- **Synthesis:** a recommendation first, then the support, then the risks and next steps.

## Portfolio Review (design)

- **Story:** problem, constraints, their role, process, outcome, in that order.
- **Decisions:** why this design over the alternatives, with evidence (research, tests, data).
- **Craft:** visual and interaction quality fit the level.
- **Impact and reflection:** what shipped, what changed, and what they'd redo.

## Take-Home Review

- **Scope:** did what was asked, in the time asked, and wrote down what they left out and why.
- **Quality:** works, has tests where they matter, and reads cleanly.
- **Write-up:** a README that explains decisions, tradeoffs, and how to run it.
