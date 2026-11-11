# Finding New Employers (discovery)

The watchlist only covers employers the user already knows. When `scout.discover` lists a source, propose new ones, and add only the ones the user approves.

- **`hn`:** the monthly Hacker News "Who is hiring?" thread, posted on the first weekday of each month and read through HN's public API. Run `node <tools>/discover.mjs hn` once a month, after the new thread is up. It lists posts from employers not on the watchlist (or proposed before) that pass the same title and place screens as the scout, with the job board each post links to and its open postings.
- **Judge each one** against the Dealbreakers, as in the scout skill's step 7, and drop the wrong ones with `node <tools>/discover.mjs mark "<Company>" skipped "<reason>"`. Read the post through its HN link when the first line doesn't settle it.
- **Propose the rest** in the run report: company, roles, place, and its board, with a one-line reason. Never contact an employer, even when a post says "email us": that's the user's call.
- **On the user's OK,** add the employer (find a missing board with `node <tools>/discover.mjs board "<Company>" [<careers URL>]`, then the steps in `feeds.md`), and run `node <tools>/discover.mjs mark "<Company>" added`. A skipped employer isn't proposed again.
- **Other ways to find employers,** when the user asks: web searches for lists in their field and place (for example recent funding rounds, or "best places to work" lists from reputable outlets), checked with `discover.mjs board`. Sites that need a login or ban automated access are out, as for the scout.

`node <tools>/discover.mjs list` shows proposals still waiting for the user's call.
