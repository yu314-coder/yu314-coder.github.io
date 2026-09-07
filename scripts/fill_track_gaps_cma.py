#!/usr/bin/env python3
"""Bridge holes in an archived track with China Meteorological Administration fixes.

Why this exists
---------------
IBTrACS is a JTWC-first record here: build_points() reads LAT/LON, USA_WIND and
USA_PRES, and the agency columns (TOKYO_*, CMA_*, HKO_*) arrive only when NCEI
ingests a season's re-analysis, which for 2026 has not happened -- 1,144 WP rows
carry 102 JMA fixes and zero CMA ones. JTWC stops issuing warnings the moment a
system dissipates over land, so a storm that crosses China and comes back out
leaves a hole in the middle of its own track.

Saudel 2026 is the case in hand. JTWC quit at 28.1N 121.0E as it came ashore in
Zhejiang on 28 Aug and picked it up again on 31 Aug south of Hainan, 78 hours
and 1,100 km later -- drawn as a track, a straight line through inland China.
CMA never stopped: it files the storm as 2618, one continuous record, and it
kept fixing the depression as it decayed southwest across Fujian, Jiangxi and
Guangdong.

What it does and does not do
----------------------------
Only fixes that fall strictly inside a hole are taken. The rest of the track
stays JTWC's, because the two agencies do not measure the same quantity: CMA
reports a 2-minute mean wind in m/s and JTWC a 1-minute peak in knots. This
converts units and nothing else -- no averaging-convention fudge factor, which
would be a number nobody measured. Every borrowed fix is tagged "src": "CMA" so
the site can say where it came from, refresh_typhoon_archive.py can carry it
across a rebuild, and ACE stays on a single-agency basis.

Where CMA has no fix either, the hole stays open. It is not this script's job to
invent a position: for Saudel that leaves 30 Aug 06:00 -> 31 Aug 06:00 empty,
the day the circulation was over land between Guangdong and the Gulf of Tonkin
and no agency was fixing it.

Usage
-----
    python scripts/fill_track_gaps_cma.py --season 2026 --name Saudel
    python scripts/fill_track_gaps_cma.py --season 2026 --name Saudel --check
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "assets", "data", "typhoons")
SEASONS = os.path.join(DATA, "seasons")

# typhoon.nmc.cn is the National Meteorological Center's public typhoon
# service; these two JSONP endpoints are what its own web map calls.
LIST = "http://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_%d"
VIEW = "http://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_%s"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

MS_TO_KT = 1.9438444924406046
# A gap only counts as a gap if it is longer than a normal reporting interval.
# Best-track fixes run 3-hourly here and 6-hourly in older seasons, so 9 hours
# clears both without treating a missed synoptic hour as a hole.
GAP_HOURS = 9.0


def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": "http://typhoon.nmc.cn/web.html"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def jsonp(text):
    return json.loads(re.sub(r"^[^(]*\(|\)\s*;?\s*$", "", text.strip()))


def find_storm(season, name):
    """CMA's numeric id for a storm, matched on the English name it publishes."""
    listing = jsonp(get(LIST % season)).get("typhoonList") or []
    want = name.strip().upper()
    hits = [e for e in listing if str(e[1]).strip().upper() == want]
    if not hits:
        raise SystemExit("CMA lists no %d storm named %s" % (season, name))
    if len(hits) > 1:
        raise SystemExit("CMA lists %d storms named %s in %d: %s"
                         % (len(hits), name, season, [h[0] for h in hits]))
    return hits[0]


