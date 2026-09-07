#!/usr/bin/env python3
"""Rebuild the typhoon track archive from IBTrACS.

The archive under assets/data/typhoons/ was originally a one-off export and had
no refresher, so it silently went stale -- the 2026 season stopped at Higos on
27 June while IBTrACS had four more storms (Bavi, Maysak, Noul, Dolphin). This
script regenerates season files, the index and the per-season climatology
counts straight from IBTrACS, and is wired to a schedule so it cannot drift
again.

Field mapping was not guessed: it was derived by regenerating seasons the site
already had and diffing until every field of every point matched exactly.

    t   ISO_TIME                          h   hours since the storm's first fix
    la  LAT                               lo  LON
    w   USA_WIND (kt, 1-minute)           p   USA_PRES, falling back to WMO_PRES
    wj  TOKYO_WIND (kt, JMA 10-minute -- what the CWA classification uses)
    rm  USA_RMW, nm -> km, 1dp
    r3  USA_R34_{NE,SE,SW,NW}, nm -> km, whole km
    r5  USA_R50_*   r6  USA_R64_*

Chinese names are not in IBTrACS. They are carried over per storm id, and for a
name new to a season taken from the most recent season in this archive that
used it -- never invented.

Usage:
    python scripts/refresh_typhoon_archive.py                  # last 3 years
    python scripts/refresh_typhoon_archive.py --full           # every season
    python scripts/refresh_typhoon_archive.py --seasons 2026
    python scripts/refresh_typhoon_archive.py --check          # report, write nothing
"""

import argparse
import csv
import hashlib
import re
import datetime as dt
import io
import json
import os
import re
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upstream  # noqa: E402

BASE = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/"
LAST3 = BASE + "ibtracs.last3years.list.v04r01.csv"
FULL = BASE + "ibtracs.WP.list.v04r01.csv"
# NCEI answers 403 for every file under access/csv/ -- from a GitHub runner and
# from a laptop alike, so it is the dataset that is closed, not us being
# rate-limited. But only that directory is closed: the parents list fine, and
# archive/ still serves a tarball holding exactly the same CSVs, usually
# fresher than the loose copies. So there is a way in after all.
ARCHIVE = "https://www.ncei.noaa.gov/data/ibtracs/v04r01/archive/"
_BUNDLE = {}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "assets", "data", "typhoons")
SEASONS = os.path.join(DATA, "seasons")

NM_TO_KM = 1.852
MISSING = {"", " ", "NaN", "NA", "-999", "-9999"}

RADII = (
    ("r3", ("USA_R34_NE", "USA_R34_SE", "USA_R34_SW", "USA_R34_NW")),
    ("r5", ("USA_R50_NE", "USA_R50_SE", "USA_R50_SW", "USA_R50_NW")),
    ("r6", ("USA_R64_NE", "USA_R64_SE", "USA_R64_SW", "USA_R64_NW")),
)


def num(v):
    v = (v or "").strip()
    if v in MISSING:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def first(row, *cols):
    """First column with a real value, in order of preference."""
    for c in cols:
        v = num(row.get(c))
        if v is not None:
            return v
    return None


def parse_time(s):
    return dt.datetime.strptime(s.strip(), "%Y-%m-%d %H:%M:%S")


def fetch(url):
    """Fetch, and say plainly when the archive is refusing rather than broken.

    IBTrACS lives on the same host as the analysis archives, so when NCEI
    starts refusing the GitHub runners this fails too -- and it failed with a
    bare urllib traceback, which reads like a bug in this script. It is not:
    there is nothing to fix here and nothing to retry around, the run simply
    has to wait for the block to lift. Still a non-zero exit, because a
    silently skipped refresh is how the archive went stale in the first place.
    """
    sys.stderr.write("fetching %s\n" % url)
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        # 404 counts here too. The loose files under access/csv/ answered 403
        # for months and now answer 404: NCEI has finished retiring that path.
        # Re-raising on 404 would fail the refresh outright, when the bundle in
        # archive/ still has exactly the same CSVs and is more current.
        if e.code in (403, 404, 429) or e.code >= 500:
            sys.stderr.write("  %s; falling back to the archive bundle\n" % e)
            return from_archive(os.path.basename(url))
        raise


