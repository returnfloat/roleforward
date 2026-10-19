---
name: connections
description: Optional, opt-in module that finds the workspace owner's 1st-degree LinkedIn connections at the companies behind their shortlisted and evaluated postings, as possible referral paths, from LinkedIn's own data export. Use when the user wants to turn it on or off, import or refresh their LinkedIn connections, asks who they know at a company, or wants a referral request drafted. Never signs in to LinkedIn and never contacts anyone.
---

# Connections

Shows who the user already knows at a company, so a good-fit posting can come with a referral. The only input is `Connections.csv` from LinkedIn's data export. The module is off until the user turns it on.

## Working With the Workspace

- **The workspace** is the current folder, or the nearest parent with a `workspace.yaml`. Settings live under `connections` there: `enabled`, `refresh_days` (30 if unset), `function_words` (regex fragments for the user's own field, defaulting to the first `scout.title_all` pattern), and `aliases` (a company and the other names it goes by).
- **Their own instructions win.** The workspace's `CLAUDE.md` and `MEMORY.md` override this skill where they conflict.
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory. Run them from the workspace root as `node <tools>/connections.mjs`.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## Hard Rules

- **Connections only.** Read `Connections.csv` and nothing else from the LinkedIn export: no messages, message counts, invitations, profile, or inferred data. The import script pulls that one file out of the archive, and nothing else in the archive is opened.
- **No LinkedIn access.** Never sign in to LinkedIn, browse it, scrape it, or automate it, even with a browser skill.
- **No outreach.** Never message, email, or connect with anyone. Draft a referral request only when the user asks, for them to send themselves.
- **Display only.** Contacts never change Role fit, Preference fit, the scout's ranking, or which postings get shortlisted.
- **Kept data:** each connection's full name, company, title, profile link, and connected-on date, in `contacts/connections.csv`. Email addresses are dropped. The data stays in the workspace, and names and titles may appear in the user's own Google Sheet because they opted in. Never copy it into the plugin or anything shared.
- **A connection isn't a referral.** The `referral` and `referrer` fields in posting.md record a referral the user actually got. Set them only on the user's word.

## Turn It On

1. **Explain it in a few lines,** including the hard rules above, and ask whether to turn it on. It's optional.
2. **Request the export.** In LinkedIn: Settings → Data privacy → Download your data. Connections isn't one of the individual files LinkedIn offers, so pick the larger data archive. LinkedIn emails a download link, often within minutes but sometimes up to a day.
3. **Set `connections.enabled: true`** in `workspace.yaml`, and add `refresh_days`, `function_words`, and `aliases` only if the defaults don't fit (see the template's comments). Show the change before saving it.
4. **Import** when the archive arrives (below), then sync the sheet if the workspace has one, so the Contacts column fills in.
5. **Record it** with a date in MEMORY.md.

## Import or Refresh

1. Run `node <tools>/connections.mjs import <path>` with the downloaded zip or an unzipped `Connections.csv`. Never unzip the archive into the workspace.
2. Pass on what the script says. It reports how many connections were kept, and for a zip it suggests deleting the archive, which also holds the user's messages and other account data. Delete it only if the user says so.
3. Run `node <tools>/tracker.mjs` and sync the sheet (the `sheet` skill), since every Contacts cell is computed from the current import.

## Freshness

`node <tools>/connections.mjs status` shows the export's date. When it's older than `refresh_days`, the script prints a one-line nudge (so does `sheet.mjs rows`, on stderr, and so does `match`). Pass it on once per session, gently, as part of whatever else you're reporting, never as a separate interruption. "Your LinkedIn connections are from Aug 1. A fresh export would catch anyone who changed jobs since." If the user says not now, drop it for the session.

## Who Do I Know at This Company

`node <tools>/connections.mjs match <company>` lists the matches, best referral prospects first:

1. **Same field:** their title matches the user's own field (`function_words`).
2. **Recruiting:** recruiters and talent partners, who can route a referral or say who the hiring manager is.
3. **Everyone else.**

Within each group, the longest-standing connection comes first. Company names are compared after dropping case, punctuation, and endings such as Inc or LLC. A company's other names (a parent, its brands) count only once they're listed under `connections.aliases`. The script also lists similar company names it didn't count. Ask the user before adding any of them as an alias. The data shows only where people work now, as of the export, so say so when it matters.

## Where It Shows Up

- **`/scout`:** each shortlisted posting's Triage section gets a Contacts line, and the run report gets a Contacts column.
- **`/apply`:** Stage 1 adds a **Referral Paths** section to posting.md with the top matches, linked to their profiles, and a line on why each one ranks where it does. Skip the section when nobody matches.
- **The sheet:** the Contacts column on Shortlist and History, with a count and the top three names and titles. It stays empty while the module is off.

## Drafting a Referral Request (only when asked)

Write a short message for the user to send: how they know the person, the role with its link, one or two fit points from the posting's analysis (portfolio facts only), and a clear, easy-to-decline ask. Follow the workspace's style rules. Never send it. If the user later says the referral happened, set `referral: true` and `referrer:` in posting.md, then run the tracker.

## Turn It Off

Run `node <tools>/connections.mjs forget`, which deletes the imported connections. Then set `connections.enabled: false` in `workspace.yaml`, sync the sheet so the Contacts column empties, and note it in MEMORY.md. Referral Paths sections already written in posting.md files stay unless the user asks to remove them.
