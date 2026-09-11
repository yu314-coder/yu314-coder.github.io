#!/usr/bin/env python3
"""Build the Store-stats JSON the site reads, from CSVs exported by Partner Center.

A personal Microsoft account has no Microsoft Entra app, so the automated
acquisitions API can't run. This is structural, not a to-do: creating an Entra
tenant to get one actually switched Partner Center away from the apps. There
was a `refresh_store_stats.py` + nightly workflow attempting it; both were
deleted 2026-08-27 (see git history) because they could never run, and because
what they wrote would have corrupted this directory if they ever had — the
acquisitions endpoint returns only `acquisitionQuantity`, so it cannot produce
the install-attempt / page-view / first-launch stages the page needs.

By contrast the *Apple* half of the page IS automated, nightly, via
scripts/refresh_appstore_stats.py — App Store Connect issues API keys straight
from the developer account with no tenant involved. Don't let that one mislead
you into thinking this half is a wiring problem.

So: read the numbers by hand from Partner Center → Analytics → Acquisitions and export CSVs,
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


def assign_funnels(args, previous_by_id):
    """Match each funnel CSV to its app by size, not by download order.

    Same hazard the over-time files have -- Partner Center names them all the
    same and suffixes by download order -- but worse if it goes wrong, because
    the funnel is the headline. The apps are orders of magnitude apart (1,491
    downloads against 34 against 12), so matching each file to the app whose
    last reading it resembles is unambiguous. With no previous snapshot,
    filename order stands.
    """
    import itertools
    names = [a["funnel_csv"] for a in APPS]
    paths = {n: os.path.join(args.downloads, n) for n in names}
    present = [n for n in names if os.path.exists(paths[n])]
    if len(present) < 2:
        return {a["id"]: a["funnel_csv"] for a in APPS}
    counts = {n: read_funnel(paths[n]).get("Successful installs", 0) for n in present}
    refs = {a["id"]: (previous_by_id.get(a["id"]) or {}).get("downloads") for a in APPS}
    slots = [a for a in APPS if a["funnel_csv"] in present]
    if any(refs[a["id"]] in (None, 0) for a in slots):
        return {a["id"]: a["funnel_csv"] for a in APPS}
    best, best_err = None, None
    for perm in itertools.permutations(present, len(slots)):
        err = sum(abs(counts[n] - refs[a["id"]]) / max(refs[a["id"]], 1) for a, n in zip(slots, perm))
        if best is None or err < best_err:
            best, best_err = perm, err
    out = {a["id"]: a["funnel_csv"] for a in APPS}
    for a, n in zip(slots, best):
        out[a["id"]] = n
        if n != a["funnel_csv"]:
            print("  NOTE funnel_csv: %s takes %r (%d installs vs %d last time), not %r"
                  % (a["name"], n, counts[n], refs[a["id"]], a["funnel_csv"]))
    return out


def assign_by_totals(field, csv_key, reference_key, args, previous_by_id):
    """Decide which over-time CSV belongs to which app by its totals, not its name.

    Partner Center names every export the same and suffixes " (1)", " (2)" by
    download order, and APPS assumes one order. A session that exported the
    two small apps the other way round hands t-SNE a series summing to 12
    installs against a funnel of 31, and Generalized Covariance one summing to
    34 against 11 -- each off by a factor of three from its own headline, and
    the page would have shown them anyway. The year's series has to agree with
    the year's funnel to within a modest margin (the trend export runs a few
    weeks longer than "last 12 months", so a little over is normal). So try
    every way of dealing the files out and take the one with the least total
    disagreement; say so when that is not the filename order. Without a
    previous snapshot to check against, filename order stands.
    """
    import itertools
    names = [a[field] for a in APPS]
    paths = [os.path.join(args.downloads, n) if n else None for n in names]
    present = [p for p in paths if p and os.path.exists(p)]
    if len(present) < 2:
        return {a["id"]: a[field] for a in APPS}
    sums = {}
    for p in present:
        sums[p] = sum(r[csv_key] for r in read_weekly(p, csv_key))
    refs = {a["id"]: (previous_by_id.get(a["id"]) or {}).get(reference_key) for a in APPS}
    if any(not refs[a["id"]] for a in APPS if a[field]):
        return {a["id"]: a[field] for a in APPS}
    slots = [a for a in APPS if a[field] and os.path.join(args.downloads, a[field]) in present]
    best, best_err = None, None
    for perm in itertools.permutations(present, len(slots)):
        err = sum(abs(sums[p] - refs[a["id"]]) / max(refs[a["id"]], 1) for a, p in zip(slots, perm))
        if best is None or err < best_err:
            best, best_err = perm, err
    out = {a["id"]: a[field] for a in APPS}
    for a, p in zip(slots, best):
        out[a["id"]] = os.path.basename(p)
        if os.path.basename(p) != a[field]:
            print(f"  NOTE {field}: {a['name']} takes {os.path.basename(p)!r} "
                  f"(sum {sums[p]} vs funnel {refs[a['id']]}), not {a[field]!r} "
                  f"(sum {sums[os.path.join(args.downloads, a[field])]}) -- files were exported in a different order")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--downloads", default=os.path.expanduser("~/Downloads"),
                    help="folder holding the exported Partner Center CSVs")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []
    previous_by_id = {}
    for app in APPS:
        out_path = os.path.join(OUT_DIR, app["id"] + ".json")
        if os.path.exists(out_path):
            with open(out_path) as f:
                previous_by_id[app["id"]] = json.load(f)
    installs_file = assign_by_totals("installs_csv", "installs", "downloads", args, previous_by_id)
    views_file = assign_by_totals("page_views_csv", "views", "page_views", args, previous_by_id)
    funnel_file = assign_funnels(args, previous_by_id)

    for app in APPS:
        out_path = os.path.join(OUT_DIR, app["id"] + ".json")
        previous = previous_by_id.get(app["id"])
        app = dict(app, installs_csv=installs_file[app["id"]],
                   page_views_csv=views_file[app["id"]], funnel_csv=funnel_file[app["id"]])

        funnel_path = os.path.join(args.downloads, app["funnel_csv"])
        if os.path.exists(funnel_path):
            funnel = read_funnel(funnel_path)
            # When the funnel CSV was actually exported, which is NOT the same as
            # when this script ran. Re-exporting only the trends and rebuilding
            # would otherwise stamp today's date on funnel figures read weeks
            # ago, and the page would claim they are current.
            funnel_read_utc = datetime.datetime.fromtimestamp(
                os.path.getmtime(funnel_path), datetime.timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        elif previous:
            # Trend-only refresh: the headline funnel stays exactly what the last
            # export said, dated when it was read, rather than failing the run.
            funnel = {"Successful installs": previous.get("downloads", 0),
                      "Install attempts": previous.get("install_attempts", 0),
                      "Page views": previous.get("page_views", 0),
                      "First time launches from Store": previous.get("first_launches", 0)}
            funnel_read_utc = previous.get("funnel_read_utc") or previous.get("updated_utc")
            print(f"  ({app['name']}: no {app['funnel_csv']} this run -- funnel kept from {funnel_read_utc[:10]})")
        else:
            raise SystemExit(f"{app['name']}: no funnel CSV and no previous snapshot to keep")
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

        # The funnel and the trend are two exports of the same thing, so over a
        # shared window they must agree. They do, exactly, on every app in the
        # 2026-09-11 read. Treat a disagreement as a mis-assigned file rather
        # than shipping an app whose headline contradicts its own chart.
        if rows and os.path.exists(os.path.join(args.downloads, app["funnel_csv"])):
            span = sum(r["installs"] for r in rows)
            if out["downloads"] and abs(span - out["downloads"]) > max(3, out["downloads"] * 0.05):
                raise SystemExit(
                    "%s: funnel says %d installs but its weekly series sums to %d -- "
                    "these are almost certainly different apps' files"
                    % (app["name"], out["downloads"], span))

        # Anything another job maintains in this file -- the hourly workflow's
        # "version" fields -- rides along untouched rather than vanishing until
        # that job next runs.
        if previous:
            for k, v in previous.items():
                out.setdefault(k, v)

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