def cma_points(storm_id):
    """[(utc datetime, lat, lon, pressure mb, wind kt)] for one CMA record.

    A fix is [id, label, epoch_ms, category, lon, lat, pressure, wind m/s, ...].
    The epoch is authoritative -- the label beside it is the same instant, but
    reading the string would mean guessing at a timezone.
    """
    rec = jsonp(get(VIEW % storm_id))["typhoon"]
    out = []
    for f in rec[8]:
        t = dt.datetime.fromtimestamp(f[2] / 1000.0, dt.timezone.utc).replace(tzinfo=None)
        lon, lat, pres, wind = f[4], f[5], f[6], f[7]
        if lat is None or lon is None:
            continue
        out.append((t, float(lat), float(lon),
                    float(pres) if pres is not None else None,
                    round(float(wind) * MS_TO_KT, 1) if wind is not None else None))
    out.sort(key=lambda p: p[0])
    return out


def parse_t(s):
    return dt.datetime.strptime(s.replace("T", " "), "%Y-%m-%d %H:%M:%S")


def gaps_in(pts):
    """[(after, before)] for every pair of consecutive fixes more than GAP_HOURS apart."""
    found = []
    for a, b in zip(pts, pts[1:]):
        ta, tb = parse_t(a["t"]), parse_t(b["t"])
        if (tb - ta).total_seconds() / 3600.0 > GAP_HOURS:
            found.append((ta, tb))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, required=True)
    ap.add_argument("--name", required=True, help="storm name as IBTrACS spells it")
    ap.add_argument("--check", action="store_true", help="report, write nothing")
    args = ap.parse_args()

    path = os.path.join(SEASONS, "%d.json" % args.season)
    with open(path, encoding="utf-8") as fh:
        shard = json.load(fh)

    sids = [s for s, v in shard.items()
            if str(v.get("name", "")).upper() == args.name.upper()]
    if len(sids) != 1:
        raise SystemExit("%d.json holds %d storms named %s%s"
                         % (args.season, len(sids), args.name,
                            " -- merge them first" if len(sids) > 1 else ""))
    sid = sids[0]
    storm = shard[sid]
    pts = storm["pts"]

    holes = gaps_in(pts)
    if not holes:
        print("%s (%s): no gap wider than %gh" % (args.name, sid, GAP_HOURS))
        return
    for a, b in holes:
        print("gap: %s -> %s  (%.0fh)" % (a, b, (b - a).total_seconds() / 3600.0))

    entry = find_storm(args.season, args.name)
    print("CMA: %s %s (%s), id %s, intl %s"
          % (entry[1], entry[2], args.name, entry[0], entry[3]))
    cma = cma_points(entry[0])
    print("CMA track: %d fixes, %s -> %s" % (len(cma), cma[0][0], cma[-1][0]))

    have = {p["t"] for p in pts}
    base = parse_t(pts[0]["t"])
    added = []
    for a, b in holes:
        for t, lat, lon, pres, wind in cma:
            if not (a < t < b) or t.isoformat() in have:
                continue
            p = {"t": t.isoformat(),
                 "h": (t - base).total_seconds() / 3600.0,
                 "la": round(lat, 2), "lo": round(lon, 2),
                 "w": wind, "p": pres, "src": "CMA"}
            added.append(p)

    if not added:
        print("CMA has no fix inside the gap either -- nothing to add")
        return

    merged = sorted(pts + added, key=lambda p: p["t"])
    base = parse_t(merged[0]["t"])
    for p in merged:
        p["h"] = (parse_t(p["t"]) - base).total_seconds() / 3600.0

    print("\nadding %d CMA fixes:" % len(added))
    for p in added:
        print("   %s  %5.1fN %6.1fE  %s mb  %s kt"
              % (p["t"], p["la"], p["lo"], p["p"], p["w"]))
    left = gaps_in(merged)
    print("\ngaps remaining: %s"
          % ("none" if not left else
             ", ".join("%s -> %s (%.0fh)" % (a, b, (b - a).total_seconds() / 3600.0)
                       for a, b in left)))
    print("track: %d fixes -> %d" % (len(pts), len(merged)))

    if args.check:
        print("\n--check: nothing written")
        return

    storm["pts"] = merged
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(shard, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, path)
    print("wrote %s" % os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
