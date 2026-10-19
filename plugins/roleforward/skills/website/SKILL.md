---
name: website
description: Optional personal website built from the workspace owner's default resume. Use when the user wants a personal site, wants to change its design or colors, preview themes, check what the site shows, or publish an update. Renders locally, and never deploys or changes hosting without the user's approval.
---

# Personal Website

## Working With the Workspace

- **Settings:** the `website` section of `workspace.yaml`.
  - `enabled` turns the module on.
  - `domain` and `url` are the site's address.
  - `template` is the workspace's own page template. When it's missing, the plugin's `templates/site-template.html` is used.
  - `themes` is a folder of alternative templates for previews.
  - `initials` (for the icon) and `location_line` (for the share card).
- **Colors** come from the `theme` section (`primary` and `accent`), shared with the tracking sheet and usually chosen during onboarding.
- **Deployment notes** live in the workspace, usually in `MEMORY.md`. They cover the host, accounts, and commands. They're the user's own setup, so never guess them, and never assume a particular host.
- **Scripts** live in the plugin's `tools/` folder, two levels above this skill's base directory.
- **Setup trouble:** when a script fails in a way that points to setup (no Chrome, a setting it can't read, a source the scout doesn't know), run `node <tools>/doctor.mjs` (`<tools>` is the plugin's `tools/` folder). It checks Node, Chrome, `workspace.yaml` against every setting the plugin reads, the files it names, the career direction file, and the watchlist, and changes nothing. Fix what it calls a problem before going on.

## What the Site Gets

When the module is on, `node <tools>/render.mjs` writes `website/`:
- `index.html`, from the template.
- A web copy of the resume PDF, with no phone or email.
- Icons, a 1200x630 share image, `robots.txt`, `sitemap.xml`, and `404.html`.

Privacy is built in. The page never contains the email as text, since it's assembled only on click. The web PDF has no phone or email. Never add a photo unless the user asks.

## Choosing a Design (first setup, or "I want a new look")

Don't impose a design. Narrow it down with the user in a few short rounds, using real previews of their own resume.

1. **Ask a few preference questions first,** using the question tool where available, with two to four options each:
   - **The feel:** polished and corporate, editorial and calm, bold and modern, or technical.
   - **What should stand out:** the summary, the experience, or the competencies.
   - **Colors to avoid:** for example, a current employer's brand colors. A personal site in an employer's colors can look like corporate branding, or signal a job search.
   - **Whether a photo is wanted.** The default is no photo.
2. **Build three distinct layouts** as templates in the workspace's `website.themes` folder (default `site/themes/`). Start from the plugin's `templates/site-template.html` (an executive sidebar layout), and write two clearly different alternatives, for example a single-column editorial page and a dark technical page.
   - **Keep every placeholder** (listed under Changing the Look below).
   - **Keep the privacy rules:** the email is assembled on click only, and there's no phone number.
   - **Keep it responsive:** it must work at phone width, with a 16px gutter and no horizontal scroll.
3. **Render and show them:** run `node <tools>/render.mjs --previews`. That writes each theme to `previews/` as HTML plus desktop and phone screenshots. Look at the screenshots, then show them to the user (or give the file paths), with one line on what each design emphasizes.
4. **Narrow the palette** once a layout is chosen. Start from the workspace's `theme` colors, and offer three or four palettes as hex pairs (`primary` and `accent`), checked for contrast, by writing a copy of the chosen theme per palette and re-running previews. Respect the colors the user wants to avoid.
5. **Apply the choice:**
   - Copy the chosen theme to `website.template` (for example `site/site-template.html`).
   - Set `theme.primary` and `theme.accent` in `workspace.yaml` (the sheet uses them too), and run `node <tools>/render.mjs`.
   - Record the choice and the rejected options in MEMORY.md, so later sessions don't re-litigate it.
   - Delete `previews/` once the user is done comparing.

## Changing the Look

- **Template placeholders:** `{{NAME}}`, `{{HEADLINE}}`, `{{TAGLINE}}`, `{{SUMMARY}}`, `{{COMPETENCIES}}`, `{{EXPERIENCE}}`, `{{EDUCATION}}`, `{{EXTRA_SECTIONS}}` (Projects, Publications, and any other resume section), `{{EMAIL_CODES}}`, `{{PDF}}`, and `{{YEAR}}`. Keep every one of them in a new design. `{{COMPETENCIES_TITLE}}` and `{{EDUCATION_TITLE}}` take the resume's own section names (Skills, say), and `{{LINKEDIN}}` and `{{GITHUB}}` buttons disappear when `website.linkedin` or `website.github` is unset.
- **Missing parts:** a line holding `{{SUMMARY}}`, `{{COMPETENCIES}}`, `{{EDUCATION}}`, or `{{EXTRA_SECTIONS}}` is removed when the resume has nothing for it, so keep each of those placeholders on the same line as its heading and wrapper.
- **Comparing designs:** put alternative templates in the `themes` folder, then run `node <tools>/render.mjs --previews` to render each one into `previews/` without touching `website/`.
- **Palette:** colors come from `theme.primary` and `theme.accent` in `workspace.yaml`. The page template has its own palette line, so keep the two in step.
- **Checking:** check phone width (a 16px side gutter and no horizontal scroll), plus light and dark modes if the template supports them.

## Publishing

- **Content updates** (a re-rendered page or PDF): follow the workspace's deploy notes, then verify the live site matches the local files. Deploy only files that changed.
- **Hosting changes** (a new domain, bucket, DNS, CDN, or access policy): back up first, show a dry run and a full plan, and change nothing until the user approves.
- **A user with no hosting yet:** follow Hosting Setup below.

## Hosting Setup (guided, first time)

The site is a folder of static files (`website/`), so any static host works. Walk the user through it one step at a time, and let them make each choice. They create accounts and enter payment details themselves; never do either for them.

1. **Decide whether it goes live now.** The rendered site works locally, so publishing can wait. Ask before going further.
2. **The address.** Ask whether they own a domain.
   - **No domain:** offer to start on the host's free address (for example `<name>.github.io` or `<name>.pages.dev`) and add a domain later, or to buy one now from a registrar (a .com is usually around $10 to $20 a year; check current prices).
   - **A domain:** note where it's registered and where its DNS is managed, since step 5 changes DNS records there.
3. **The host.** Explain three or four options in plain terms, with what each needs and roughly what it costs, and recommend the simplest one that fits:
   - **GitHub Pages:** free for a public repository. Needs a GitHub account and git.
   - **Cloudflare Pages or Netlify:** free tiers, with drag-and-drop or command-line deploys and automatic HTTPS.
   - **A cloud storage bucket behind a CDN** (for example AWS S3 with CloudFront or Cloudflare): pennies a month, with the most setup and the most control.
   Check current free-tier terms on the host's own site before recommending one, since they change.
4. **First deploy.** Use the host's own deploy route. If it needs a command-line tool, say what it is, its size, and where it installs, and wait for an OK. Upload only the contents of `website/`, never anything else in the workspace.
5. **Connect the domain,** if they have one: add the DNS records the host asks for, wait for HTTPS to come up, and decide with them whether `www` redirects to the bare domain or the other way around.
6. **Check it live:** load the site, compare the live files with the local ones, and check the PDF link, the 404 page, and phone width.
7. **Write the deploy notes** into the workspace's MEMORY.md: the host, the account (never passwords or keys), where DNS lives, and the exact commands or steps for a content update. Later updates follow these notes.
