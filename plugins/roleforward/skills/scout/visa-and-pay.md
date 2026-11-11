# The Sponsorship and Pay Checks

Read this when `targets.visa.needs_sponsorship` is true or `targets.pay.min` is set. Both are settings of their own, separate from the Dealbreakers and Preferences, and neither changes a score. Each drop reason starts with the setting's name (Sponsorship or Pay), so the Stats tab counts them separately.

## Screening (step 7)

- **Sponsorship, only when `targets.visa.needs_sponsorship` is true:** load every posting that passes the other screens with `node <tools>/scout.mjs show <key>`, which adds a "Sponsorship check" line (what the description says, quoted) and a "Sponsor history" line (the employer's H-1B approvals in USCIS data). Drop "says no sponsorship" ("Sponsorship: no visa sponsorship") and "requires citizenship or a clearance" ("Sponsorship: citizens only"). Keep "not mentioned", which is common. If `applications/data/sponsors.csv` doesn't exist yet, run `node <tools>/visa.mjs fetch` first (about 7 MB from uscis.gov, so say so the first time). Its files stop at fiscal year 2023. For newer years, the user can export a CSV from the USCIS H-1B Employer Data Hub (Crosstab view, then Download) and run `node <tools>/visa.mjs import <file>`. `node <tools>/visa.mjs status` shows which years are loaded.
- **Pay, only when `targets.pay.min` is set:** `node <tools>/scout.mjs show <key>` adds a "Pay check" line. Drop only when it says "drop" (the top of the range is more than `drop_below` percent under the floor), with the reason "Pay: <the check line>". A range below the floor but within that margin stays: put the check line in the triage note. When no pay is published, follow `targets.pay.unlisted`: `keep` (the default) keeps it and says so in the triage note, and `drop` drops it ("Pay: not published").

## Shortlisting (step 9)

- **Sponsorship, only with the visa module:** fill the Triage table's Sponsorship row from the two `show` lines. When the history names similar filing names, judge which belong to the employer (a subsidiary that files for it does, an unrelated business with a similar name doesn't), and suggest adding the ones that belong under `targets.visa.aliases`. No record at all is a risk to note, not a reason to drop: the employer may file under a parent's name, or have never been asked. When ranking, a posting from an employer with a steady sponsorship record beats an equal fit without one.