def from_archive(member):
    """The same CSV, out of the tarball in archive/.

    Downloaded once per run and kept in a temp file, because a --full refresh
    asks for one member and a scheduled one asks for another; re-fetching 63 MB
    per member would be silly.
    """
    if "path" not in _BUNDLE:
        try:
            listing = urllib.request.urlopen(ARCHIVE, timeout=120).read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) or e.code >= 500:
                upstream.blocked("IBTrACS", f"the archive bundle is refused too ({e})", ARCHIVE)
            raise
        names = re.findall(r'(ibtracs_v04r01_csv_[A-Za-z0-9_]+\.tar\.gz)', listing)
        if not names:
            upstream.blocked("IBTrACS", "access/csv/ is closed and archive/ lists no CSV bundle",
                             ARCHIVE)
        name = sorted(set(names))[-1]           # date-stamped, so the last is newest
        url = ARCHIVE + name
        sys.stderr.write("fetching %s\n" % url)
        fd, path = tempfile.mkstemp(suffix=".tar.gz", prefix="ibtracs-")
        os.close(fd)
        with urllib.request.urlopen(url, timeout=900) as r, open(path, "wb") as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
        _BUNDLE["path"] = path
        _BUNDLE["name"] = name
    with tarfile.open(_BUNDLE["path"], "r:gz") as tf:
        for m in tf.getmembers():
            if os.path.basename(m.name) == member:
                sys.stderr.write("  %s from %s\n" % (member, _BUNDLE["name"]))
                return tf.extractfile(m).read().decode("utf-8", errors="replace")
    upstream.blocked("IBTrACS", f"{member} is not in {_BUNDLE['name']}")


def read_storms(text):
    """Group rows by storm, keeping any storm that spends time in the west
    Pacific -- and keeping *all* of its rows.

    Filtering rows by BASIN instead of storms truncates anything that crosses a
    basin line: Dora 2023 came out of the east Pacific, and a row-level filter
    cut it from 175 fixes to 80.
    """
    rdr = csv.DictReader(io.StringIO(text))
    storms = {}
    for r in rdr:
        # IBTrACS puts a units row under the header; real rows start with a digit.
        if not (r.get("SID") and r["SID"][:1].isdigit()):
            continue
        storms.setdefault(r["SID"], []).append(r)
    return {sid: rows for sid, rows in storms.items()
            if any(r.get("BASIN") == "WP" for r in rows)}


def merge_regenerations(by_storm):
    """Rejoin a storm IBTrACS filed twice because it died and came back.

    JTWC issues one ATCF id per system, so two records sharing an id *and* a
    name are one storm by the issuing agency's own reckoning. Saudel 2026 is
    the case in hand: WP172026 ran 18-28 Aug, dissipated inland over China, and
    was reissued under the same id and name on 31 Aug when it re-emerged south
    of Hainan. IBTrACS keyed the second half as a new SID, so the tracker
    listed two Saudels. CMA agrees it is one storm -- it files the whole thing
    as 2618.

    A shared id alone is not enough. Across all 82 WP seasons 20 ids map to
    more than one SID, and 14 pair a real storm with a concurrent UNNAMED spur:
    different systems that merely overlap. Of the six same-name pairs, three
    (Haitang 2022, Ernie 1996, Faye:Gloria 1971) run *simultaneously* -- they
    are duplicate tracks of one system, and concatenating them by time would
    zig-zag between two contemporaneous sets of fixes. Requiring the records to
    be disjoint in time leaves those three alone and fires on exactly one pair
    in the whole archive, which is the one that is real.
    """
    groups = {}
    for sid, rows in by_storm.items():
        atcf = (rows[0].get("USA_ATCF_ID") or "").strip()
        name = (rows[0].get("NAME") or "").strip().upper()
        if atcf and is_named(name):
            groups.setdefault((atcf, name), []).append(sid)

    merged, absorbed = dict(by_storm), {}
    for (atcf, name), sids in groups.items():
        if len(sids) < 2:
            continue
        spans = {}
        for sid in sids:
            ts = sorted(r["ISO_TIME"] for r in by_storm[sid])
            spans[sid] = (ts[0], ts[-1])
        order = sorted(sids, key=lambda s: spans[s][0])
        keep, rows = order[0], list(by_storm[order[0]])
        for sid in order[1:]:
            if spans[sid][0] <= max(r["ISO_TIME"] for r in rows):
                continue                      # concurrent, not a regeneration
            rows += by_storm[sid]
            del merged[sid]
            absorbed[sid] = keep
            sys.stderr.write(
                "%s: %s absorbs %s (same ATCF %s, %s -> %s)\n"
                % (name, keep, sid, atcf, spans[sid][0][:10], spans[sid][1][:10])
            )
        rows.sort(key=lambda r: r["ISO_TIME"])
        merged[keep] = rows
    return merged, absorbed


