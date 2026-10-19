---
name: resume
description: Maintains the workspace owner's career record and everything built from it. Use when the user wants to add an accomplishment or new material to their portfolio, change a resume line, title, date, or skill, draft or review a resume variant, render the resume PDF, update their LinkedIn copy, or check that the resume, portfolio, LinkedIn, website, and sheet are in sync.
---

# Resume and Career Record

## Working With the Workspace

- **The workspace** is the current folder (or the nearest parent with a `workspace.yaml`). From `workspace.yaml`, `files.portfolio` is the source of facts, `files.resume` is the default resume, `files.guide` holds the house rules and audit rubric, `files.linkedin` is the LinkedIn copy, and `person.file_stem` names the output files.
- **The workspace's own instructions win.** The workspace's `CLAUDE.md` (its standing instructions and sync rule) and `MEMORY.md` (status and preferences) override this skill where they conflict.
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory. Run them from the workspace root, for example `node <tools>/render.mjs`.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## How Facts Flow

1. **The portfolio is the only source of facts.** Every resume line, number, title, and date comes from a portfolio entry. New facts enter the portfolio first, with tags:
   - **Source:** Verified (checked against a system), Doc-sourced (a named document), Self-reported, or Relayed (secondhand).
   - **Scope:** Personal, Team-led, or Program-level. This decides how a result can be framed. A program-level number is never presented as personal output.
   - **Module tags on resume lines** (optional): track, area, and `[core]` or `[opt]`, used to assemble variants.

   Only numbers that appear inside a portfolio resume line are cleared for external use. Numbers that appear only in evidence or notes are informational.
2. **Disclosure rules live in the portfolio,** set during setup, for example no internal project names or confidential figures. Every output, public or private, follows them.
3. **The default resume** is reviewed line by line with the user. It isn't regenerated from scratch unless they ask. Edit it in place.

## Taking In New Material

When the user shares raw material (a performance review, a brag document, project notes, an old resume, a LinkedIn export, or just a story):

1. Extract candidate accomplishments, each as a situation, what the user did, the outcome, and the evidence behind it.
2. Ask about anything unclear: the era (which role it belongs to), the scope (personal, team, or program), the source, and what's confidential. Accuracy beats punch.
3. Add them to the portfolio with tags, plus an "if they probe" line for anything likely to come up in interviews.
4. Offer resume lines built with the XYZ pattern from the guide: the outcome, a measure (or concrete evidence when there's no honest number), then the action. Never suggest an estimated number. Give two to four options with a recommendation, and wait for the user's call before any line goes into a resume.

## The Sync Rule

A wording, fact, or style change applies everywhere in one pass, unless the user says to keep a place different. The workspace's `CLAUDE.md` holds the binding version, including any deliberate differences between places. The usual pass:

1. **Resume:** edit the default resume.
2. **Portfolio:** make the same change to the matching tagged line.
3. **LinkedIn** (if `linkedin.enabled`): make the same change in the LinkedIn file. Bullets mirror the resume, written in the first person and without the bold labels, and the About section and headline must stay factually consistent. Keep the paste-ready sections clean, with notes only in the file's instructions and change log.
4. **Variants:** fact changes also go to every standing variant in `variants/`. Wording changes don't carry over automatically, so ask. Per-job resumes under `applications/` are never synced, and frozen ones are never edited.
5. **Render:** run `node <tools>/render.mjs`, and confirm the PDF stays within `render.max_pages`. Read the PDF to check the contact line and layout. Re-render each variant that changed with `node <tools>/render.mjs variants/<name>.md`.
6. **Website** (if `website.enabled`): render writes `website/`. Deploying is the `website` skill's job and follows the workspace's deploy notes.
7. **Career tab:** if a role fact changed (a title, dates, a location, or a new role), update the sheet's Career tab (the `sheet` skill).
8. **Report:** tell the user exactly which LinkedIn sections to update, since they paste them by hand.

## Rendering

`node <tools>/render.mjs` turns the default resume into:
- `output/<stem>-Resume-Apply.pdf`, the application copy, with phone and email.
- `output/<stem>-Resume.txt`, a plain-text copy for pasting into forms. It's ASCII only, and the render fails if other characters slip in.
- The website files, when the website module is on.

The resume Markdown follows a shape the renderer reads: `# Name`, a contact line joined with ` · ` (it can include a GitHub or portfolio link), a bold headline, then `##` sections. Inside a section, `### Heading` starts a group (an employer, or a project), `**Title** · Location or link · Dates` is a role line, and `- **Label:** text` or `- text` is a bullet. The PDF and plain text show every section in order. The website places these by name:
- **Summary** (or Profile, About): optional. Leave it out and the site drops its About block.
- **Core Competencies** (or Skills, Technical Skills, Skills & Tools): bullets of comma-separated items, with or without bold labels.
- **Work Experience** (or Experience, Professional Experience).
- **Education & Recognition** (or Education, Education & Certifications).
- **Any other section,** such as Projects, Publications, or Open Source, goes in the site template's `{{EXTRA_SECTIONS}}` slot. A workspace's own template without that slot leaves them off the site, and the render prints a warning.

Never edit generated files by hand.

## Variants

- **What they are:** reviewed alternatives to the default, for a different target, such as a leadership lean or a technical lean. Each one is assembled from portfolio lines by their tags, with its own headline, summary, and competency order, following the recipes in the workspace's guide.
- **How they're made:** draft from the portfolio, then review line by line with the user, the same way the default was. Record `variant:` and `reviewed:` in the frontmatter.
- **Rendering:** `node <tools>/render.mjs variants/<name>.md` writes `output/variants/<stem>-Resume-<Name>.pdf` and `.txt`, and never touches the website.

## Before Calling Any Resume Final

Score it against the audit rubric in the workspace's guide (Y or N per item). The base rubric covers:
- **Bullets:** XYZ bullets with no duty language, proven by a number or concrete evidence, and the strongest result first in each role.
- **Metrics:** every metric traced to the portfolio, and no program numbers framed as personal output.
- **Layout:** single column, standard headers, a text-based PDF, and the page limit.
- **Keywords:** the target title in the headline, and keywords tied to real bullets.
- **Rules:** the workspace's house style rules and disclosure rules.
