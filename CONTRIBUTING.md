# Contributing to RoleForward

Thanks for helping. RoleForward is a Claude Code plugin made of skills (Markdown instructions), Node scripts with no npm packages, and templates. This guide covers the repository layout, the tests, adding a job source, and the one rule that matters most: no personal data.

## Layout

- `plugins/roleforward/`: the plugin itself, the only folder users install. Skills in `skills/`, scripts in `tools/`, templates in `templates/`, and the place list in `data/`.
- `tests/`: the test suite, outside the plugin so users never get it.
- `scripts/`: developer scripts, such as `build-places.mjs`, which rebuilds `data/places.json` from Natural Earth's public-domain data.
- `README.md`: what GitHub shows. `plugins/roleforward/README.md` must be an identical copy, since an installed plugin holds only its own folder. A test checks this.

## Running the Tests

```
node --test
```

From the repository root, with Node 18 or later. The suite runs offline in about ten seconds: it builds a placeholder workspace in a temporary folder for each test and answers every job-site request from synthetic responses, so nothing reaches a real site. The render tests need Chrome, Chromium, Edge, or Brave, and skip themselves when none is installed. Set `ROLEFORWARD_KEEP_FIXTURE=1` to keep the temporary workspaces for a look.

Every change brings its tests with it:
- A new or changed tool, command, or setting gets tests.
- A bug fix gets a test that fails without the fix.
- A known problem not fixed yet is a `todo` test.

`tests/consistency.test.mjs` checks the parts that must agree: every source type has a feed, a detail reader, a feed test, and a mention in the docs; every setting a tool reads is in the doctor's schema; and every tool has tests.

## Adding a Job Source

A source is one kind of job system that many employers share, such as Greenhouse or Workday.

1. **Read the live site first.** Fetch one real listing and one real job, and note the structure: field names, paging, totals, date formats, and what a job that no longer exists returns (a 404, an empty result, a redirect). Request a job ID that doesn't exist to see it.
2. **In `plugins/roleforward/tools/scout.mjs`:** a fetcher in `FEEDS` (search sources stop at a fixed number of the newest postings), a branch in `detail()` for `show` and `capture`, and the closure check in `checkTarget()` and `postingState()`.
3. **Elsewhere:** the source name in the doctor's `SOURCES` (`tools/doctor.mjs`), the source table in the scout skill, the watchlist template's source list, and the README's list of supported job systems.
4. **Tests:** a synthetic response in `tests/feed-responses.mjs` that copies the live structure with every value a placeholder, an employer for it in `WATCHLIST`, and its "gone" answer. Then run `node --test`.
5. **Live check:** add one real employer to a scratch workspace's watchlist and run `node <plugin>/tools/scout.mjs validate`.

## Keep Personal Data Out

RoleForward handles people's career records, so the repository must never hold anyone's:
- Test data stays plainly placeholder: "Test Candidate", "Employer A", `example.invalid` addresses, and invented numbers. Never real people, real employers' posting text, or a real person's details, even made up.
- Synthetic job-site responses copy a site's structure, never its content.
- Never commit a workspace, a resume, a LinkedIn export, a `Connections.csv`, or a `contacts/` folder.
- Commit with an identity you're happy to make public. GitHub's noreply address keeps your email private.

## Style

- Plain, specific English in skills and docs, written for people who aren't developers.
- Node's standard library only, no npm packages, and code that runs on macOS, Windows, and Linux.
- Follow the comment style of the file you're editing.
