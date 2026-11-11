# Setting Up Scheduled Runs

Read this when the user wants to turn scheduled runs on, change when they run, or stop them. The rules for a run that is itself scheduled are in the scout skill, under Scheduled Runs.

Run the scout on demand while the screen is being tuned. Once it's settled, the user can have it run on its own through **Claude Code Desktop's local scheduled tasks**: Desktop starts a fresh session in the workspace folder at the chosen time, with the user's files, plugins, and connectors. Nothing is installed on the computer itself. There are three tasks, all off by default: the scout, a sheet sync, and monthly discovery.

1. **Pick the frequency** with the user, and record it in `workspace.yaml` under `schedule.<job>` (`every`: daily, weekdays, weekly, or monthly, `day`, and `at`). Match the scout's to `scout.cadence`.
2. **Print the task's fields:** `node <tools>/schedule.mjs <job>` gives the name, description, instructions, folder, schedule, and permission mode.
3. **Create it:** in a Desktop session that has a scheduled-tasks tool, create the task with those fields after the user says yes. Otherwise, walk the user through it: the Code tab, then Routines, New routine, and Local, pasting the fields. A monthly schedule isn't a preset, so they ask Claude in any Desktop session to set it.
4. **Test it once:** Run now with the user watching, and choose "always allow" for each permission prompt (node scripts, the Google Sheets connector), so later runs don't stall waiting for approval.
5. **Record it:** set `schedule.<job>.enabled: true` and note the date in MEMORY.md. To pause or stop a task, the user toggles it in Routines (or asks Claude in Desktop), and `enabled` goes back to false.

Tasks run only while the Desktop app is open and the computer is awake. A missed run is made up once on wake, so a prompt can't assume the time of day. `/loop` doesn't fit, since it lives in one session and expires after a week, and neither do cloud routines, which can't see a local folder.
