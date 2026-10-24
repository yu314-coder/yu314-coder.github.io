#!/usr/bin/env python3
"""Fill assets/data/typhoons/official/ with past official forecasts from NCDR.

The live mirror only sees forecasts issued while it runs. For the storms before
that, this asks NCDR's map for each moment a storm was active -- every 6 hours
while it was at least a 30 kt system in the west Pacific, every 3 hours while
it was within 800 km of Taiwan, where CWA issues more often -- and keeps every
agency's forecast and CWA's track (see ncdr_official.py for the format).

One request every few seconds, cached raw in ~/.cache/ncdr-official, so a run
can be stopped and resumed and the files rebuilt without asking again:

    python scripts/backfill_ncdr_official.py --seasons 2024 2025     # fetch, then build
    python scripts/backfill_ncdr_official.py --build-only            # rebuild from the cache

Run by .github/workflows/backfill-ncdr-official.yml, one season per job, which
keeps the cache between runs. NCDR has nothing before 2016, and only CWA's
forecasts in 2016.
"""
import argparse
import datetime
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ncdr_official as N  # noqa: E402

TAIWAN = (23.7, 121.0)
NEAR_KM = 800


def wanted_times(seasons):
    want = set()
    for season in seasons:
        path = os.path.join(N.SEASONS, "%d.json" % season)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            shard = json.load(f)
        for st in shard.values():
            for p in st.get("pts", []):
                if p.get("w") is None or p["w"] < 30 or not (100 <= p["lo"] <= 185):
                    continue
                t = datetime.datetime.fromisoformat(p["t"][:19])
                if t.minute or t.hour % 3:
                    continue
                if t.hour % 6 == 0 or N.km(p["la"], p["lo"], *TAIWAN) < NEAR_KM:
                    want.add(t)
    return sorted(want)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="*", default=list(range(2016, datetime.date.today().year + 1)))
    ap.add_argument("--pause", type=float, default=3.0, help="seconds between requests")
    ap.add_argument("--build-only", action="store_true")
    a = ap.parse_args()

    if not a.build_only:
        now = N.utc_now_hour()
        times = [t for t in wanted_times(a.seasons) if t < now - datetime.timedelta(hours=3)]
        todo = [t for t in times if not os.path.exists(N.cache_path(t))]
        print("%d moments in %s, %d not cached yet" % (len(times), a.seasons, len(todo)), flush=True)
        fails = 0
        for i, t in enumerate(todo):
            try:
                N.cache_put(t, N.fetch(t))
                fails = 0
            except Exception as exc:
                fails += 1
                print("%s failed (%s)" % (t, exc), flush=True)
                if fails >= 5:   # NCDR is down or refusing: stop rather than keep knocking
                    print("::warning title=NCDR stopped answering::five failures in a row at %s; "
                          "building what was fetched -- run again to resume" % t, flush=True)
                    break
                time.sleep(60)
            if i % 50 == 0:
                print("%d/%d %s" % (i, len(todo), t), flush=True)
            time.sleep(a.pause)

    tracks = N.archived_tracks([str(s) for s in range(min(a.seasons) - 1, max(a.seasons) + 2)])
    store, lost = {}, {}
    for season in a.seasons:
        d = os.path.join(N.CACHE, str(season))
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            js = N.cached(N.stamp_dt(name[:10]))
            if js:
                N.assign(N.parse(js), tracks, store, lost)
    for key, st in sorted(lost.items()):
        print("no IBTrACS storm for NCDR %s (%s) at some point" % (key, st["name"]))
    print("built %d storms; wrote %d files" % (len(store), N.save(store)))


if __name__ == "__main__":
    main()
