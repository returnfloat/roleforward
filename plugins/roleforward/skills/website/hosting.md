# Hosting Setup (guided, first time)

Read this when the user has no hosting yet and wants the site to go live. The website skill's Publishing rules still hold: change nothing about hosting until the user approves.

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
