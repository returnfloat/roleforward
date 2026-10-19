---
title: Scout Watchlist
updated: YYYY-MM-DD
---

# Scout Watchlist

The employers `/scout` checks every run. Ask Claude to add, move, or pause an employer, or edit the list in the sheet's Employers tab (add a row, or change Domain or Status), and the next sheet sync brings the change here. If you edit the table by hand, keep its five columns. A row whose Company starts with `~` is paused, and the scout skips it.

- **Source:** which kind of career site the employer uses (`greenhouse`, `ashby`, `lever`, `workday`, `talentbrew`, `eightfold`, `smartrecruiters`, `oracle`, `successfactors`, `icims`, `amazon`, `google`, `apple`), `page` (the fallback for any other careers site, through its job sitemap or a plain listing page), or `manual` for a reminder to check by hand. The `/scout` skill explains how to find each one's Board value.
- **Domain:** the employer's field, such as Fintech or Health. The sheet's Employers tab can be filtered by it.
- **Picked for:** <what makes an employer worth watching, for example location, field, and stability>.

## Watchlist

| Company | Source | Board | Why | Domain |
|---|---|---|---|---|
