#!/usr/bin/env python3
"""Official typhoon forecasts, and CWA's own track, from NCDR's WATCH page.

Taiwan's National Science and Technology Center for Disaster Reduction draws
every agency's forecast for the storms on one map
(https://watch.ncdr.nat.gov.tw/watch_tracks_pro). Behind it is one GeoJSON
endpoint, which also answers for any past moment back to 2016:

    wh/gj_watchtracks_v3.php?s=0            agency issue times only (~300 bytes)
    wh/gj_watchtracks_v3.php?s=1            the whole picture (~200 KB)
    ...&d=2024-07-25&t=08:00                the picture at that time (Taiwan time)

Each storm carries a forecast from CWA (Taiwan, "cwb"), JTWC, JMA, KMA, China's
NMC/CMA ("nmc") and the Hong Kong Observatory, plus CWA's observed track
("obs"). CWA's points carry its intensity: 10-minute wind in m/s, pressure, and
the radii of level-7 (>=34 kt) and level-10 (>=50 kt) winds in km. The other
agencies' come as positions only. Times are Taiwan time (UTC+8); CWA's lines are
interpolated to every hour, with `display: 1` on its real forecast nodes and
real fixes, which are all that is kept here. 2016 has CWA only; the other
agencies start in 2017. The endpoint sends no CORS header, so the tracker reads
copies made by this script:

    assets/data/typhoons/official/<season>/<IBTrACS sid>.json    one storm
      {"name": "GAEMI", "tyno": "202403",
       "track": [["2024071912", 11.6, 133.2, 15, 1004, 0, 0], ...],
                 # UTC stamp, lat, lon, CWA wind m/s, hPa, r7 km, r10 km
       "fc": {"cwa": [["2024072400", [[0, 23.5, 123.3, 45, 940, 250, 100], [6, ...], ...]], ...],
              "jma": [["2024072400", [[0, 23.5, 123.4], [12, ...], ...]], ...], ...}}
                 # issue stamp (UTC), then [lead h, lat, lon(, CWA's intensity)]
    assets/data/typhoons/official/index.json    {IBTrACS sid: "2024/2024201N12133"}
    assets/data/typhoons/live/official.json     the storms active now, latest
                                                issues only, each with its position

Storms are filed by the IBTrACS storm their CWA track follows, matched afresh in
every map. NCDR's own number is not stable: a depression carries CWA's TD
number (TD08 = "202408") until JMA names it and it takes JMA's (Ampil, 2407),
so in August 2024 "202408" was Ampil's depression one day and Wukong the next.

Used by mirror_live_feeds.py (every run: the 300-byte check, then the full file
only when an agency has issued something new) and backfill_ncdr_official.py
(the past, once, slowly).
"""
import calendar
import datetime
import gzip
import io
import json
import math
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "data", "typhoons", "official")
INDEX = os.path.join(OUT_DIR, "index.json")
LIVE = os.path.join(ROOT, "assets", "data", "typhoons", "live", "official.json")
SEASONS = os.path.join(ROOT, "assets", "data", "typhoons", "seasons")

BASE = "https://watch.ncdr.nat.gov.tw/wh/gj_watchtracks_v3.php"
UA = {"User-Agent": "yu314-coder.github.io typhoon tracker (+https://yu314-coder.github.io/typhoon-tracks.html)"}
TW = datetime.timedelta(hours=8)
AGENCY = {"cwb": "cwa", "jtwc": "jtwc", "jma": "jma", "kma": "kma", "nmc": "cma", "hko": "hko"}
TD_NAME = re.compile(r"^(TD|T\.?D\.?)\s*\d*$", re.I)
MATCH_KM = 150        # mean distance from CWA's track to an archived storm's, over shared times


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as exc:
            if i == tries - 1:
                raise
            print("  retry %s (%s)" % (url, exc))
            time.sleep(5 * (i + 1))


def fetch(when=None, summary=False):
    """The map at `when` (a UTC datetime on the hour; now if None)."""
    url = "%s?s=%d" % (BASE, 0 if summary else 1)
    if when is not None:
        loc = when + TW
        url += "&d=%s&t=%s" % (loc.strftime("%Y-%m-%d"), loc.strftime("%H:00"))
    return json.loads(get(url))


def stamp(local):
    """'2024-07-25 08:00' (Taiwan) -> '2024072500' (UTC)."""
    t = datetime.datetime.strptime(local[:16], "%Y-%m-%d %H:%M") - TW
    return t.strftime("%Y%m%d%H")


def stamp_dt(s):
    return datetime.datetime.strptime(s, "%Y%m%d%H")


