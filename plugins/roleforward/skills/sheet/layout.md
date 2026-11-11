# Creating, Updating, and Formatting the Sheet

Read this when creating a sheet for a workspace that has none, when the Shortlist's header row is from an earlier layout (`pull` says so), when adding back a tab the user deleted (`sheet.mjs add-tab <tab> [index]`), or when changing the sheet's formatting. A routine sync needs none of it.

## Create (a Workspace Without a Sheet)

1. **Ask first.** It creates a file in the user's Google Drive. Name it after the user, for example "<Name> Career Planning".
2. **Create** a blank spreadsheet with Drive `create_file` (mime type `application/vnd.google-apps.spreadsheet`). Its first tab is sheetId 0.
3. **Add the tabs:** send `node <tools>/sheet.mjs setup` as one `update_spreadsheet` batch. It renames the first tab to Shortlist, adds Scout Log, History, Stats, Employers, and Career with fixed sheetIds, and applies the styling:
   - A header row in the workspace's colors (`theme.primary` and `theme.accent`), with banding, a frozen header row (no frozen columns), and no gridlines.
   - Status, scout call, outcome, and employer status colors, and red-to-green shading for scores.
   - The muted Record ID columns on Shortlist and History. The Status dropdown is added by the sync (its dropdown step), on filled rows only.
   - Automatic row heights.
   - A sort-and-filter header on every tab, covering every column.
4. **Write** each tab's header row, then sync, running `node <tools>/sheet.mjs changed --all` for its changed step so every tab is written.
5. **Save** `sheet.spreadsheet_id`, `sheet.title`, and `sheet.tabs` to `workspace.yaml`, and give the user the link.

## Bringing an Existing Sheet Up to Date

An existing sheet keeps working, but a column added to a tab has to be added to the user's sheet once. When the Shortlist's header row, read in the sheet skill's Sync step 2, lacks **Next** (column G, right after Last event), add it before anything else:

1. **Save the header row** (`Shortlist!A1:P1`) as JSON in a scratch file.
2. **Count the Shortlist's conditional format rules** with `get_spreadsheet` (fields `sheets.properties.sheetId` and `sheets.conditionalFormats`, sheetId 0). Ask for the whole spreadsheet, not a range: with a range, only the rules that touch it come back, and the count is too low. The update deletes them all and adds the standard ones again, so if the user added rules of their own, list them first and ask.
3. **Run** `node <tools>/sheet.mjs upgrade <file> --rules <count>` and send its output as one `update_spreadsheet` batch. It inserts the column after Last event, writes its header, gives it its own width and left-aligned, wrapped text (the insert copies Last event's centered format), resets the tab's conditional formats (an insert stretches neighboring ranges), and sets the filter again over every column, which clears the user's filter choices once. It prints `[]` when the sheet is already current.
4. **Read back** the header row and the conditional formats to confirm, tell the user in one line what changed, and carry on with the sync from step 2. `upgrade` marks the Shortlist for the next sync, so `sheet.mjs changed` lists it and the sync rewrites every row in the new layout.

## Lessons Already Learned

- **Inserting a column stretches neighboring conditional-format ranges.** Re-read the rules and reset their ranges after any insert.
- **Dropdowns cover filled rows only, on every tab.** Never pad them with spare rows for new entries: arrows on empty rows look like data is missing. `sheet.mjs dropdown` clears each dropdown column and resets it to exactly the rows written, so send it whenever a sync rewrites the Shortlist or the Employers tab, and check after any new dropdown that its last row matches the last filled row.
- **Only the header row gets a fixed height.** A fixed pixel height on data rows turns off fit-to-content, and wrapped text gets cut off.
- **Dates are written as text** (a leading apostrophe), so Sheets doesn't reformat them. Fit and score columns are numbers, so the shading works.
- **Sorting and filtering go through each tab's filter.** It covers every column, so a sort moves the Record ID with its row. The sync writes rows in the workspace's order, so a sort the user makes lasts until the next sync that rewrites that tab, while filter choices stay. Sheets doesn't re-run a filter when values change, so after a sync a filtered tab can show rows that no longer match until the user reapplies it.
- **Keep the user's sort.** If they sort a tab themselves, ask whether to make it the default, and record it here in the workspace's notes. A sort that leaves out the Record ID column misaligns it, and `pull` then skips those rows instead of moving a status onto the wrong posting.
