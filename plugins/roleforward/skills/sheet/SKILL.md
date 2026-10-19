---
name: sheet
description: Creates and syncs the workspace owner's Google Sheet, a browser view of their job search and career record with Shortlist, Scout Log, History, Stats, Employers, and Career tabs. Use after any change to application records or the watchlist (the apply and scout skills call for it), when the user says they changed a status or the employer list in the sheet, when they ask to set up, fix, restyle, or check their tracking sheet, or when a role fact changes and the Career tab needs updating.
---

# Tracking Sheet

The sheet mirrors the workspace. The local records are the source, and the sheet is overwritten from them, with three exceptions the user may edit: the Shortlist's **Status** dropdown, History's **Reason** column, and the **Employers** tab's Domain and Status columns, plus new rows there (the watchlist). When the user picks a status (for example `passed`), types a reason, or adds, regroups, pauses, or drops an employer, the next sync saves it in the workspace before anything is overwritten. It needs the Google Sheets connector (and Google Drive to create a new sheet). Before any Google write, load the google-workspace skill if it's available, and follow its Sheets reference: read before writing, guard against hand edits, and verify after.

## Working With the Workspace

- **The sheet's ID and tab IDs** are in `workspace.yaml` under `sheet`. If they're missing, the workspace has no sheet yet (see Create below).
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory. `node <tools>/sheet.mjs` builds rows, headers, and formatting, and never talks to Google itself. Run it from the workspace root after `node <tools>/tracker.mjs`.
- **Rolling windows** in `workspace.yaml`: `sheet.scout_log_days` (14 if unset) for the Scout Log, and `sheet.history_days` (30 if unset) for History and for pruning old records.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## Tabs

