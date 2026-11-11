# The Offer Stage

An offer is the moment with the most money and risk at stake, so it gets its own record and a careful pass before the user answers. These steps follow the apply skill's rules throughout: the user decides, the plugin never contacts anyone, and pay figures stay in chat unless the user explicitly says to save them.

## 1. Record the Offer

- **Log the event** `YYYY-MM-DD | offer | <one line, for example "written offer received">` and set `next` to the deadline to answer, with `node <tools>/next.mjs set <folder> <deadline> "Answer the offer"`. If there's no deadline yet, ask the employer for one (a draft on request), and set a check-back in 3 days meanwhile.
- **A verbal offer** is logged the same way, with "verbal, written offer to follow" as the note. Nothing in it is part of the offer until it's in writing.

## 2. Fill offer.md

Create `offer.md` in the posting folder from `<templates>/applications/offer-template.md`, within its budget of about 500 words. The tracker flags a posting at `offer` until it exists.

- **Terms:** title, level, reporting line, location and work mode, start date, the deadline to answer, and contingencies (a background check, references, right to work). Fill each from the written offer, and write "not in the letter" where it's silent.
- **Pay:** the pay rows say "Discussed in chat". Talk through base, bonus, equity, sign-on, and relocation in chat. Write a figure into the file only when the user explicitly says to save it.
- **Said in Conversation:** every promise made out loud (a remote-work exception, a reporting line, a team size, a title, a review date) with who said it, when, and whether the written offer includes it. Anything not in the letter isn't part of the offer, so each one is either added to the letter or treated as not promised.
- **Open questions:** what the user still needs to know, with who can answer each.

## 3. Research the Company Again

Refresh company.md in full, whatever its age (Stage 2 of the apply skill, in `prepare.md`), and add offer-stage diligence:

- **Private companies:** the latest 409A valuation, the preferred stock overhang, runway, and secondary-sale or IPO prospects.
- **Public companies:** refresh grants, the share price trend, and recent guidance.
- **Any company:** news since the last check, leadership changes, and the team's state as the user now understands it from the interviews.

## 4. Compare

- **Against the Preferences:** rate each of the user's Preferences again from everything now known, with `node <tools>/fit.mjs set <folder> <key>=<1-5> ...`, and fill the Compared table. Rate their current role on the same scale in chat, or in the table if they like, so the offer is weighed against staying.
- **Against other offers:** when several offers are live, compare them side by side in chat, term by term and preference by preference, with pay in chat only. Each keeps its own offer.md.
- **Say what's missing:** a term that matters to a dealbreaker and isn't in the letter is the first thing to resolve.

## 5. Prepare the Negotiation

Coach, and leave the talking to the user. Fill offer.md's Negotiation Plan with them:

- **Priorities, in order,** from their Preferences and what the comparison showed.
- **Asks:** each one with the reason behind it (market data, a competing offer, the scope of the role, a promise to put in writing). Public market medians can go in the file; the user's own targets stay in chat.
- **Would trade:** what they'd give up for a higher priority.
- **Walk away:** the point at which they decline. Any figure stays in chat.

Draft emails or talking points only when the user asks, for them to send or say themselves. Getting every verbal promise into the letter is usually the first ask.

**No legal or tax conclusions.** Explain what a term generally means and what to ask about it, and say plainly when something needs a professional: equity terms (vesting, cliffs, exercise windows, acceleration), tax treatment, a non-compete or non-solicitation clause, an IP assignment, or immigration (a visa transfer, a green card timeline). Suggest the kind of professional (an employment lawyer, a tax adviser, an immigration attorney), never a conclusion.

## 6. Decide

Walk through offer.md's Decision Checklist with the user. The decision is theirs. When they answer, log it, and clear `next` or set the next step.

## On `accepted`

Log `YYYY-MM-DD | accepted | <one line>`, then go through this checklist with the user:

- [ ] **Every promised term is in the signed letter** before they resign. A promise that isn't in it stays a promise, so ask for it in writing first.
- [ ] **Contingencies cleared:** the background check, references, and any right-to-work steps are done, or the user accepts the risk of resigning first.
- [ ] **Other live applications withdrawn:** list each one from `node <tools>/next.mjs list`, and with the user's OK, log `withdrawn` on each with a one-line reason. Draft a short note to each recruiter only if the user asks.
- [ ] **Scheduled scout runs paused:** if the workspace has any (`schedule.scout`), the user turns them off in Desktop's Routines page, and `enabled` is set to false.
- [ ] **A notice plan:** the notice period from their current terms, the date to resign, the last day, and anything to hand over.
- [ ] **The record:** the new role enters the portfolio, the resume, and LinkedIn through the resume skill's sync rule, when the user decides the timing (many wait until they've started).

## On `declined-offer`

Log `YYYY-MM-DD | declined-offer | <the reason, in one line>`. The reason stays with this posting: it never becomes a dealbreaker unless the user says to add it to the career direction file.
