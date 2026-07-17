# Store-stats source CSVs

Raw exports from **Microsoft Partner Center → Analytics → Acquisitions**, kept
here as the versioned source of truth behind [`../data/`](../data/) and the
[Store Stats page](../../../store-stats.html). Nothing on the page is invented —
every number traces to a line in these files.

| File | App (Store ID) | Report |
|------|----------------|--------|
| `manimstudio-funnel.csv` | ManimStudio (`9NZFT55DVCBS`) | Acquisition funnel |
| `manimstudio-installs-weekly.csv` | ManimStudio (`9NZFT55DVCBS`) | Installs over time (weekly) |
| `tsne-funnel.csv` | t-SNE Visualization (`9P969D6N7P6J`) | Acquisition funnel |
| `generalized-covariance-funnel.csv` | Generalized Covariance Matrix (`9NZJ475S7B01`) | Acquisition funnel |

Funnel CSVs are `"Category","Count"`: First time launches, **Successful installs
(= downloads)**, Install attempts, Page views. The installs-over-time CSV is
`"Date","All"` — weekly successful installs.

**Window:** last 12 months, exported 2026-07-17.

**To refresh:** re-export these from Partner Center (into `~/Downloads`, in the
app order above — Partner Center suffixes repeat downloads ` (1)`, ` (2)`), then
run `python3 scripts/build_store_stats_from_csv.py` to rebuild `../data/`.
Automated pulls need a Microsoft Entra app, which a personal Microsoft account
doesn't have — so this is a hand-read snapshot.