| Tab (sheetId) | One row per | Columns | Order |
|---|---|---|---|
| Shortlist (0) | live posting, a role judged a good fit (shortlisted, interested, applied, or any interview stage) | A to O: company, role, status (a dropdown of every stage), role fit, preference fit (the two scores from `fit.mjs`, never blended), last event, applied, track, resume, source, referral (blank while the posting is only shortlisted, since it's asked when the user marks it interested), why it's here, contacts, posting link, and a muted Record ID at the far right (the posting's folder under `applications/`) | The lower of the two scores first, then the higher, then newest event |
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

**Contacts** (Shortlist and History) lists the user's LinkedIn connections at the posting's company: a count and the top three names and titles, from the optional `connections` skill. It's computed from the current import at every sync, and stays empty while that module is off. `sheet.mjs rows` prints the module's refresh nudge on stderr when the import is old. Pass it on once per session.

**Notes for changes made in the sheet** name the person, from `person.name`: "Passed by <first name> in the sheet", or "Set to <stage> by <first name> in the sheet" for other stages. The user can replace that with a real reason in History's Reason column. It's optional, and it helps tune the scout's screen.

## Sync (after every tracker run)

1. **Check the filters.** Check each tab's `basicFilter` in `get_spreadsheet` (fields `sheets.properties.sheetId` and `sheets.basicFilter.range`). A tab with no filter, or one whose range doesn't start at A1 and run to row 1000 across every column, Record ID included, gets `node <tools>/sheet.mjs filters <tab>...` as one `update_spreadsheet` batch. Leave a correct filter alone: sending it again clears the user's filter choices.
2. **Pull status changes.** Read `Shortlist!A2:O1000`, save the values as JSON in a scratch file, and run `node <tools>/sheet.mjs pull <file>`. It lists each Status the user changed. Run it again with `--apply` to log each one as `YYYY-MM-DD | <stage> | <note>` in that posting.md, with the note described above (a pass also deletes `jd.md`, as in chat). Then do the same for reasons: read `History!A2:N1000`, run `node <tools>/sheet.mjs pull-history <file>`, then `--apply`. It saves each Reason the user typed as the note on that posting's ending event. Then the employer list: read `Employers!A2:O1000`, save it as JSON, and run `node <tools>/sheet.mjs pull-employers <file>`. It lists each add, domain change, pause, resume, and removal. Run it again with `--apply` to write them. It refuses a sync that would pause or remove more than a quarter of the list, which usually means a bad read: show the user the list and use `--force` only on their word. For each employer it added, find its feed (the scout skill's To Add an Employer, starting with `node <tools>/discover.mjs board "<Company>"`), and set it with `watchlist.mjs set "<Company>" --source <source> --board <board> --why "<reason>"`. One with no feed stays `manual`, with its careers URL as the Board. Then run `node <tools>/sheet.mjs prune --apply`, which archives postings that ended more than `history_days` ago without an application and deletes their folders, and `node <tools>/tracker.mjs`. Report what was archived. Report any `[skipped]` row to the user rather than guessing. A reason stays with its posting: never start dropping or down-ranking other postings for it. If one sounds like a general rule, you may ask once whether to add it to the Dealbreakers or Preferences, and change the career direction file only when the user says yes.
3. **Read** the rest of the Employers tab too (its research columns), for the hand-edit check.
4. **Check for other hand edits.** Compare what's there with what the workspace says. If the user has changed values other than Status and Reason by hand, don't overwrite them silently. Show the differences and ask whether to apply them to the local records first. A changed row order alone isn't an edit, but keep the workspace's sort.
5. **Clear** the old data rows' values, not their formatting (`batch_clear_values` on `Shortlist!A2:O1000`, `'Scout Log'!A2:I1000`, `History!A2:N1000`, `Stats!A2:G1000`, and `Employers!A2:O1000`), so removed postings don't linger and the colors, banding, and dropdown stay.
6. **Write** each tab's rows at `A2` with `update_values`.
7. **Reset the dropdowns:** send `node <tools>/sheet.mjs dropdown` as one `update_spreadsheet` batch. It puts the Shortlist's Status dropdown and the Employers tab's Domain and Status dropdowns on filled rows only, so empty rows show no arrows. A row the user just typed gets its dropdowns at the next sync.
8. **Read back** and confirm the values match, then run `node <tools>/sheet.mjs synced`. It records what this sync wrote in `applications/data/sheet-sync.json`, and the next sync's pulls count a cell as the user's edit only when it differs from that record. A change made in the workspace between syncs (a stage, a reason, or a watchlist edit) is then never mistaken for an old value the user set in the sheet. Skip it when the read-back doesn't match, so the next pull compares with the workspace instead.

**On a scheduled run** (the prompt says so, from a Desktop scheduled task): no one is watching. Pull and apply statuses, reasons, and employer edits as usual, but never use `--force`. A refused employer pull, a `[skipped]` row, or other hand edits (step 4) are left alone and listed in the report. Find feeds for added employers when `discover.mjs board` settles it, and leave the rest `manual`. End with a short report, which goes to the log.

## Career Tab

- **Its own source:** it isn't generated by the tracker. Its source is the role lines in the default resume plus the portfolio's role timeline, and the scope column uses only resume-safe wording (no internal names).
- **When to update:** through the workspace's sync rule, whenever a role fact changes (a title, dates, a location, or a new role).
- **Dates:** start and end are real dates written as `YYYY-MM-01` and shown as "mmm yyyy". End is `Present` for a current role.
- **Duration:** a formula from `node <tools>/sheet.mjs career-formula <row>`. It shows "3Y 6M", or "2M" when it's under a year. Leave that column's number format on automatic, never Text, or new formulas get stored as text.

## Create (a workspace without a sheet)

1. **Ask first.** It creates a file in the user's Google Drive. Name it after the user, for example "<Name> Career Planning".
2. **Create** a blank spreadsheet with Drive `create_file` (mime type `application/vnd.google-apps.spreadsheet`). Its first tab is sheetId 0.
3. **Add the tabs:** send `node <tools>/sheet.mjs setup` as one `update_spreadsheet` batch. It renames the first tab to Shortlist, adds Scout Log, History, Stats, Employers, and Career with fixed sheetIds, and applies the styling:
   - A header row in the workspace's colors (`theme.primary` and `theme.accent`), with banding, a frozen header row (no frozen columns), and no gridlines.
   - Status, scout call, outcome, and employer status colors, and red-to-green shading for scores.
   - The muted Record ID columns on Shortlist and History. The Status dropdown is added at each sync (step 7), on filled rows only.
   - Automatic row heights.
   - A sort-and-filter header on every tab, covering every column.
4. **Write** each tab's header row, then sync.
5. **Save** `sheet.spreadsheet_id`, `sheet.title`, and `sheet.tabs` to `workspace.yaml`, and give the user the link.

## Lessons Already Learned

- **Inserting a column stretches neighboring conditional-format ranges.** Re-read the rules and reset their ranges after any insert.
- **Dropdowns cover filled rows only, on every tab.** Never pad them with spare rows for new entries: arrows on empty rows look like data is missing. `sheet.mjs dropdown` clears each dropdown column and resets it to exactly the rows written, so send it at every sync, and check after any new dropdown that its last row matches the last filled row.
- **Only the header row gets a fixed height.** A fixed pixel height on data rows turns off fit-to-content, and wrapped text gets cut off.
- **Dates are written as text** (a leading apostrophe), so Sheets doesn't reformat them. Fit and score columns are numbers, so the shading works.
- **Sorting and filtering go through each tab's filter.** It covers every column, so a sort moves the Record ID with its row. The sync writes rows in the workspace's order, so a sort the user makes lasts until the next sync, while filter choices stay. Sheets doesn't re-run a filter when values change, so after a sync a filtered tab can show rows that no longer match until the user reapplies it.
- **Keep the user's sort.** If they sort a tab themselves, ask whether to make it the default, and record it here in the workspace's notes. A sort that leaves out the Record ID column misaligns it, and `pull` then skips those rows instead of moving a status onto the wrong posting.
