#!/usr/bin/env python3
"""Build the Store-stats JSON the site reads, from CSVs exported by Partner Center.

A personal Microsoft account has no Microsoft Entra app, so the automated
acquisitions API (see refresh_store_stats.py) can't run. Instead we read the
numbers by hand from Partner Center → Analytics → Acquisitions and export CSVs,
then turn them into assets/store-tracker/data/<storeid>.json:

  * Acquisition funnel CSV  ("Category","Count"): Page views, Install attempts,
    Successful installs (= downloads), First time launches from Store.
  * Installs-over-time CSV  ("Date","All"): successful installs per period. Only
    ManimStudio has enough volume to be worth a trend chart; the tiny apps skip it.
  * Page-views-over-time CSV  ("Date","All"): same shape, but with the
    Acquisitions trend chart's metric switched to "Page views" before exporting.
    Optional — the store-stats page's trend chart only offers a metric picker
    for an app once both series exist for it.

  Both "over time" exports use whatever granularity is selected in Partner
  Center's trend-chart dropdown (day / week / month) — the CSV shape doesn't
  change, and the site infers the granularity from the actual date gaps rather
  than assuming one, so day-, week-, or month-grain exports all work.

Partner Center exports every app's file with the same base name and appends
" (1)", " (2)" for the 2nd/3rd download in a session, so the mapping below is by
download order. Re-download in the app order listed in APPS and it lines up.
Run:  python3 scripts/build_store_stats_from_csv.py [--downloads ~/Downloads]
"""
import argparse
import csv
import datetime
import json
import os

# Store apps in the order you export their CSVs from Partner Center. Each of
# funnel_csv / installs_csv / page_views_csv is a SEPARATE export, and each
# follows the same "download in this order" convention: export it for
# ManimStudio first, then t-SNE, then Generalized Covariance Matrix, and
# Partner Center's own base-name + " (1)" + " (2)" suffixing lines up with the
# order below. installs_csv / page_views_csv are only worth exporting for an
# app once it has enough volume for a trend chart to mean anything — set to
# None to skip one (the build just omits that series rather than erroring).
APPS = [
    {"id": "9NZFT55DVCBS", "name": "ManimStudio",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel.csv",
     "installs_csv": "Apps-and-Games-Installs.csv",
     "page_views_csv": "Apps-and-Games-Page-views.csv"},
    {"id": "9P969D6N7P6J", "name": "t-SNE Visualization",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel (1).csv",
     "installs_csv": "Apps-and-Games-Installs (1).csv",
     "page_views_csv": "Apps-and-Games-Page-views (1).csv"},
    {"id": "9NZJ475S7B01", "name": "Generalized Covariance Matrix",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel (2).csv",
     "installs_csv": "Apps-and-Games-Installs (2).csv",
     "page_views_csv": "Apps-and-Games-Page-views (2).csv"},
]

OUT_DIR = os.path.join("assets", "store-tracker", "data")


def read_funnel(path):
    """Parse a Partner Center acquisition-funnel CSV into {category: count}."""
    out = {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            if len(row) == 2 and row[0] != "Category":
                out[row[0]] = int(row[1])
    return out


def read_weekly(path, key):
    """Parse a Partner Center over-time CSV ("Date","All") into [{date, <key>}]."""
    rows = []
    with open(path, newline="") as f:
        for row in csv.reader(f):
            if len(row) == 2 and row[0] != "Date":
                rows.append({"date": row[0][:10], key: int(row[1])})
    return rows


def weekly_series(app, previous, args, field, csv_key, json_key):
    """Read an optional weekly CSV, falling back to the previous snapshot's rows
    when it wasn't re-exported this run (rather than erroring or wiping the chart)."""
    csv_name = app[field]
    if not csv_name:
        return []
    path = os.path.join(args.downloads, csv_name)
    if os.path.exists(path):
        return read_weekly(path, csv_key)
    if previous and previous.get(json_key):
        rows = previous[json_key]
        print(f"  ({app['name']}: no {csv_name} this run — kept {len(rows)} previous weekly rows)")
        return rows
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--downloads", default=os.path.expanduser("~/Downloads"),
                    help="folder holding the exported Partner Center CSVs")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []
    for app in APPS:
        out_path = os.path.join(OUT_DIR, app["id"] + ".json")
        previous = None
        if os.path.exists(out_path):
            with open(out_path) as f:
                previous = json.load(f)

        funnel_path = os.path.join(args.downloads, app["funnel_csv"])
        funnel = read_funnel(funnel_path)
        # When the funnel CSV was actually exported, which is NOT the same as when
        # this script ran. Re-exporting only the page-views trend and rebuilding
        # would otherwise stamp today's date on funnel figures read weeks ago, and
        # the page would claim they are current.
        funnel_read_utc = datetime.datetime.fromtimestamp(
            os.path.getmtime(funnel_path), datetime.timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = weekly_series(app, previous, args, "installs_csv", "installs", "rows")
        page_view_rows = weekly_series(app, previous, args, "page_views_csv", "views", "page_view_rows")

        out = {
            "app": app["name"], "id": app["id"], "updated_utc": now,
            "funnel_read_utc": funnel_read_utc,
            "window": "Last 12 months",
            "downloads": funnel.get("Successful installs", 0),   # the true install count
            "install_attempts": funnel.get("Install attempts", 0),
            "page_views": funnel.get("Page views", 0),
            "first_launches": funnel.get("First time launches from Store", 0),
            "rows": rows,
            "page_view_rows": page_view_rows,
        }
        # Carry the prior snapshot's headline numbers so the page can show
        # "+N since <date>" without needing its own history store.
        #
        # Only when the funnel was actually RE-EXPORTED, though. Re-running this
        # script against the same CSVs used to overwrite prev with the current
        # numbers, so every rebuild reset the comparison to itself and the page
        # showed a confident "±0" that had never compared anything. When the
        # export has not moved, keep whatever prev was already there.
        if previous:
            if previous.get("funnel_read_utc") == funnel_read_utc and previous.get("prev"):
                out["prev"] = previous["prev"]
            else:
                out["prev"] = {
                    "downloads": previous.get("downloads", 0),
                    "page_views": previous.get("page_views", 0),
                    "install_attempts": previous.get("install_attempts", 0),
                    "first_launches": previous.get("first_launches", 0),
                    "updated_utc": previous.get("updated_utc"),
                    "funnel_read_utc": previous.get("funnel_read_utc"),
                }

        with open(out_path, "w") as f:
            json.dump(out, f, separators=(",", ":"))
        index.append({"id": app["id"], "name": app["name"]})
        delta = f"  (+{out['downloads'] - previous['downloads']} since last)" if previous else ""
        print(f"{app['name']:32} downloads {out['downloads']:>5}{delta}  "
              f"page_views {out['page_views']:>5}  weekly_rows {len(rows)}")

    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"wrote {OUT_DIR}/ (index + {len(APPS)} apps)")


if __name__ == "__main__":
    main()
