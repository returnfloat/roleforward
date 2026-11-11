---
name: sheet
description: Creates and syncs the workspace owner's Google Sheet, a browser view of their job search and career record with Shortlist, Scout Log, History, Stats, Employers, and Career tabs. Use after any change to application records or the watchlist (the apply and scout skills call for it), when the user says they changed a status or the employer list in the sheet, when they ask to set up, fix, restyle, or check their tracking sheet, when a role fact changes and the Career tab needs updating, or when they want a posting's packet or their interview prep as a Google Doc in their Drive folder.
---

# Tracking Sheet

The sheet mirrors the workspace. The local records are the source, and the sheet is overwritten from them, with three exceptions the user may edit: the Shortlist's **Status** dropdown, History's **Reason** column, and the **Employers** tab's Domain and Status columns, plus new rows there (the watchlist). When the user picks a status (for example `passed`), types a reason, or adds, regroups, pauses, or drops an employer, the next sync saves it in the workspace before anything is overwritten. It needs the Google Sheets connector (and Google Drive to create a new sheet). Before any Google write, load the google-workspace skill if it's available, and follow its Sheets reference: read before writing, guard against hand edits, and verify after.

## Working With the Workspace

- **The sheet's ID and tab IDs** are in `workspace.yaml` under `sheet`. If they're missing, the workspace has no sheet yet (see Create, Update, and Format below).
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory. `node <tools>/sheet.mjs` builds rows, headers, and formatting, and never talks to Google itself. Run it from the workspace root after `node <tools>/tracker.mjs`.
- **Rolling windows** in `workspace.yaml`: `sheet.scout_log_days` (14 if unset) for the Scout Log, and `sheet.history_days` (30 if unset) for History and for pruning old records.
- **Setup trouble:** when a script fails in a way that points to setup, run `node <tools>/doctor.mjs`, which changes nothing, and fix what it calls a problem.

## Tabs

| Tab (sheetId) | One row per | Columns | Order |
|---|---|---|---|
| Shortlist (0) | live posting, a role judged a good fit (shortlisted, interested, in conversation, applied, or any interview stage) | A to P: company, role, status (a dropdown of every stage), role fit, preference fit (the two scores from `fit.mjs`, never blended), last event, next (the posting's next action, date and what happens, set in the workspace with `next.mjs`: display only), applied, track, resume, source, referral (blank while the posting is only shortlisted, since it's asked when the user marks it interested), why it's here, contacts, posting link, and a muted Record ID at the far right (the posting's folder under `applications/`) | The lower of the two scores first, then the higher, then newest event |
| Scout Log (4) | posting that passed the scout's title and location screen in the last `scout_log_days` days, whatever the scout then decided | A to I: company, role, location, posted, first seen, last seen, scout call (new, held, dropped, or shortlisted), reason, posting link | Newest first seen first |
| History (2) | posting that ended (expired, passed, rejected, withdrawn, no response, declined offer, accepted) in the last `history_days` days, plus every posting that reached an application, which stays for good | A to N: company, role, outcome, ended, reason (the user may edit it), role fit, preference fit, applied, source, resume, why it was here, contacts, posting link, and a muted Record ID | Newest first |
| Stats (5) | number the tracker computes | A to G: section (Summary, Funnel, By referral, source, resume, track, ownership, role fit, or preference fit, or Drops by dealbreaker or setting, where Pay and Sponsorship count separately), item, count or applied, got a response, reached interviews, median days to response, share | Summary, then Funnel, then each breakdown |
| Employers (1) | employer: every watchlist employer, plus any company with research (`company.md`) that isn't on the watchlist | A to O: company, domain (a dropdown that also takes a new value), status (a dropdown: watching, manual, paused, or not watched), why, feed, screened (postings the scout has seen), shortlisted (postings tracked, archived included), applied, ownership, the three research scores (stability, growth, and the maturity field: company facts only), quick check, researched, verdict | By domain (none last), then company |
| Career (3) | role the user has held | A to J: employer, title, start, end, duration, location, work mode, track, type, scope | Newest first |

`node <tools>/sheet.mjs headers <tab>` prints a tab's header row, and `node <tools>/sheet.mjs rows <shortlist|scoutlog|history|stats|employers>` prints its data rows, already sorted and formatted for `update_values`.

**Editing the Employers tab:** it joins the scout's watchlist (`applications/watchlist.md`) with company research (`company.md`), one row per employer, so the user manages both in one place. They can:
- **Add an employer** by typing a new row (a company name, and a domain if they like). It arrives as `manual`, and the sync finds its feed.
- **Regroup** by changing Domain. Typing a new domain makes one.
- **Pause or resume** with Status (`paused`, or `watching`). A pause keeps the feed, so resuming picks up where it was.
- **Drop it from the watchlist** with Status `not watched`. Its research stays, and so does its row while it has research.
- **Delete a row** to pause it, or, if it was already paused, to drop it.

