#!/usr/bin/env python3
"""Mirror the two live storm feeds the tracker can't fetch from a browser.

The ATCF b-deck (JTWC's working best track, published openly by UCAR/RAL) and
the UW-CIMSS ADT Dvorak history both send no CORS header. The tracker used to
read them through public CORS proxies; by October 2026 corsproxy.io wanted an
API key and allorigins/codetabs had stopped answering, so both top-ups had
gone quiet. This fetches them server-side for the western-Pacific storms that
are active now -- including storms that formed in the east/central Pacific or
the north Indian Ocean and crossed in, which JTWC keeps filing under their
original number (Nolo 2026 is EP15, its CIMSS history is 15E) -- and writes one
small same-origin file:

    assets/data/typhoons/live/feeds.json
    {
      "bdeck": {"WP272026": {"name": "KOGUMA", "last": "2026101012",
                             "text": "<the BEST lines, as published>"}},
      "cimss": {"27W": {"lat": 23.23, "lon": 149.27, "last": 1791642600000,
                        "ci": [[1791167400000, 2.0], ...]}}
    }

CIMSS is keyed by the JTWC number, not JMA's, and the two disagree (JMA 2629
was JTWC 27W, JMA 2628 was 15E), so each entry carries its latest fix position;
the tracker matches a JMA storm to the CIMSS storm nearest its analysis point.

It also carries "lab": which Trackformer Weather Lab ids hold runs for each
IBTrACS storm. The Lab files a storm it forecast live under JMA's id (TC2634)
rather than the IBTrACS one the tracker keys on (2026278N11168), so the
history view asked for the wrong one and heard "no saved forecast" for storms
with ~200 runs. Each such id is matched once, by where its latest run starts,
and kept.

    "lab": {"2026278N11168": ["TC2634"], "2026254N11252": ["TC2635"]}

Nothing in the file is a clock of this run, so a run that finds nothing new
rewrites nothing and the workflow commits nothing. A feed that fails to answer
keeps its previous entries while they are still recent. Run on a schedule by
.github/workflows/mirror-live-feeds.yml.
"""
import calendar
import csv
import datetime
import io
import json
import math
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "data", "typhoons", "live", "feeds.json")

BDECK_BASE = "https://hurricanes.ral.ucar.edu/repository/data/bdecks_open/"
CIMSS_BASE = "https://tropic.ssec.wisc.edu/real-time/adt/"
UA = {"User-Agent": "yu314-coder.github.io live-feed mirror (+https://yu314-coder.github.io/typhoon-tracks.html)"}

BDECK_RECENT_H = 10 * 24     # a storm whose last BEST fix is older than this is over
CIMSS_RECENT_H = 3 * 24
BDECK_NEWEST = 10            # numbered storms run in order, so the live ones are the newest few
# ATCF basins whose storms can reach the west Pacific. A crossover keeps the id
# it was born with, so the east/central Pacific and Indian Ocean decks count
# when (and only when) the track has been west of the dateline / east of 100E.
BDECK_BASINS = ("wp", "ep", "cp", "io")
WP_LON = (100.0, 180.0)      # degrees east; CIMSS entries are kept a little either side
MON = {m.upper(): i for i, m in enumerate(calendar.month_abbr) if m}

LAB = "https://trackformer-weatherlab.rudin-euler-8253.chatgpt.site"
SEASONS = os.path.join(ROOT, "assets", "data", "typhoons", "seasons")
NOAA_ACTIVE = ("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
               "v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv")
SID_RE = re.compile(r"^\d{7}[NS]\d{5}$")
LAB_MATCH_KM = 300           # a run's start must sit on the storm's own track
LAB_MATCH_H = 6


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as exc:
            if i == tries - 1:
                raise
            print("  retry %s (%s)" % (url, exc))
            time.sleep(4 * (i + 1))


def hours_ago(ms, now_ms):
    return (now_ms - ms) / 3600000.0


def bdeck_ms(stamp):
    return calendar.timegm(time.strptime(stamp, "%Y%m%d%H")) * 1000


