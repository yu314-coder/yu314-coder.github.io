#!/usr/bin/env python3
"""Build the Store-stats JSON the site reads, from CSVs exported by Partner Center.

A personal Microsoft account has no Microsoft Entra app, so the automated
acquisitions API (see refresh_store_stats.py) can't run. Instead we read the
numbers by hand from Partner Center → Analytics → Acquisitions and export two
kinds of CSV, then turn them into assets/store-tracker/data/<storeid>.json:

  * Acquisition funnel CSV  ("Category","Count"): Page views, Install attempts,
    Successful installs (= downloads), First time launches from Store.
  * Installs-over-time CSV  ("Date","All"): weekly successful installs. Only
    ManimStudio has enough volume to be worth a trend chart; the tiny apps skip it.

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

# Store apps in the order you export their funnel CSVs from Partner Center.
# funnel_csv / installs_csv are basenames inside the downloads dir; installs_csv
# is None for apps too small to chart.
APPS = [
    {"id": "9NZFT55DVCBS", "name": "ManimStudio",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel.csv",
     "installs_csv": "Apps-and-Games-Installs.csv"},
    {"id": "9P969D6N7P6J", "name": "t-SNE Visualization",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel (1).csv",
     "installs_csv": None},
    {"id": "9NZJ475S7B01", "name": "Generalized Covariance Matrix",
     "funnel_csv": "Apps-and-Games-Acquisition-funnel (2).csv",
     "installs_csv": None},
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


def read_installs(path):
    """Parse an installs-over-time CSV into [{date, installs}] (weekly rows)."""
    rows = []
    with open(path, newline="") as f:
        for row in csv.reader(f):
            if len(row) == 2 and row[0] != "Date":
                rows.append({"date": row[0][:10], "installs": int(row[1])})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--downloads", default=os.path.expanduser("~/Downloads"),
                    help="folder holding the exported Partner Center CSVs")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []
    for app in APPS:
        funnel = read_funnel(os.path.join(args.downloads, app["funnel_csv"]))
        rows = read_installs(os.path.join(args.downloads, app["installs_csv"])) \
            if app["installs_csv"] else []
        out = {
            "app": app["name"], "id": app["id"], "updated_utc": now,
            "window": "Last 12 months",
            "downloads": funnel.get("Successful installs", 0),   # the true install count
            "install_attempts": funnel.get("Install attempts", 0),
            "page_views": funnel.get("Page views", 0),
            "first_launches": funnel.get("First time launches from Store", 0),
            "rows": rows,
        }
        with open(os.path.join(OUT_DIR, app["id"] + ".json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        index.append({"id": app["id"], "name": app["name"]})
        print(f"{app['name']:32} downloads {out['downloads']:>5}  "
              f"page_views {out['page_views']:>5}  weekly_rows {len(rows)}")

    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"wrote {OUT_DIR}/ (index + {len(APPS)} apps)")


if __name__ == "__main__":
    main()