Rows are matched by company name, so sorting or filtering the tab is safe. `node <tools>/sheet.mjs pull-employers` turns these edits into watchlist changes (Sync step 2). Agent-side changes go the other way: when the user agrees in chat that an employer should be added, regrouped, or paused, make the change with `watchlist.mjs` (see the scout skill's The Watchlist), and the next sync shows it.

**How a posting moves:** a posting sits in the Shortlist while its latest event is a live stage. Once its latest event is an ending (from `/apply`, from `/scout` when the posting closes, or from the Status dropdown), the next sync moves it to History. A posting that never reached an application leaves History once its ending is older than `history_days`, and at the same time `prune` removes its folder from the workspace, leaving one line in `applications/data/archive.csv` so the stats still count it. A posting that reached an application stays in History and in the workspace for good, sorted with the rest by its most recent date. The Scout Log is separate: it shows every recent posting that passed the first screen, so the user can see what the scout dropped and why. Its rows drop off after `scout_log_days`, and `applications/data/seen.csv` keeps them as one line each, so the scout never shows the same posting twice.

**Contacts** (Shortlist and History) lists the user's LinkedIn connections at the posting's company: a count and the top three names and titles, from the optional `connections` skill. It's computed from the current import, so a new import changes those tabs' rows and the next sync rewrites them, and stays empty while that module is off. `sheet.mjs rows` prints the module's refresh nudge on stderr when the import is old. Pass it on once per session.

**Notes for changes made in the sheet** name the person, from `person.name`: "Passed by <first name> in the sheet", or "Set to <stage> by <first name> in the sheet" for other stages. The user can replace that with a real reason in History's Reason column. It's optional, and it helps tune the scout's screen.

## Sync (after every tracker run)

A routine sync reads only the cells the user may edit, and clears, writes, and reads back only the tabs whose rows have changed since the last sync.

1. **Check the filters.** Check each tab's `basicFilter` in `get_spreadsheet` (fields `sheets.properties.sheetId` and `sheets.basicFilter.range`). A tab with no filter, or one whose range doesn't start at A1 and run to row 1000 across every column, Record ID included, gets `node <tools>/sheet.mjs filters <tab>...` as one `update_spreadsheet` batch. Leave a correct filter alone: sending it again clears the user's filter choices.
2. **Pull the user's edits.** `node <tools>/sheet.mjs ranges` prints the ranges each pull reads: on each tab, only the columns that identify a row and the ones the user may edit, plus the Shortlist's header row. Read each one with `get_values`, and save each response, range included, as JSON in its own scratch file. A pull refuses files that leave out a column it needs or hold values from another tab.
   - **Statuses:** run `node <tools>/sheet.mjs pull <files>` with the Shortlist's files. If the header row has no Next column, stop and bring the sheet up to date first (Bringing an Existing Sheet Up to Date, in `layout.md` next to this file): `pull` refuses a header row that isn't the current layout, so a status can never land on the wrong posting. It lists each Status the user changed. Run it again with `--apply` to log each one as `YYYY-MM-DD | <stage> | <note>` in that posting.md, with the note described above (a pass also deletes `jd.md`, as in chat).
   - **Reasons:** run `node <tools>/sheet.mjs pull-history <files>` with History's files, then `--apply`. It saves each Reason the user typed as the note on that posting's ending event.
   - **The employer list:** run `node <tools>/sheet.mjs pull-employers <files>` with the Employers tab's file. It lists each add, domain change, pause, resume, and removal. Run it again with `--apply` to write them. It refuses a sync that would pause or remove more than a quarter of the list, which usually means a bad read: show the user the list and use `--force` only on their word. For each employer it added, find its feed (To Add an Employer, in the scout skill's `feeds.md`, starting with `node <tools>/discover.mjs board "<Company>"`), and set it with `watchlist.mjs set "<Company>" --source <source> --board <board> --why "<reason>"`. One with no feed stays `manual`, with its careers URL as the Board.

   Then run `node <tools>/sheet.mjs prune --apply`, which archives postings that ended more than `history_days` ago without an application and deletes their folders, and `node <tools>/tracker.mjs`. Report what was archived. Report any `[skipped]` row to the user rather than guessing. A reason stays with its posting: never start dropping or down-ranking other postings for it. If one sounds like a general rule, you may ask once whether to add it to the Dealbreakers or Preferences, and change the career direction file only when the user says yes.