def in_wp(line):
    """Is this b-deck fix in the west Pacific (100E to the dateline, north of the equator)?"""
    f = [x.strip() for x in line.split(",")]
    m_la, m_lo = re.fullmatch(r"(\d+)([NS])", f[6]), re.fullmatch(r"(\d+)([EW])", f[7])
    if not (m_la and m_lo) or m_la.group(2) != "N" or m_lo.group(2) != "E":
        return False
    return WP_LON[0] <= int(m_lo.group(1)) / 10.0 <= WP_LON[1]


def mirror_bdecks(old, now):
    now_ms = now.timestamp() * 1000
    years = [now.year] + ([now.year - 1] if now.month == 1 else [])
    out, listed = {}, False
    for year in years:
        try:
            listing = get("%s%d/" % (BDECK_BASE, year))
        except Exception as exc:
            print("b-deck listing %d failed (%s)" % (year, exc))
            continue
        listed = True
        for basin in BDECK_BASINS:
            nums = sorted({int(n) for n in re.findall(r"b%s(\d\d)%d\.dat" % (basin, year), listing)
                           if int(n) < 90})
            for n in nums[-BDECK_NEWEST:]:
                atcf = "%s%02d%d" % (basin.upper(), n, year)
                try:
                    text = get("%s%d/b%s.dat" % (BDECK_BASE, year, atcf.lower()))
                except Exception as exc:
                    print("%s failed (%s)" % (atcf, exc))
                    if atcf in old:
                        out[atcf] = old[atcf]
                    continue
                best = [ln.rstrip() for ln in text.splitlines()
                        if len(ln.split(",")) >= 17 and ln.split(",")[4].strip() == "BEST"]
                stamps = [ln.split(",")[2].strip() for ln in best]
                stamps = [s for s in stamps if re.fullmatch(r"\d{10}", s)]
                if not stamps:
                    continue
                last = max(stamps)
                if hours_ago(bdeck_ms(last), now_ms) > BDECK_RECENT_H:
                    continue
                if basin != "wp" and not any(in_wp(ln) for ln in best):
                    continue
                names = [ln.split(",")[27].strip() for ln in best if len(ln.split(",")) > 27]
                names = [x for x in names if x and x not in ("INVEST", "NONAME")]
                # the tracker reads the first 17 columns (through the four radii); the rest
                # is per-fix metadata it never uses, and half the bytes
                text = "\n".join(",".join(ln.split(",")[:17]) for ln in best)
                out[atcf] = {"name": names[-1] if names else "", "last": last, "text": text}
                print("%s %s last %s, %d BEST lines" % (atcf, out[atcf]["name"] or "-", last, len(best)))
    if not listed:   # UCAR unreachable: keep whatever is still live
        out = {k: v for k, v in old.items() if hours_ago(bdeck_ms(v["last"]), now_ms) <= BDECK_RECENT_H}
    return out


LINE = re.compile(r"^(\d{4})([A-Z]{3})(\d{2})\s+(\d{6})\s+([\d.]+)\s+[\d.]+\s+[\d.]+")
# "... 23.05 -149.40  ARCHER   HIM-9 28.7": the storm location, then fix method,
# satellite and view angle. The cloud temperatures earlier on the line look the
# same but are followed by a scene type and "N/A"/a radius, which this rejects.
LOC = re.compile(r"(-?\d{1,2}\.\d{2})\s+(-?\d{1,3}\.\d{2})\s+[A-Z]{3,}\s+\S+\s+\d+\.\d")


def parse_cimss(text, sid):
    if sid not in text:
        return None
    ci, loc = [], None
    for line in text.splitlines():
        m = LINE.match(line)
        if not m or m.group(2) not in MON:
            continue
        hhmmss = m.group(4)
        ms = calendar.timegm((int(m.group(1)), MON[m.group(2)], int(m.group(3)),
                              int(hhmmss[:2]), int(hhmmss[2:4]), 0)) * 1000
        ci.append([ms, float(m.group(5))])
        found = LOC.findall(line)
        if found:
            lat, lon = float(found[-1][0]), float(found[-1][1])
            loc = (lat, -lon)    # ADT longitudes are west-positive
    if not ci or not loc:
        return None
    lon = loc[1] + 360 if loc[1] < -180 else loc[1]
    return {"lat": round(loc[0], 2), "lon": round(lon, 2), "last": ci[-1][0], "ci": ci}