def build_points(rows):
    base = parse_time(rows[0]["ISO_TIME"])
    pts = []
    for r in rows:
        t = parse_time(r["ISO_TIME"])
        p = {
            "t": t.isoformat(),
            "h": (t - base).total_seconds() / 3600.0,
            "la": num(r.get("LAT")),
            "lo": num(r.get("LON")),
            # JTWC first, RSMC Tokyo's WMO value where JTWC has nothing.
            "w": first(r, "USA_WIND", "WMO_WIND"),
            "p": first(r, "USA_PRES", "WMO_PRES"),
        }
        wj = num(r.get("TOKYO_WIND"))
        if wj is not None:
            p["wj"] = wj
        rmw = num(r.get("USA_RMW"))
        if rmw is not None:
            p["rm"] = round(rmw * NM_TO_KM, 1)
        for key, cols in RADII:
            vals = [num(r.get(c)) for c in cols]
            # Partial reports are kept with holes rather than dropped -- Dora
            # 2023 has a 50 kt radius for NE and NW only, and the archive
            # carries it as [9, null, null, 9].
            if any(v is not None and v > 0 for v in vals):
                p[key] = [None if v is None else float(round(v * NM_TO_KM)) for v in vals]
        pts.append(p)
    return pts


def keep_gap_fills(pts, previous):
    """Carry forward fixes another agency supplied to bridge a gap.

    IBTrACS is the only thing this script downloads, so a plain rebuild would
    drop whatever scripts/fill_track_gaps_cma.py added and re-open the hole.
    A fix is re-added only where IBTrACS still has nothing at that timestamp,
    so on the day NCEI ingests a season's CMA columns its own fixes win and the
    borrowed ones fall away by themselves.
    """
    fills = [p for p in previous if p.get("src")]
    if not fills:
        return pts
    have = {p["t"] for p in pts}
    lo, hi = pts[0]["t"], pts[-1]["t"]
    add = [p for p in fills if p["t"] not in have and lo < p["t"] < hi]
    if not add:
        return pts
    pts = sorted(pts + add, key=lambda p: p["t"])
    base = parse_time(pts[0]["t"].replace("T", " "))
    for p in pts:
        p["h"] = (parse_time(p["t"].replace("T", " ")) - base).total_seconds() / 3600.0
    return pts


def ace_of(pts):
    """Accumulated cyclone energy: sum of v^2 over 6-hourly fixes at >=34 kt."""
    total = 0.0
    for p in pts:
        # Gap fixes borrowed from another agency use a different averaging
        # convention (CMA reports a 2-minute mean, JTWC a 1-minute peak), so
        # they stay out of a number meant to be comparable across 4,246 storms.
        if p.get("src"):
            continue
        if parse_time(p["t"].replace("T", " ")).hour % 6:
            continue
        w = p.get("w")
        if w is not None and w >= 34:
            total += w * w
    return round(total / 10000.0, 1)


