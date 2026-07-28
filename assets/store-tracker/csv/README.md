# Store-stats source CSVs

Raw exports from **Microsoft Partner Center → Analytics → Acquisitions**, kept
here as the versioned source of truth behind [`../data/`](../data/) and the
[Store Stats page](../../../store-stats.html). Nothing on the page is invented —
every number traces to a line in these files.

| File | App (Store ID) | Report |
|------|----------------|--------|
| `manimstudio-funnel.csv` | ManimStudio (`9NZFT55DVCBS`) | Acquisition funnel |
| `manimstudio-installs-weekly.csv` | ManimStudio (`9NZFT55DVCBS`) | Installs over time |
| `manimstudio-pageviews-weekly.csv` | ManimStudio (`9NZFT55DVCBS`) | Page views over time — optional, not yet exported |
| `tsne-funnel.csv` | t-SNE Visualization (`9P969D6N7P6J`) | Acquisition funnel |
| *(none yet)* | t-SNE Visualization | Installs / page views over time — optional, not yet exported |
| `generalized-covariance-funnel.csv` | Generalized Covariance Matrix (`9NZJ475S7B01`) | Acquisition funnel |
| *(none yet)* | Generalized Covariance Matrix | Installs / page views over time — optional, not yet exported |

Funnel CSVs are `"Category","Count"`: First time launches, **Successful installs
(= downloads)**, Install attempts, Page views. The installs-over-time and
page-views-over-time CSVs are both `"Date","All"`, at whatever granularity
(day / week / month) the Acquisitions trend chart's dropdown was set to when
exported — the site infers which from the actual date gaps rather than
assuming one. Page views over time is the same export with the trend chart's
*metric* dropdown switched to "Page views" first.

**Every trend chart is optional per app.** The store-stats page only shows a
chart for an app once at least one over-time series exists for it, and only
offers the Installs/Page-views selector once *both* exist. Today that's true
for ManimStudio only — t-SNE and Generalized Covariance Matrix have no
over-time export yet, so they show the funnel but no chart. Nothing is
invented to fill that gap.

**To get all three apps charted:** for each app, open Partner Center →
Analytics → Acquisitions, and export the trend chart (Installs, then
optionally switch to Page views and export again) into `~/Downloads`, in the
same ManimStudio → t-SNE → Generalized Covariance Matrix order used for the
funnel CSVs — Partner Center's own base-name + ` (1)` + ` (2)` suffixing
matches `scripts/build_store_stats_from_csv.py`'s `APPS` list against that
order. Then run the script; it picks up whichever of the (fully optional)
installs/page-views files are present and leaves the rest untouched.

**Window:** last 12 months, exported 2026-07-29. Only the three funnel CSVs
were re-exported this round, so `manimstudio-installs-weekly.csv` and its
trend chart still reflect the 2026-07-17 export until the next full refresh.

**To refresh:** re-export from Partner Center into `~/Downloads` (app order
above), then run `python3 scripts/build_store_stats_from_csv.py` to rebuild
`../data/`. Automated pulls need a Microsoft Entra app, which a personal
Microsoft account doesn't have — so this is a hand-read snapshot.