def mirror_cimss(old, now):
    now_ms = now.timestamp() * 1000
    try:
        index = get(CIMSS_BASE)
    except Exception as exc:
        print("CIMSS index failed (%s)" % exc)
        return {k: v for k, v in old.items() if hours_ago(v["last"], now_ms) <= CIMSS_RECENT_H}
    out = {}
    for sid in sorted(set(re.findall(r"odt(\d\d[A-Z])\.html", index))):
        try:
            entry = parse_cimss(get("%s%s-list.txt" % (CIMSS_BASE, sid)), sid)
        except Exception as exc:
            print("%s failed (%s)" % (sid, exc))
            entry = old.get(sid)
        if not entry or hours_ago(entry["last"], now_ms) > CIMSS_RECENT_H:
            continue
        if not (WP_LON[0] - 10 <= entry["lon"] <= WP_LON[1] + 20 and entry["lat"] > 0):
            continue   # nowhere near the west Pacific (e.g. 18E off Mexico)
        out[sid] = entry
        print("%s at %.2f,%.2f, %d fixes, CI %.1f" % (sid, entry["lat"], entry["lon"], len(entry["ci"]), entry["ci"][-1][1]))
    return out


def km(la1, lo1, la2, lo2):
    r = math.radians
    h = (math.sin(r(la2 - la1) / 2) ** 2 +
         math.cos(r(la1)) * math.cos(r(la2)) * math.sin(r(lo2 - lo1) / 2) ** 2)
    return 2 * 6371 * math.asin(min(1, math.sqrt(h)))


def iso_ms(t):
    return calendar.timegm(time.strptime(t[:19].replace(" ", "T"), "%Y-%m-%dT%H:%M:%S")) * 1000


def archived_tracks(seasons):
    """{sid: [(ms, lat, lon east)]} from the committed season shards."""
    tracks = {}
    for season in seasons:
        path = os.path.join(SEASONS, "%d.json" % season)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            for sid, st in json.load(f).items():
                tracks[sid] = [(iso_ms(p["t"]), p["la"], p["lo"] % 360) for p in st.get("pts", [])
                               if p.get("t") and p.get("la") is not None and p.get("lo") is not None]
    return tracks


def active_tracks():
    """The same from NCEI's active-storms csv, for a storm too new for the archive."""
    tracks = {}
    for r in csv.DictReader(io.StringIO(get(NOAA_ACTIVE))):
        if not SID_RE.match(r.get("SID") or ""):
            continue
        try:
            tracks.setdefault(r["SID"], []).append((iso_ms(r["ISO_TIME"]), float(r["LAT"]), float(r["LON"]) % 360))
        except (KeyError, ValueError):
            continue
    return tracks


def match_track(tracks, ms, lat, lon):
    best, best_km = None, LAB_MATCH_KM
    for sid, pts in tracks.items():
        near = min(pts, key=lambda p: abs(p[0] - ms), default=None)
        if not near or abs(near[0] - ms) > LAB_MATCH_H * 3600000:
            continue
        d = km(lat, lon, near[1], near[2])
        if d < best_km:
            best, best_km = sid, d
    return best