def is_named(name):
    """The original export kept only named systems -- there is not one unnamed
    storm in 1077 records -- so unnamed depressions stay out, or a refresh
    would silently invent history the site never showed."""
    return (name or "").strip().upper() not in ("", "NOT_NAMED", "UNNAMED", "NONAME")


def title(name):
    """IBTrACS shouts (YUN-YEUNG); the archive title-cases every part, including
    across hyphens -- Yun-Yeung, Kong-Rey, not Yun-yeung."""
    out = []
    for word in (name or "").strip().replace("_", " ").split():
        out.append("-".join(part.capitalize() for part in word.split("-")))
    return " ".join(out)


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


TRACKER = os.path.join(ROOT, "assets", "typhoon-tracker")


def bump_tracker_tokens():
    """Version the tracker's own code, and the iframe that loads it.

    typhoon-tracks.html embeds the tracker as
    <iframe src="assets/typhoon-tracker/index.html?v=...">, and that token is
    what a browser keys the cached page on. Re-versioning things *inside* the
    tracker is not enough: leave the iframe URL alone and the browser keeps
    serving the shell it already has, which asks for the old app.js, which
    carries the old data token -- so a corrected archive renders exactly as it
    did before. That is what happened to the Saudel merge: the data, the code
    and the tracker's own page were all correct and published, and the tab
    still showed two Saudels.

    Every token here is a content hash, so none of them can be forgotten, and
    re-running when nothing moved rewrites nothing.
    """
    def digest(*paths):
        h = hashlib.sha1()
        for path in paths:
            with io.open(path, "rb") as f:
                h.update(f.read())
        return h.hexdigest()[:8]

    def retoken(path, pattern, token):
        if not os.path.exists(path):
            return False
        with io.open(path, encoding="utf-8") as f:
            text = f.read()
        new = re.sub(pattern, lambda m: m.group(1) + token, text)
        if new == text:
            return False
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(new)
        return True

    app = os.path.join(TRACKER, "app.js")
    css = os.path.join(TRACKER, "styles.css")
    page = os.path.join(TRACKER, "index.html")
    shell = os.path.join(ROOT, "typhoon-tracks.html")
    if not all(os.path.exists(x) for x in (app, css, page)):
        return False

    hit = retoken(page, r'(app\.js\?v=)[\w.-]+', digest(app))
    hit |= retoken(page, r'(styles\.css\?v=)[\w.-]+', digest(css))
    # the iframe token last, so it covers the tracker page as just rewritten
    hit |= retoken(shell, r'(assets/typhoon-tracker/index\.html\?v=)[\w.-]+',
                   digest(page, app, css))
    if hit:
        print("tracker assets re-versioned (app.js/styles.css/iframe)")
    return hit


def bump_cache_token():
    """Point the tracker at the new data.

    The tracker requests these files with a ?v= token, so a browser holding the
    old copy would keep serving it. The token is derived from the data itself,
    so it changes exactly when the archive does and not otherwise.

    Every data file the tracker fetches goes into the hash, not just
    index.json. A season shard can change while the index does not -- which is
    what fill_track_gaps.py does when it adds fixes that are deliberately kept
    out of peak wind and ACE -- and hashing only the index would leave those
    browsers on the shard they already had.
    """
    files = [os.path.join(DATA, "index.json"), os.path.join(DATA, "climatology.json")]
    files += sorted(os.path.join(SEASONS, n) for n in os.listdir(SEASONS)
                    if n.endswith(".json"))
    h = hashlib.sha1()
    for path in files:
        if os.path.exists(path):
            with io.open(path, "rb") as f:
                h.update(f.read())
    token = "?v=d" + h.hexdigest()[:8]
    changed = []
    for rel in ("app.js", "index.html"):
        path = os.path.join(TRACKER, rel)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            text = f.read()
        # Only the typhoon data URLs, not the tracker's own asset versions.
        new = re.sub(r'(data/typhoons/[\w./-]+)\?v=[\w.-]+', r'\1' + token, text)
        new = re.sub(r'(var DATA_V = ")\?v=[\w.-]+(")', r'\1' + token + r'\2', new)
        if new != text:
            with io.open(path, "w", encoding="utf-8") as f:
                f.write(new)
            changed.append(rel)
    if changed:
        print("cache token -> %s (%s)" % (token, ", ".join(changed)))