3. **Find what changed:** run `node <tools>/sheet.mjs changed`. For each tab it says whether its rows differ from what the last sync recorded, and for each changed one, the range to clear, where to write, and the range to read back. Every tab counts as changed when there's no sync record yet, or the record is from an earlier layout or another sheet. A tab also counts when the last sync that set out to rewrite it never confirmed it, when a pull found it out of step with the workspace (a `[skipped]` row, a refused pull, or a different number of rows than the last sync wrote), and whenever its rows differ: the user's edits just pulled, a change made in the workspace, or rows a rolling window dropped because the date moved. Stats' Updated date alone doesn't count, so it shows the day the numbers last changed. When nothing changed, skip to step 7.
4. **Clear** each changed tab's old data rows' values, not their formatting (`batch_clear_values` with the ranges `changed` printed), so removed postings don't linger and the colors, banding, and dropdown stay.
5. **Write** each changed tab's rows at `A2` with `update_values`.
6. **Reset the dropdowns,** only when the Shortlist or the Employers tab was rewritten: send the `node <tools>/sheet.mjs dropdown <tab>...` that `changed` names as one `update_spreadsheet` batch. It puts the Shortlist's Status dropdown and the Employers tab's Domain and Status dropdowns on filled rows only, so empty rows show no arrows. A row the user just typed gets its dropdowns at the next sync that rewrites its tab, which a new employer row always causes.
7. **Read back** each rewritten tab (the range `changed` printed) and confirm the values match, then run `node <tools>/sheet.mjs synced`, also when nothing was written. It records what this sync wrote in `applications/data/sheet-sync.json`, and the next sync's pulls count a cell as the user's edit only when it differs from that record. A change made in the workspace between syncs (a stage, a reason, or a watchlist edit) is then never mistaken for an old value the user set in the sheet. Skip it when the read-back doesn't match, so the next pull compares with the workspace instead and the next sync rewrites those tabs again.
8. **With `drive.enabled`:** run `node <tools>/docs.mjs list`. A Doc whose posting has ended moves to the Archive folder (`update_file` with `parentId` set to `drive.archive_id`, then `docs.mjs record <key> --archived`), which costs nothing. A Doc marked "the workspace has changed since" isn't remade: mention it once, and remake it only if the user asks (`drive.md` next to this file).

**What a routine sync costs:** with nothing changed and nothing to pull, the filter check, five small reads (in the plugin's test workspace, about 100 characters per Shortlist or History row and 45 per employer), and no writes. Each changed tab adds its rows once to write and once to read back (about 200 to 270 characters per Shortlist, History, or Scout Log row there, and under 50 per Stats row). Real rows run longer, mostly in Why it's here and Contacts, so the saving grows with them.

**The trade-off:** a routine sync never reads the cells outside the editable columns, so a hand edit anywhere else is overwritten, unnoticed, at the next sync that rewrites that tab. Checking the Sheet (below) catches those.

**On a scheduled run** (the prompt says so, from a Desktop scheduled task): no one is watching. Pull and apply statuses, reasons, and employer edits as usual, but never use `--force`. A refused employer pull or a `[skipped]` row is left alone and listed in the report. Find feeds for added employers when `discover.mjs board` settles it, and leave the rest `manual`. Write only the tabs `changed` lists. End with a short report, which goes to the log.

## Checking the Sheet for Other Hand Edits (on request)

When the user asks to check the sheet, or when something looks wrong (a refused pull, a read-back that didn't match):

1. **Read** the whole tabs: `node <tools>/sheet.mjs ranges --full` prints them (Shortlist, History, and Employers, every column). The pulls take these files as well, so run them from these reads.
2. **Check for other hand edits.** Compare what's there with what the workspace says (`sheet.mjs rows <tab>`). If the user has changed values other than Status and Reason (and the Employers tab's Domain and Status) by hand, don't overwrite them silently. Show the differences and ask whether to apply them to the local records first. A changed row order alone isn't an edit, but keep the workspace's sort.
3. **Sync** with `node <tools>/sheet.mjs changed --all` for step 3, so every tab is rewritten from the workspace.

## Create, Update, and Format

Read `layout.md` next to this file to create a sheet for a workspace that has none (it creates a file in the user's Google Drive, so ask first), to bring an existing sheet up to date when `pull` refuses its header row, to add back a tab the user deleted, or before changing any formatting. It also holds the lessons learned about the sheet's formatting.

## Career Tab

The Career tab isn't generated by the tracker: it's kept from the default resume and the portfolio's role timeline, with resume-safe wording only. When a role fact changes (a title, dates, a location, or a new role), read `career-tab.md` next to this file.

## Drive Folder and Docs (optional, on request)

With `drive.enabled` true, the sheet lives in a Google Drive folder, and on request the folder holds a few Google Docs: Interview Prep and a packet for a posting. A Doc is made only when the user asks, never by a sync, because each Doc passes through the conversation in full. To set up the folder or make a Doc, read `drive.md` next to this file.
