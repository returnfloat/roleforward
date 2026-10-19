---
title: Standing Resume Variants
updated: YYYY-MM-DD
---

# Standing Resume Variants

The default resume stays the main one. It drives LinkedIn, the website, and general sends. The files here are reviewed, reusable alternatives for a different kind of target, and per-job resumes start from them.

- **<name>.md:** for <target>. Recipe "<recipe>" in the guide. Not drafted yet.

Each one is drafted from the portfolio and guide, then reviewed line by line with the user, the same way the default was. Its frontmatter carries `variant:` and `reviewed:` dates.

## Rendering

The plugin's `tools/render.mjs variants/<name>.md` writes `output/variants/<stem>-Resume-<Name>.pdf` and `.txt`, with phone and email. It never touches `website/`.

## Sync

- **Fact changes** (a number, title, date, scope, or location) go to the default, the portfolio, LinkedIn, the website, and every standing variant in the same pass. Re-render each variant.
- **Wording changes** to the default don't carry over automatically, since variant wording is deliberate. Ask whether the variant should follow.
- **Per-job resumes** under `applications/` are never synced. Once frozen, they stay exactly as submitted.