def zh_lookup():
    """{NAME upper: chinese} taken from the most recent season that used it."""
    best = {}
    for fn in sorted(os.listdir(SEASONS)):
        if not fn.endswith(".json"):
            continue
        for storm in load_json(os.path.join(SEASONS, fn), {}).values():
            zh = storm.get("nameZh")
            if not zh:
                continue
            key = (storm.get("name") or "").upper()
            season = storm.get("season") or 0
            if key and season >= best.get(key, (0, ""))[0]:
                best[key] = (season, zh)
    return {k: v[1] for k, v in best.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="download every WP season, not just the last three years")
    ap.add_argument("--seasons", nargs="*", type=int, help="restrict to these seasons")
    ap.add_argument("--check", action="store_true", help="report differences, write nothing")
    args = ap.parse_args()

    by_storm, absorbed = merge_regenerations(
        read_storms(fetch(FULL if args.full else LAST3)))

    zh = zh_lookup()
    seasons = {}
    for sid, srows in by_storm.items():
        srows.sort(key=lambda r: r["ISO_TIME"])
        season = int(srows[0]["SEASON"])
        if args.seasons and season not in args.seasons:
            continue
        if not is_named(srows[0].get("NAME")):
            continue
        seasons.setdefault(season, {})[sid] = {
            "name": title(srows[0].get("NAME")),
            "season": season,
            "rows": srows,
        }

    index = load_json(os.path.join(DATA, "index.json"), [])
    climo = load_json(os.path.join(DATA, "climatology.json"), {})
    index_pos = {e["sid"]: i for i, e in enumerate(index)}

    def put_index(sid, entry):
        """Update in place, or slot a new storm in beside its own season.

        The existing file is in no order this script can reproduce, and the
        tracker sorts by date itself, so rewriting the order would be a huge
        diff for no gain.
        """
        i = index_pos.get(sid)
        if i is not None:
            index[i] = entry
            return
        last = max((j for j, e in enumerate(index) if e["season"] == entry["season"]), default=None)
        at = len(index) if last is None else last + 1
        index.insert(at, entry)
        for s, j in index_pos.items():
            if j >= at:
                index_pos[s] = j + 1
        index_pos[sid] = at

    changed, added_total = [], 0
    for season in sorted(seasons):
        path = os.path.join(SEASONS, "%d.json" % season)
        existing = load_json(path, {})
        out = {}
        for sid, meta in sorted(seasons[season].items()):
            pts = keep_gap_fills(build_points(meta["rows"]),
                                 (existing.get(sid) or {}).get("pts") or [])
            # Never invent a Chinese name, and never churn an existing one:
            # a storm already in the archive keeps exactly what it had (null
            # included), and only a genuinely new storm gets looked up, from the
            # most recent season of this archive that used the same name.
            if sid in existing:
                name_zh = existing[sid].get("nameZh")
            else:
                name_zh = zh.get(meta["name"].upper(), "")
            out[sid] = {
                "name": meta["name"],
                "nameZh": name_zh,
                "season": season,
                "pts": pts,
            }
            # The ids this record swallowed. NOAA's ACTIVE feed still publishes
            # the absorbed half under its own id for a while after the storm
            # ends, and the tracker overlays that feed on the shard -- without
            # this it would re-add the second Saudel as a separate storm and
            # undo the merge in the browser. Deciding that client-side would
            # mean re-deriving a rule that needs the ATCF id, which the shard
            # does not carry, so the answer is recorded here instead.
            was = sorted(o for o, k in absorbed.items() if k == sid)
            if was:
                out[sid]["was"] = was

        added = [s for s in out if s not in existing]
        dropped = [s for s in existing if s not in out]

        # IBTrACS renumbers a storm when re-analysis moves its genesis across a
        # day boundary -- Wutip 2025 went 2025162N15114 -> 2025161N15114 when its
        # track was extended six hours earlier. Same storm, new id: retire the
        # old record rather than ending up with two Wutips.
        renamed, why = {}, {}
        for old in list(dropped):
            # A record merge_regenerations folded into its earlier half is gone
            # for the same reason a renumbered one is: it still exists, under
            # another id. Retire it instead of refusing the whole season.
            if absorbed.get(old) in out:
                renamed[old] = absorbed[old]
                why[old] = "rejoined"
                dropped.remove(old)
                continue
            o = existing[old]
            for new in added:
                n = out[new]
                if n["name"] != o["name"]:
                    continue
                if n["pts"][0]["t"][:10] > o["pts"][-1]["t"][:10]:
                    continue
                if n["pts"][-1]["t"][:10] < o["pts"][0]["t"][:10]:
                    continue
                renamed[old] = new
                dropped.remove(old)
                break

        if dropped:
            # A short download or a bad parse must never delete history.
            sys.stderr.write(
                "REFUSING to rewrite %d: it would drop %d storm(s): %s\n"
                % (season, len(dropped), ", ".join(dropped))
            )
            continue

        for old, new in renamed.items():
            print("season %d: %s %s %s -> %s"
                  % (season, out[new]["name"], why.get(old, "renumbered"), old, new))
            i = index_pos.pop(old, None)
            if i is not None:
                index.pop(i)
                for sid2, j in list(index_pos.items()):
                    if j > i:
                        index_pos[sid2] = j - 1
        if out == existing:
            continue

        changed.append(season)
        added_total += len(added)
        names = ", ".join("%s (%s)" % (out[s]["name"], s) for s in added) or "field updates only"
        print("season %d: %d storms, +%d new -> %s" % (season, len(out), len(added), names))

        if args.check:
            continue

        write_json(path, out)

        for sid, storm in out.items():
            pts = storm["pts"]
            # Peak wind, like ACE, stays on the JTWC basis the whole archive
            # is built on; a borrowed fix reports a different average.
            winds = [p["w"] for p in pts
                     if p.get("w") is not None and not p.get("src")]
            put_index(sid, {
                "sid": sid,
                "name": storm["name"],
                **({"was": storm["was"]} if storm.get("was") else {}),
                "nameZh": storm["nameZh"],
                "season": season,
                "start": pts[0]["t"],
                "end": pts[-1]["t"],
                "maxWind": max(winds) if winds else None,
                "hasRadius": any(p.get(k) for p in pts for k, _ in RADII),
                "ace": ace_of(pts),
            })

        # Climatology carries real NOAA CPC ONI values — recompute the counts
        # around them, never the ENSO fields.
        entry = climo.get(str(season), {})
        strongest = max(out.values(), key=lambda s: max([p["w"] for p in s["pts"] if p.get("w") is not None] or [0]))
        sw = max([p["w"] for p in strongest["pts"] if p.get("w") is not None] or [0])
        entry["count"] = len(out)
        entry["ace"] = round(sum(ace_of(s["pts"]) for s in out.values()), 1)
        entry["strongest"] = {"name": strongest["name"], "nameZh": strongest["nameZh"], "maxWind": sw}
        climo[str(season)] = entry

    if args.check:
        print("archive already current" if not changed else "\n--check: nothing written")
        return 0

    if changed:
        write_json(os.path.join(DATA, "index.json"), index)
        write_json(os.path.join(DATA, "climatology.json"), climo)

    # Both run every time, not just when this script changed something: a
    # shard edited by fill_track_gaps.py, or a hand edit to the tracker's own
    # code, still has to reach a browser holding the old copy. Each token is a
    # content hash, so a run that changed nothing rewrites nothing.
    bump_cache_token()
    bump_tracker_tokens()

    if not changed:
        print("archive already current")
        return 0
    print("\nupdated seasons %s; index now %d storms (+%d)" % (changed, len(index), added_total))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