def _num(v, zero_missing=False):
    if v is None or v == -999 or (zero_missing and v == 0):
        return None
    return round(float(v), 1) if float(v) != int(v) else int(v)


def parse(js):
    """{storm key: {"name", "tyno", "track": {stamp: row}, "fc": {agency: {issue: [pts]}}}}.

    The key is JMA's number (202403) when NCDR gives one, else the name."""
    feats = js.get("features") or []
    tyno = {}
    for f in feats:
        p = f.get("properties") or {}
        if f.get("geometry", {}).get("type") == "LineString" and p.get("tyno"):
            tyno[p.get("ename")] = p["tyno"]
    groups = {}
    for f in feats:
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        if g.get("type") != "Point" or p.get("agency") not in AGENCY and p.get("agency") != "obs":
            continue
        groups.setdefault((p.get("ename") or "", p["agency"]), []).append(
            (int(str(p.get("id", "pt_0"))[3:] or 0), p, g.get("coordinates") or [None, None]))
    out = {}
    for (name, agency), pts in groups.items():
        key = tyno.get(name) or ("x" + "".join(c for c in name.lower() if c.isalnum()))
        st = out.setdefault(key, {"name": name, "tyno": tyno.get(name), "track": {}, "fc": {}})
        pts.sort(key=lambda x: x[0])
        if agency == "cwb" or agency == "obs":
            pts = [x for x in pts if x[1].get("display") == 1]
        rows, seen = [], set()
        for _, p, (lon, lat) in pts:
            if lat is None or lon is None or not p.get("time"):
                continue
            s = stamp(p["time"])
            if s in seen:            # KMA repeats its first point
                continue
            seen.add(s)
            inten = [_num(p.get("maxwind")), _num(p.get("pressure"), True),
                     _num(p.get("radius_wind7")), _num(p.get("radius_wind10"))]
            if inten[0] is None:
                inten = []
            rows.append((s, round(lat, 2), round(lon % 360, 2), inten))
        if not rows:
            continue
        if agency == "obs":
            for s, la, lo, inten in rows:
                st["track"][s] = [la, lo] + (inten or [None, None, None, None])
        else:
            t0 = stamp_dt(rows[0][0])
            st["fc"].setdefault(AGENCY[agency], {})[rows[0][0]] = [
                [int((stamp_dt(s) - t0).total_seconds() // 3600), la, lo] + inten for s, la, lo, inten in rows]
    return out


def merge(into, parsed):
    """Fold one parsed map into a {key: storm} store. Later maps win on equal stamps."""
    for key, st in parsed.items():
        cur = into.setdefault(key, {"name": st["name"], "tyno": st["tyno"], "track": {}, "fc": {}})
        # A depression label (TD08) never replaces a name, and the number goes with the name.
        if st["name"] and (not TD_NAME.match(st["name"]) or not cur["name"] or TD_NAME.match(cur["name"])):
            cur["name"], cur["tyno"] = st["name"], st["tyno"] or cur["tyno"]
        cur["track"].update(st["track"])
        for ag, issues in st["fc"].items():
            cur["fc"].setdefault(ag, {}).update(issues)
    return into


def to_file(st):
    return {"name": st["name"], "tyno": st["tyno"],
            "track": [[s] + st["track"][s] for s in sorted(st["track"])],
            "fc": {ag: [[i, st["fc"][ag][i]] for i in sorted(st["fc"][ag])] for ag in sorted(st["fc"])}}


def from_file(d):
    return {"name": d.get("name") or "", "tyno": d.get("tyno"),
            "track": {r[0]: r[1:] for r in d.get("track") or []},
            "fc": {ag: {i: pts for i, pts in v} for ag, v in (d.get("fc") or {}).items()}}


def dumps(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def write_if_changed(path, text):
    if os.path.exists(path):
        with io.open(path, encoding="utf-8") as f:
            if f.read() == text:
                return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return True


def storm_rel(sid):
    return "%s/%s" % (sid[:4], sid)


def load_stored(sid):
    path = os.path.join(OUT_DIR, storm_rel(sid) + ".json")
    if not os.path.exists(path):
        return None
    with io.open(path, encoding="utf-8") as f:
        return from_file(json.load(f))


# --- which IBTrACS storm is it ------------------------------------------------

def km(la1, lo1, la2, lo2):
    r = math.radians
    h = (math.sin(r(la2 - la1) / 2) ** 2 +
         math.cos(r(la1)) * math.cos(r(la2)) * math.sin(r(lo2 - lo1) / 2) ** 2)
    return 2 * 6371 * math.asin(min(1, math.sqrt(h)))


def archived_tracks(seasons):
    """{sid: (name, [(datetime, lat, lon east)])} from the committed season shards."""
    out = {}
    for season in seasons:
        path = os.path.join(SEASONS, "%s.json" % season)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            for sid, st in json.load(f).items():
                pts = [(datetime.datetime.fromisoformat(p["t"][:19]), p["la"], p["lo"] % 360)
                       for p in st.get("pts", []) if p.get("la") is not None and p.get("lo") is not None]
                if pts:
                    out[sid] = (st.get("name") or "", pts)
    return out


def _at(pts, t):
    """Linear position on a track at t, or None outside it."""
    if not pts or t < pts[0][0] or t > pts[-1][0]:
        return None
    for a, b in zip(pts, pts[1:]):
        if a[0] <= t <= b[0]:
            span = (b[0] - a[0]).total_seconds()
            f = (t - a[0]).total_seconds() / span if span else 0
            return a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f
    return pts[-1][1], pts[-1][2]


def match(st, tracks):
    """The IBTrACS sid whose track CWA's follows, or None.

    By position, not name or number: CWA spells some names its own way and
    numbers its depressions, and IBTrACS has no CWA column to join on."""
    obs = [(stamp_dt(s), r[0], r[1]) for s, r in sorted(st["track"].items())]
    obs += [(stamp_dt(i), pts[0][1], pts[0][2]) for v in st["fc"].values() for i, pts in v.items() if pts]
    obs.sort()
    step = max(1, len(obs) // 12)
    best, best_km = None, MATCH_KM
    for sid, (name, pts) in tracks.items():
        ds = []
        for t, la, lo in obs[::step]:
            q = _at(pts, t)
            if q:
                ds.append(km(la, lo, q[0], q[1]))
        # a depression a day old has two or three fixes; a storm needs three to be sure
        if len(ds) < min(3, len(obs)):
            continue
        mean = sum(ds) / len(ds)
        if mean < best_km:
            best, best_km = sid, mean
    return best


def assign(parsed, tracks, into, unmatched=None):
    """File one map's storms under their IBTrACS sids, merging into `into`."""
    for key, st in parsed.items():
        sid = match(st, tracks)
        if sid:
            merge(into, {sid: st})
        elif unmatched is not None:
            unmatched[key] = st
    return into


def load_index():
    if not os.path.exists(INDEX):
        return {}
    with io.open(INDEX, encoding="utf-8") as f:
        return json.load(f)


def save(store):
    """Merge a {sid: storm} store into the committed files and the index. Returns files written."""
    index = load_index()
    written = 0
    for sid, st in store.items():
        old = load_stored(sid)
        if old:
            st = merge(old, {sid: st})[sid]
        if write_if_changed(os.path.join(OUT_DIR, storm_rel(sid) + ".json"), dumps(to_file(st))):
            written += 1
        index[sid] = storm_rel(sid)
    if write_if_changed(INDEX, dumps(dict(sorted(index.items())))):
        written += 1
    return written


def live_entry(st, sid=None):
    """Live mode needs each agency's latest forecast, CWA's latest fix, and where
    the storm is, to find it among JMA's (the tracker matches by position)."""
    track = sorted(st["track"].items())
    fc = {ag: [max(v), v[max(v)]] for ag, v in st["fc"].items() if v}
    at = track[-1][1][:2] if track else next((v[1][0][1:3] for v in fc.values() if v[1]), None)
    return {"name": st["name"], "sid": sid, "at": at,
            "fix": [track[-1][0]] + track[-1][1] if track else None, "fc": fc}


# --- the raw cache the backfill fetches into ----------------------------------

CACHE = os.path.join(os.path.expanduser("~"), ".cache", "ncdr-official")


def cache_path(when):
    return os.path.join(CACHE, when.strftime("%Y"), when.strftime("%Y%m%d%H") + ".json.gz")


def cached(when):
    path = cache_path(when)
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def cache_put(when, js):
    path = cache_path(when)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(js, f, separators=(",", ":"))


def utc_now_hour():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None, minute=0, second=0, microsecond=0)


if __name__ == "__main__":
    import sys
    # Ad-hoc: print what NCDR shows at a UTC time, e.g. 2024072400
    when = stamp_dt(sys.argv[1]) if len(sys.argv) > 1 else None
    for k, st in sorted(parse(fetch(when)).items()):
        print(k, st["name"], len(st["track"]), "CWA fixes;",
              ", ".join("%s %s" % (ag, ",".join(v)) for ag, v in sorted(st["fc"].items())))
