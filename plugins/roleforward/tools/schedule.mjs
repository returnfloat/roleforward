#!/usr/bin/env node
// Scheduled runs through Claude Code Desktop's local scheduled tasks (Code tab, Routines, New routine, Local). Desktop
// starts a fresh session in the workspace folder at the chosen time, with the user's files, plugins, and connectors, so
// nothing is installed on the computer itself: no cron, no launchd. Tasks run while the Desktop app is open and the
// computer is awake, and a missed run is made up once when it wakes.
//
// This script changes nothing. It prints each task's fields from workspace.yaml `schedule.<job>`, ready for Claude to
// create in a Desktop session (which has a scheduled-tasks tool) or for the user to paste into the New routine form.
// `schedule.<job>.enabled` records which tasks the user has set up, since Desktop holds the live schedule.
//
// Usage (run from inside the workspace):
//   node <plugin>/tools/schedule.mjs [<job>] [--json]   the fields for every job, or one (scout, sheet, discover)

import { basename } from 'node:path';
import { loadWorkspace } from './workspace.mjs';

const { root, get } = loadWorkspace();
const fail = (msg) => { console.error(msg); process.exit(1); };

// A scheduled run has no one watching, so each prompt says so, and the skills follow their "scheduled run" rules:
// no questions, nothing outward beyond the user's own sheet, and a report at the end.
const UNATTENDED = 'This is a scheduled run with no one watching: never ask questions or wait for an answer, and follow the skill\'s rules for scheduled runs. End with the report.';
export const JOBS = {
  scout: { description: 'Weekly job scout: search the watchlist, screen, shortlist, and sync the sheet',
    defaults: { every: 'weekly', day: 'mon', at: '07:00' }, prompt: `/roleforward:scout ${UNATTENDED}` },
  sheet: { description: 'Sheet sync: bring in edits made in the Google Sheet, then refresh it',
    defaults: { every: 'daily', at: '12:30' }, prompt: `/roleforward:sheet Sync the sheet. ${UNATTENDED}` },
  discover: { description: 'Monthly employer discovery: propose new employers for the watchlist (never adds them)',
    defaults: { every: 'monthly', day: 3, at: '08:00' }, prompt: `/roleforward:scout Run only Finding New Employers (discovery) and leave every proposal for the user. ${UNATTENDED}` },
};
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function spec(name) {
  const j = JOBS[name], c = get(`schedule.${name}`, {}) || {};
  const o = { ...j.defaults, ...c };
  if (!/^\d{1,2}:\d{2}$/.test(String(o.at))) fail(`schedule.${name}.at must be a time like "07:30", not "${o.at}".`);
  const at = String(o.at).padStart(5, '0');
  let schedule, preset = true;
  if (o.every === 'daily') schedule = `Daily at ${at}`;
  else if (o.every === 'weekdays') schedule = `Weekdays at ${at}`;
  else if (o.every === 'weekly') {
    const d = DAYS.indexOf(String(o.day).slice(0, 3).toLowerCase());
    if (d < 0) fail(`schedule.${name}.day must be a weekday (mon to sun) for a weekly job.`);
    schedule = `Weekly on ${FULL[d]} at ${at}`;
  } else if (o.every === 'monthly') {
    if (!(+o.day >= 1 && +o.day <= 28)) fail(`schedule.${name}.day must be 1 to 28 for a monthly job.`);
    schedule = `Monthly on day ${+o.day} at ${at}`; preset = false;
  } else fail(`schedule.${name}.every must be daily, weekdays, weekly, or monthly.`);
  return { job: name, enabled: c.enabled === true, name: `roleforward-${name}`, description: j.description, instructions: j.prompt,
    folder: root, schedule, preset, permission_mode: 'Accept edits', worktree: false };
}

const args = process.argv.slice(2), json = args.includes('--json'), pick = args.find((a) => !a.startsWith('--'));
if (pick && !JOBS[pick]) fail(`Unknown job "${pick}" (${Object.keys(JOBS).join(', ')}).`);
const specs = (pick ? [pick] : Object.keys(JOBS)).map(spec);
if (json) console.log(JSON.stringify(specs, null, 2));
else {
  for (const s of specs) {
    console.log(`${s.name} (${s.enabled ? 'set up' : 'off'})
  Description:     ${s.description}
  Instructions:    ${s.instructions}
  Folder:          ${s.folder}
  Schedule:        ${s.schedule}${s.preset ? '' : ' (not a preset: ask Claude in a Desktop session to set it)'}
  Permission mode: ${s.permission_mode}, then Run now once and choose "always allow" for each prompt
  Worktree:        off (${basename(root)} isn't a code repository)
`);
  }
  console.log('Create these in Claude Code Desktop: Code tab, Routines, New routine, Local. They run while the app is open and the computer is awake.');
}