def map_lab_ids(old, now):
    """{IBTrACS sid: [every Lab id to ask]} for storms the Lab files under some other id.

    The list includes the sid itself only when the Lab's catalog has it too, so the
    tracker never asks for an id it knows will 404."""
    seasons = [now.year] + ([now.year - 1] if now.month == 1 else [])
    known = {lid: sid for sid, ids in old.items() for lid in ids if lid != sid}
    out_inv, tracks, active, by_sid = {}, None, None, set()
    for season in seasons:
        try:
            catalog = json.loads(get("%s/api/history/v1/catalog?season=%d" % (LAB, season)))
        except Exception as exc:
            print("Lab catalog %d failed (%s); keeping the known ids" % (season, exc))
            out_inv.update({lid: sid for lid, sid in known.items() if sid[:4] == str(season)})
            continue
        by_sid.update(st.get("id") for st in catalog.get("storms", [])
                      if SID_RE.match(st.get("id") or "") and st.get("issues"))
        for st in catalog.get("storms", []):
            lid = st.get("id") or ""
            if SID_RE.match(lid) or not st.get("issues"):
                continue
            if lid in known:
                out_inv[lid] = known[lid]
                continue
            # Where a run starts places the storm. Not the latest run: NCEI's track
            # lags the storm by a day or two, so a recent start lies past its end.
            # The earliest, then a day and two days on -- JMA can pick a storm up
            # half a day before IBTrACS starts it (Koguma: TC2634 from 10-04 12Z,
            # 2026278N11168 from 10-05 00Z). One fetch per try, once per storm.
            issues = sorted(st["issues"], key=lambda i: i.get("issue_time_utc") or "9")
            t0 = iso_ms(issues[0]["issue_time_utc"])
            tries = []
            for day in (0, 1, 2):
                nxt = next((i for i in issues if iso_ms(i["issue_time_utc"]) >= t0 + day * 86400000), None)
                if nxt and nxt not in tries:
                    tries.append(nxt)
            sid = where = None
            for issue in tries:
                try:
                    fc = json.loads(get("%s/api/history/v1/forecasts/%s" % (LAB, issue["id"])))
                    p0 = [p for p in fc.get("route") or [] if p.get("lead_hours") == 0][0]
                    ms, lat, lon = iso_ms(p0["valid_time_utc"]), p0["lat"], p0["lon"] % 360
                except Exception as exc:
                    print("Lab %s: no usable run start in %s (%s)" % (lid, issue["id"], exc))
                    continue
                where = "%.1f,%.1f %s" % (lat, lon, p0["valid_time_utc"])
                if tracks is None:
                    tracks = archived_tracks(seasons)
                sid = match_track(tracks, ms, lat, lon)
                if not sid:
                    if active is None:
                        try:
                            active = active_tracks()
                        except Exception as exc:
                            print("NCEI active csv failed (%s)" % exc)
                            active = {}
                    sid = match_track(active, ms, lat, lon)
                if sid:
                    break
            if sid:
                out_inv[lid] = sid
                print("Lab %s (%s) -> %s" % (lid, st.get("name") or "-", sid))
            else:
                print("Lab %s (%s): no IBTrACS storm at %s yet" % (lid, st.get("name") or "-", where))
    out = {}
    for lid, sid in out_inv.items():
        out.setdefault(sid, []).append(lid)
    known_sids = {s for ids in old.values() for s in ids if SID_RE.match(s)}
    for sid in out:
        if sid in by_sid or (sid in known_sids and not by_sid):   # keep it through a catalog outage
            out[sid].append(sid)
    return {sid: sorted(ids) for sid, ids in out.items()}


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    old = {}
    if os.path.exists(OUT):
        with io.open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    feeds = {"bdeck": mirror_bdecks(old.get("bdeck", {}), now),
             "cimss": mirror_cimss(old.get("cimss", {}), now),
             "lab": map_lab_ids(old.get("lab", {}), now)}
    text = json.dumps(feeds, sort_keys=True, separators=(",", ":")) + "\n"
    prev = None
    if os.path.exists(OUT):
        with io.open(OUT, encoding="utf-8") as f:
            prev = f.read()
    if text == prev:
        print("no change")
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote %s (%d b-decks, %d CIMSS, %d Lab mappings, %.1f KB)" % (
        os.path.relpath(OUT, ROOT), len(feeds["bdeck"]), len(feeds["cimss"]), len(feeds["lab"]), len(text) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
