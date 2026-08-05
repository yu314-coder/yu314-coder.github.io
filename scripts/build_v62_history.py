#!/usr/bin/env python3
"""Generate full-life v62 hindcasts for a past storm, from public CFSR analysis.

Track-history mode could only use v62 where a run happened to be published, so
everywhere else it fell back to v23. This closes that: give it a storm and it
runs v62 at EVERY synoptic initialisation in that storm's life, so scrubbing the
timeline stays on v62 the whole way.

Source is NOAA's CFSR 6-hourly low-resolution reanalysis -- public, no key.
Validated against the published high-resolution Tip case before being trusted:
2.5 deg gives 138.6 km mean track error where 0.5 deg gives 141.2 km, the two
tracks separating by ~15 km against a 652 km persistence baseline. 16x less data
for no meaningful difference.

Causality is the same rule as live mode, enforced the same way: only analyses
valid at or before each initialisation are opened, the track history is cut at
the initialisation, and post-issue observations are used ONLY to score, never to
forecast. CFSR is a reanalysis, so this is a hindcast -- honest about what the
model would have had at the time, not a claim of real-time skill.

Cost: ~4.6 MB per analysis time, so roughly 200-400 MB and a few minutes per
storm. Output goes to assets/typhoon-tracker/model/v62/<sid>.json with a small
index at model/v62-hindcasts.json, so a visitor only downloads the storm they
opened.

    python scripts/build_v62_history.py 1979275N06159        # one storm
    python scripts/build_v62_history.py --top 20             # most intense first
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SEASONS = REPO / "assets" / "data" / "typhoons" / "seasons"
OUT_DIR = REPO / "assets" / "typhoon-tracker" / "model" / "v62"
INDEX = REPO / "assets" / "typhoon-tracker" / "model" / "v62-hindcasts.json"
CACHE = Path(os.environ.get("V62_CFSR_DIR", "/tmp/v62-cfsr"))
V62_SRC = os.environ.get("V62_SRC_DIR", str(REPO.parent / "typhoon-predict"))
CFSR = ("https://www.ncei.noaa.gov/oa/prod-cfs-reanalysis/6-hourly-low-resolution/"
        "{y}/{ym}/{ymd}/pgblnl.gdas.{t}.grb2")
# CFSv2/CDAS takes over on 2011-04-01. It publishes the same two resolutions the
# reanalysis does, and this used to fetch only the high-resolution one -- 75 MB an
# analysis, ~17x the CFSR era, which is why the post-2011 backfill was never put on
# a schedule and why almost no modern storm had a hindcast. The low-resolution
# product is the same 73x144 2.5-degree grid as the CFSR file already validated
# against, carries the same fields, and is 4.3 MB. Prefer it; fall back to the big
# file only where the small one is missing.
CDAS_LOW = ("https://www.ncei.noaa.gov/data/climate-forecast-system/access/operational-analysis/"
            "6-hourly-low-resolution/{y}/{ym}/{ymd}/cdas1.t{hh}z.pgrblanl.grib2")
CDAS_HIGH = ("https://www.ncei.noaa.gov/data/climate-forecast-system/access/operational-analysis/"
             "6-hourly-by-pressure/{y}/{ym}/{ymd}/cdas1.t{hh}z.pgrbhanl.grib2")
UA = {"User-Agent": "typhoon-tracker-history-builder/1.0 (+https://yu314-coder.github.io)"}
# A pause between analysis downloads. Going from 3 storms a run to 20 meant up
# to a thousand requests an hour at a public archive, and it started refusing
# them. The fetches dominate wall-clock anyway, so this costs little and is the
# difference between a courteous client and one that gets blocked.
FETCH_PAUSE_S = float(os.environ.get("V62_FETCH_PAUSE", "0.4"))
# Wall-clock budget. The archive does not only refuse or answer -- it can also
# answer slowly, and a storm that normally takes five minutes can then take an
# hour. Without a budget the job runs until the runner kills it, and a killed
# job commits nothing, so every storm it did finish is thrown away. Stop
# starting new ones in time to write out what is already built.
BUDGET_MIN = float(os.environ.get("V62_BUDGET_MIN", "0"))
_STARTED = time.monotonic()


def out_of_time():
    return BUDGET_MIN > 0 and (time.monotonic() - _STARTED) / 60 >= BUDGET_MIN

LEVELS = (850.0, 500.0, 200.0)
DLM_WEIGHTS = np.asarray([0.269, 0.500, 0.231], dtype="float32")
DLM4_SCALE = np.asarray([4.7021923, 3.075009, 9.006815, 4.8768406], dtype="float32")
PACIFIC_WEIGHT, LOCAL_WEIGHT = 0.25, 0.75
KEEP_MEMBERS = 20          # drawn routes kept per initialisation
RETRY_BLOCKED_DAYS = 21    # how long to leave a storm alone after its analyses came up missing
CONE_PCT = 90.0
# The analysis archive changes product mid-2011, not at a year boundary:
#   CFSR   1979-01-01 .. 2011-03-31
#   CDAS   2011-04-01 onward   (CFSv2; NCEI operational-analysis/6-hourly-by-pressure,
#                               cdas1.tHHz.pgrbhanl.grib2 -- 78 MB, no .idx sidecar,
#                               so it is not yet wired up here)
CFSR_END = dt.datetime(2011, 3, 31, 18, tzinfo=dt.timezone.utc)


def needs_reanalysis(storm):
    """True if every analysis this storm needs comes from the reanalysis.
    The two eras are served by two different services on two different paths,
    and they fail independently -- one being blocked says nothing about the
    other, which is the whole reason the fallback below is worth having."""
    last = dt.datetime.fromisoformat(storm["pts"][-1]["t"]).replace(tzinfo=dt.timezone.utc)
    return last <= CFSR_END


def log(m):
    print(m, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
def analysis_url(stamp):
    """CFSR before 2011-04-01, CDAS/CFSv2 from it. The archive changes product
    mid-season, so this is decided per analysis time, not per year. For the CDAS
    era two URLs come back: the cheap one first, the 75 MB one as a fallback."""
    when = dt.datetime.strptime(stamp, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    if when <= CFSR_END:
        return [CFSR.format(y=stamp[:4], ym=stamp[:6], ymd=stamp[:8], t=stamp)], "CFSR"
    parts = dict(y=stamp[:4], ym=stamp[:6], ymd=stamp[:8], hh=stamp[8:])
    return [CDAS_LOW.format(**parts), CDAS_HIGH.format(**parts)], "CDAS"


_REFUSED = []   # analysis stamps the archive refused while building the current storm
_FETCH_OK = 0   # successful downloads this run
_REFUSED_TOTAL = 0
# If the archive is refusing us there is no point working through 400 requests
# to discover it 400 times, and continuing to knock is how a temporary block
# becomes a longer one. Give up the run after this many consecutive refusals
# with nothing successfully fetched.
BREAKER_AFTER = 12


class ArchiveUnreachable(RuntimeError):
    """Refused everything we asked for; stop the run rather than keep asking."""


class AnalysisMissing(RuntimeError):
    """The archive answered, and does not have this analysis (404)."""


class AnalysisBlocked(RuntimeError):
    """The archive refused to answer -- 403, 429, or a server error.

    This is the dangerous one. A blocked fetch looks exactly like a missing one
    from the outside, and treating it as missing would record a perfectly good
    storm as permanently unavailable and skip it forever."""


def cfsr_path(stamp):
    """stamp is YYYYMMDDHH. Downloaded once, then reused across every
    initialisation that needs it -- consecutive inits share four of five."""
    CACHE.mkdir(parents=True, exist_ok=True)
    urls, kind = analysis_url(stamp)
    p = CACHE / f"{kind.lower()}.{stamp}.grb2"
    if p.exists() and p.stat().st_size > 500_000:
        return p

    last = None
    blocked = False
    if FETCH_PAUSE_S:
        time.sleep(FETCH_PAUSE_S)
    for url in urls:
        try:
            req = urllib.request.Request(url, headers=UA)
            # 300s was far too patient. A refused request is not fast when the
            # archive decides to tarpit instead of answering: measured 229s
            # average and 1081s worst for requests that only ever returned 403,
            # which is how 102 requests filled 348 minutes. A 4.6 MB file does
            # not need more than this even on a bad link.
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
        except urllib.error.HTTPError as e:          # try the fallback product
            last = e
            if e.code in (403, 429) or e.code >= 500:
                blocked = True
            continue
        except Exception as e:
            last = e
            blocked = True                            # network trouble, not absence
            continue
        if len(data) < 500_000 or data[:4] != b"GRIB":
            last = RuntimeError(f"{kind} {stamp}: not a GRIB file ({len(data)} bytes)")
            continue
        p.write_bytes(data)
        global _FETCH_OK
        _FETCH_OK += 1
        return p
    if blocked:
        global _REFUSED_TOTAL
        _REFUSED_TOTAL += 1
        _REFUSED.append(stamp)
        if _FETCH_OK == 0 and _REFUSED_TOTAL >= BREAKER_AFTER:
            raise ArchiveUnreachable(
                f"the archive refused {_REFUSED_TOTAL} requests in a row and served none; "
                f"stopping rather than knocking {BREAKER_AFTER} more times")
        raise AnalysisBlocked(f"{kind} {stamp}: archive refused the request ({last})")
    raise AnalysisMissing(f"{kind} {stamp}: not published ({last})")


_FULL = {}
_FULL_ORDER = []
_FULL_MAX = 8          # decoded analyses held at once; a CDAS one is ~15 MB


def _open(path, lev):
    import xarray as xr
    return xr.open_dataset(path, engine="cfgrib",
                           backend_kwargs={"filter_by_keys": {"typeOfLevel": lev}, "indexpath": ""})


def read_full(stamp):
    if stamp in _FULL:
        return _FULL[stamp]
    path = cfsr_path(stamp)
    pr, sf = _open(path, "isobaricInhPa"), _open(path, "meanSea")
    try:
        pr = pr.sortby("latitude"); sf = sf.sortby("latitude")
        lv = np.asarray(pr["isobaricInhPa"].values, "float32").reshape(-1)
        i = [int(np.abs(lv - x).argmin()) for x in LEVELS]
        u = np.asarray(pr["u"].values, "float32"); v = np.asarray(pr["v"].values, "float32")
        gh = np.asarray(pr["gh"].values, "float32")
        lat = np.asarray(pr.latitude.values, "float32"); lon = np.asarray(pr.longitude.values, "float32")
        # CFSR names the field prmsl; CDAS/CFSv2 names the same thing msl.
        key = "prmsl" if "prmsl" in sf.data_vars else "msl"
        mslp = np.asarray(sf[key].values, "float32") / 100.0
        fields = np.stack([gh[i[1]], u[i[0]], v[i[0]], u[i[1]], v[i[1]], u[i[2]], v[i[2]]], 0)
        # keep the level cube too, so storm patches don't reopen the file
        levels = np.stack([u[i], v[i]], 1).astype("float32")     # (3,2,H,W)
    finally:
        pr.close(); sf.close()
    _FULL[stamp] = (fields.astype("float32"), mslp, lat, lon, levels)
    _FULL_ORDER.append(stamp)
    while len(_FULL_ORDER) > _FULL_MAX:
        _FULL.pop(_FULL_ORDER.pop(0), None)
    return _FULL[stamp]


def _bilinear(grid, lat, lon, gl, go):
    """Bilinear sample of grid[..., ny, nx] at the requested lat/lon, wrapping in
    longitude. NOT a nearest-neighbour lookup: the 17x17 patch is centred on the
    STORM, so its points sit between CFSR's 2.5 deg lattice lines even though the
    spacing matches. Snapping them to the lattice moves each sample by up to
    1.25 deg (~139 km) and measurably changes the route -- it cost 112 km of
    track error on Tip's validated initialisation before this was fixed."""
    dla = float(lat[1] - lat[0]); dlo = float(lon[1] - lon[0])
    fy = (np.asarray(gl, "float64") - float(lat[0])) / dla
    fx = ((np.asarray(go, "float64") - float(lon[0])) % 360.0) / dlo
    y0 = np.clip(np.floor(fy).astype(int), 0, lat.size - 2)
    x0 = np.floor(fx).astype(int) % lon.size
    y1, x1 = y0 + 1, (x0 + 1) % lon.size
    wy = (fy - np.floor(fy)).reshape(-1, 1)          # varies down rows (lat)
    wx = (fx - np.floor(fx)).reshape(1, -1)          # varies across cols (lon)

    def g(yy, xx):                                    # -> (..., 17, 17)
        return grid[..., yy, :][..., :, xx]

    out = (g(y0, x0) * (1 - wy) * (1 - wx) + g(y0, x1) * (1 - wy) * wx
           + g(y1, x0) * wy * (1 - wx) + g(y1, x1) * wy * wx)
    return out.astype("float32")


def patch_at(stamp, clat, clon):
    """17x17 at 2.5 deg centred on the storm, bilinearly sampled."""
    _, mslp, lat, lon, levels = read_full(stamp)
    gl = clat + (np.arange(17, dtype="float64") - 8.0) * 2.5
    go = (clon % 360.0) + (np.arange(17, dtype="float64") - 8.0) * 2.5
    return _bilinear(levels, lat, lon, gl, go), _bilinear(mslp, lat, lon, gl, go)


def km(a, b, c, d):
    dl = ((d - b + 180.0) % 360.0) - 180.0
    return math.hypot(dl * 111.2 * math.cos(math.radians(0.5 * (a + c))), (c - a) * 111.2)


def pct(vals, p):
    v = sorted(vals)
    k = (len(v) - 1) * p / 100.0
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return v[lo] if lo == hi else v[lo] + (v[hi] - v[lo]) * (k - lo)


# ---------------------------------------------------------------------------
def run_storm(sid, season_year, storm, intensity_on=True):
    sys.path.insert(0, V62_SRC)
    sys.path.insert(0, str(Path(V62_SRC) / "scripts"))
    from analysis_level_mean_route import build_level_analysis_mean_route
    from v61_big_system_route import weighted_route
    from v62_pacific_domain_route import build_pacific_route, forecast_pacific_state

    intensity = None
    if intensity_on:
        try:
            from predict_ibtracs_jma_only import build_track_window
            from v62_intensity_structure import V62IntensityEnsemble, couple_forecast_to_pressure_map
            root = Path(V62_SRC) / "v37" / "structure_spatial"
            intensity = (V62IntensityEnsemble(root / "checkpoints",
                                              root / "v37g_intensity_calibration.json", device="cpu"),
                         build_track_window, couple_forecast_to_pressure_map)
        except Exception as e:
            log(f"  intensity head unavailable ({type(e).__name__}: {e}); track only")

    stats = np.load(HERE / "v23" / "v23_norm_stats.npz")
    terr = np.load(HERE / "v23" / "v23_terrain_wp.npz")
    ri, ci = np.where(terr["lsm"] > 0.5)
    land_lat, land_lon = terr["lat"][ri].astype("float32"), terr["lon"][ci].astype("float32")

    pts = [p for p in storm["pts"]
           if p["t"][11:13] in ("00", "06", "12", "18") and p["t"][14:16] == "00" and p.get("la") is not None]
    if len(pts) < 13:
        return None, "fewer than 13 synoptic fixes"

    def when(p):
        return dt.datetime.fromisoformat(p["t"]).replace(tzinfo=dt.timezone.utc)

    runs = []
    # need 24 h of history behind, and at least one lead ahead
    for i in range(4, len(pts) - 1):
        issue = when(pts[i])
        stamps = [(issue - dt.timedelta(hours=h)).strftime("%Y%m%d%H") for h in (0, 12, 24, 36, 48)]
        centres = []
        ok = True
        for h in (0, 12, 24):
            tgt = issue - dt.timedelta(hours=h)
            near = min(pts[: i + 1], key=lambda p: abs((when(p) - tgt).total_seconds()))
            if abs((when(near) - tgt).total_seconds()) > 3 * 3600:
                ok = False; break
            centres.append((float(near["la"]), float(near["lo"])))
        if not ok:
            continue
        try:
            fields, press = [], []
            lat = lon = None
            for s in stamps[:3]:
                f, m, la, lo, _ = read_full(s)
                if lat is None: lat, lon = la, lo
                fields.append(f); press.append(m)
            fields, press = np.stack(fields), np.stack(press)

            cur, mslp0 = patch_at(stamps[0], *centres[0])
            hist = []
            for s, c in zip(stamps[1:3], centres[1:]):
                hp, _ = patch_at(s, *c)
                hist.append(hp)
            hist = np.concatenate(hist, 0)

            base_lat, base_lon = float(pts[i]["la"]), float(pts[i]["lo"])
            sm = []
            for a, b in zip(pts[max(0, i - 4): i + 1], pts[max(0, i - 4) + 1: i + 1]):
                hrs = (when(b) - when(a)).total_seconds() / 3600.0
                if hrs <= 0: continue
                dl = ((b["lo"] - a["lo"] + 180) % 360) - 180
                ml = math.radians(0.5 * (b["la"] + a["la"]))
                sm.append((dl * 111.2 * math.cos(ml) * 6 / hrs, (b["la"] - a["la"]) * 111.2 * 6 / hrs))
            motion = (float(np.mean([s[0] for s in sm])), float(np.mean([s[1] for s in sm]))) if sm else None

            ls, lw, _ = build_level_analysis_mean_route(cur, hist, np.ones(2, "float32"), base_lat, base_lon)
            local = weighted_route(ls, lw)
            mem, w, _ = build_pacific_route(fields, press, lat, lon, base_lat, base_lon, motion)
            route = LOCAL_WEIGHT * local + PACIFIC_WEIGHT * weighted_route(mem, w)

            la_, lo_ = base_lat, base_lon
            lats, lons = [], []
            for st in np.asarray(route, "float32"):
                la_ += float(st[1]) / 111.2
                lo_ += float(st[0]) / (111.2 * max(math.cos(math.radians(la_)), 0.20))
                lats.append(round(la_, 2)); lons.append(round(lo_, 2))

            ens = LOCAL_WEIGHT * local[None] + PACIFIC_WEIGHT * mem
            cone, members = [], []
            for lead in range(ens.shape[1]):
                d = []
                for m in range(ens.shape[0]):
                    a_, o_ = base_lat, base_lon
                    for k in range(lead + 1):
                        a_ += float(ens[m, k, 1]) / 111.2
                        o_ += float(ens[m, k, 0]) / (111.2 * max(math.cos(math.radians(a_)), 0.20))
                    d.append(km(lats[lead], lons[lead], a_, o_))
                cone.append(round(pct(d, CONE_PCT)))
            step = max(1, ens.shape[0] // KEEP_MEMBERS)
            for m in range(0, ens.shape[0], step):
                if len(members) >= KEEP_MEMBERS: break
                a_, o_, mla, mlo = base_lat, base_lon, [], []
                for k in range(ens.shape[1]):
                    a_ += float(ens[m, k, 1]) / 111.2
                    o_ += float(ens[m, k, 0]) / (111.2 * max(math.cos(math.radians(a_)), 0.20))
                    mla.append(round(a_, 2)); mlo.append(round(o_, 2))
                members.append({"lats": mla, "lons": mlo})

            run = {
                "issue_time_utc": issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "lead_hours": list(range(6, 121, 6)),
                "lats": lats, "lons": lons,
                "cone_km": cone, "cone_percentile": CONE_PCT,
                "member_count": int(ens.shape[0]), "members": members,
                "has_intensity": False,
            }

            if intensity:
                model, build_win, couple = intensity
                recs = []
                for p in pts[max(0, i - 8): i + 1]:
                    recs.append({"time_utc": p["t"] + "Z", "lat": float(p["la"]), "lon": float(p["lo"]),
                                 "vmax_kt": p.get("w"), "pressure_hpa": p.get("p"),
                                 "rmw_nm": None, "roci_nm": None, "dist2land_km": None,
                                 **{f"r{a}_{q}_nm": None for a in (34, 50, 64) for q in ("ne", "se", "sw", "nw")}})
                cw, cp = recs[-1]["vmax_kt"], recs[-1]["pressure_hpa"]
                if cw is not None and cp is not None:
                    tw, _, _ = build_win(recs, stats["tmean"].astype("float32"),
                                         stats["tstd"].astype("float32"), land_lat, land_lon)
                    u_dlm = np.tensordot(DLM_WEIGHTS, cur[:, 0], axes=(0, 0))
                    v_dlm = np.tensordot(DLM_WEIGHTS, cur[:, 1], axes=(0, 0))
                    _, mslp_prev = patch_at(stamps[2], *centres[0])
                    raw = np.stack([mslp0 - float(mslp0.mean()), mslp0 - mslp_prev, u_dlm, v_dlm], 0).astype("float32")
                    field = np.clip(raw / DLM4_SCALE[:, None, None], -4.0, 4.0).astype("float32")
                    prev = recs[-2] if len(recs) > 1 else recs[-1]
                    rows, _meta = model.predict(tw, field, float(cw), float(cp),
                                                float(prev["vmax_kt"] if prev["vmax_kt"] is not None else cw),
                                                float(prev["pressure_hpa"] if prev["pressure_hpa"] is not None else cp))
                    sf_, sp_, _ = forecast_pacific_state(fields, press)
                    rows, _ = couple(rows, sp_, sf_, lat, lon, base_lat, base_lon,
                                     [{"lead_hours": h, "lat": a, "lon": o}
                                      for h, a, o in zip(run["lead_hours"], lats, lons)], float(cw), float(cp))
                    run["vmax_kt"] = [round(float(r["vmax_kt"])) for r in rows]
                    run["pres_hpa"] = [round(float(r.get("pressure_hpa", r.get("central_pressure_hpa")))) for r in rows]
                    run["rmw_km"] = [round(float(r["rmw_km"])) for r in rows]
                    run["radii_km"] = [[round(float(x)) for x in r["wind_radii_km"]] for r in rows]
                    run["has_intensity"] = True

            # post-issue truth is used ONLY to score, never to forecast
            errs = []
            for k, h in enumerate(run["lead_hours"]):
                tgt = issue + dt.timedelta(hours=h)
                near = min(pts, key=lambda p: abs((when(p) - tgt).total_seconds()))
                if abs((when(near) - tgt).total_seconds()) <= 3 * 3600:
                    errs.append(km(float(near["la"]), float(near["lo"]), run["lats"][k], run["lons"][k]))
            if errs:
                run["track_mae_km"] = round(sum(errs) / len(errs), 1)
                run["scored_leads"] = len(errs)
            runs.append(run)
        except ArchiveUnreachable:
            # Not this initialisation's problem -- the archive is refusing
            # everything. Let it out of the per-init handler, or the breaker
            # trips on every init in turn and never actually stops anything:
            # one run spent 350 minutes on a single storm reporting "refused 12
            # ... 29 requests in a row", and the cross-era fallback, which is
            # keyed on this exception reaching the storm loop, never ran.
            raise
        except Exception as e:
            log(f"  init {issue:%Y-%m-%dT%H}Z skipped ({type(e).__name__}: {e})")
    return runs, None


def load_index():
    if INDEX.exists():
        try:
            return json.loads(INDEX.read_text())
        except Exception:
            pass
    return {"hindcasts": {}}


def save_index(index):
    INDEX.write_text(json.dumps(index, separators=(",", ":")) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sid", nargs="*", help="IBTrACS storm id(s)")
    ap.add_argument("--top", type=int, help="instead: the N most intense CFSR-era storms")
    ap.add_argument("--no-intensity", action="store_true")
    ap.add_argument("--skip-existing", action="store_true",
                    help="ignore storms already generated, so --top N resumes across runs")
    ap.add_argument("--era", choices=("cfsr", "cdas", "all"), default="all",
                    help="restrict by analysis source. cfsr is ~4.6 MB per analysis, "
                         "cdas ~78 MB -- the scheduled backfill uses cfsr for that reason")
    ap.add_argument("--retry-blocked", action="store_true",
                    help="ignore the unavailable ledger and try those storms again")
    ap.add_argument("--prune", action="store_true",
                    help="delete each storm's analyses after it is written (CI: a CDAS storm is ~3.7 GB)")
    args = ap.parse_args()

    catalogue = {}
    for path in sorted(SEASONS.glob("*.json")):
        year = int(path.stem)
        # both eras are reachable now; CDAS is simply far more expensive per analysis
        for sid, storm in json.loads(path.read_text()).items():
            # the archive switches product mid-2011, so test the storm's own last
            # observation rather than its season
            pts = storm.get("pts") or []
            if not pts:
                continue
            catalogue[sid] = (year, storm)

    if args.era != "all":
        want_cfsr = args.era == "cfsr"
        catalogue = {sid: (yr, st) for sid, (yr, st) in catalogue.items()
                     if needs_reanalysis(st) == want_cfsr}
        log(f"{args.era.upper()} era: {len(catalogue)} storms in scope")

    idx_now = load_index()
    done = set(idx_now.get("hindcasts", {})) if args.skip_existing else set()

    # Storms whose analyses simply are not published yet -- currently the 2026
    # season and a few gap months -- fail in seconds but sit at the top of the
    # ranking forever, so every run spent its first slots on the same ones and
    # built that many fewer real storms. Remember them and stand down for a
    # while; NCEI does eventually fill these in, so it is a pause, not a ban.
    blocked = {}
    if args.skip_existing and not args.retry_blocked:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RETRY_BLOCKED_DAYS)
        for sid, rec in (idx_now.get("unavailable") or {}).items():
            try:
                seen = dt.datetime.fromisoformat(rec["checked"].replace("Z", "+00:00"))
            except Exception:
                continue
            if seen > cutoff:
                blocked[sid] = rec
        if blocked:
            log(f"standing down on {len(blocked)} storm(s) with no analyses published "
                f"(retried after {RETRY_BLOCKED_DAYS} days)")

    if args.top:
        ranked = sorted(catalogue.items(),
                        key=lambda kv: -max((p.get("w") or 0) for p in kv[1][1]["pts"]))
        targets = [sid for sid, _ in ranked if sid not in done and sid not in blocked][: args.top]
        if not targets:
            log("nothing left to generate"); return
    else:
        targets = args.sid
    if not targets:
        ap.error("give a storm id or --top N")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = load_index()
    built = refused_storms = 0
    targets = list(targets)
    swapped = False
    i = 0
    while i < len(targets):
        sid = targets[i]
        i += 1
        if out_of_time():
            log(f"budget of {BUDGET_MIN:.0f} min reached; stopping with {built} built rather "
                f"than being killed with nothing committed")
            break
        if sid not in catalogue:
            log(f"{sid}: not in the CFSR-era season data; skipped"); continue
        year, storm = catalogue[sid]
        log(f"{storm.get('name', sid)} {year} ({sid}) …")
        _FULL.clear()
        _REFUSED.clear()
        try:
            runs, why = run_storm(sid, year, storm, intensity_on=not args.no_intensity)
        except ArchiveUnreachable as e:
            log(f"  {e}")
            refused_storms += 1
            # One service being blocked is not the archive being down. The
            # operational analysis (2011-04 onward) and the reanalysis (before
            # it) are separate services on separate paths and get refused
            # independently. Giving up here spent every scheduled run failing
            # against the blocked half while several hundred storms on the
            # reachable half sat there buildable.
            # Re-pick from the whole of the reachable era rather than from
            # whatever happens to be left in this run's shortlist -- the
            # shortlist is ranked by intensity, so it can easily be entirely
            # from the blocked era and leave hundreds of buildable storms out.
            want = not needs_reanalysis(storm)
            pool = sorted((kv for kv in catalogue.items() if needs_reanalysis(kv[1][1]) == want),
                          key=lambda kv: -max((p.get("w") or 0) for p in kv[1][1]["pts"]))
            rest = [s2 for s2, _ in pool
                    if s2 not in done and s2 not in blocked and s2 not in targets[:i]]
            rest = rest[: (args.top or len(rest))]
            if swapped or not rest:
                break
            swapped = True
            global _REFUSED_TOTAL
            _REFUSED_TOTAL = 0            # the other service gets its own budget
            targets = targets[:i] + rest
            log(f"  the other era is served by a different endpoint; continuing with "
                f"{len(rest)} storm(s) from it rather than abandoning the run")
            continue
        if not runs:
            log(f"  no runs ({why}); skipped")
            # Only a storm the archive actually answered about belongs in the
            # ledger. A refusal says nothing about whether the data exists, and
            # recording one would bench a perfectly good storm for three weeks.
            if _REFUSED:
                refused_storms += 1
                log(f"  ...the archive refused {len(_REFUSED)} request(s); not recording this "
                    f"as unavailable")
            else:
                index.setdefault("unavailable", {})[sid] = {
                    "storm": storm.get("name"), "season": year, "reason": str(why)[:160],
                    "checked": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
                save_index(index)
            continue
        built += 1
        if isinstance(index.get("unavailable"), dict):
            index["unavailable"].pop(sid, None)   # it built, so it is no longer blocked
        payload = {
            "storm": storm.get("name"), "sid": sid, "season": year,
            "model": "v62 causal route + v37G intensity/structure head",
            "source": ("NOAA CFSR 6-hourly low-resolution reanalysis (to 2011-03-31) / CDAS CFSv2 "
                       "6-hourly low-resolution analysis (from 2011-04-01, falling back to the "
                       "0.5 deg pressure file where it is missing), at or before each issue"),
            "resolution_note": ("2.5 deg throughout. CFSR checked against its 0.5 deg file on the "
                                "published Tip case at 138.6 km vs 141.2 km mean track error; CDAS "
                                "checked the same way on Meranti 2016 at 594.9 km vs 584.8 km, the "
                                "two tracks separating 39 km on average"),
            "future_rows_used_for_inference": 0,
            "official_forecasts_used_for_inference": False,
            "truth_used_for": "scoring only",
            "runs": runs,
        }
        out = OUT_DIR / f"{sid}.json"
        out.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        scored = [r["track_mae_km"] for r in runs if "track_mae_km" in r]
        index["hindcasts"][sid] = {
            "storm": storm.get("name"), "season": year, "runs": len(runs),
            "first_issue_utc": runs[0]["issue_time_utc"], "last_issue_utc": runs[-1]["issue_time_utc"],
            # count, not runs[0]: intensity is skipped only where the observed fix
            # lacks wind or pressure, so an early genesis row must not speak for the storm
            "intensity_runs": sum(1 for r in runs if r.get("has_intensity")),
            "mean_track_mae_km": round(sum(scored) / len(scored), 1) if scored else None,
            "file": f"v62/{sid}.json",
        }
        if args.prune:
            freed = 0
            for f in CACHE.glob("*.grb2"):
                freed += f.stat().st_size; f.unlink()
            _FULL.clear(); _FULL_ORDER.clear()
            log(f"  pruned {freed/1e9:.2f} GB of analyses")
        index["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        INDEX.write_text(json.dumps(index, separators=(",", ":")) + "\n")
        log(f"  {len(runs)} initialisations ({index['hindcasts'][sid]['intensity_runs']} with intensity), "
            f"{out.stat().st_size/1024:.0f} KB"
            + (f", mean {index['hindcasts'][sid]['mean_track_mae_km']} km over {len(scored)} scored" if scored else ""))

    if refused_storms and not built:
        # Exiting 0 here is how this went unnoticed: the archive was refusing
        # every request, each storm "skipped", and the job reported success
        # while producing nothing at all.
        log(f"FAILED: the archive refused every request for all {refused_storms} storm(s); "
            f"nothing was built. This is a block or an outage upstream, not missing data.")
        index["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_index(index)
        return 1

    index["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index["note"] = ("Per-storm v62 hindcasts, loaded lazily. History mode uses v62 wherever a run covers "
                     "the initialisation on screen and v23 elsewhere.")
    INDEX.write_text(json.dumps(index, separators=(",", ":")) + "\n")
    log(f"index -> {INDEX} ({len(index['hindcasts'])} storm(s))")


if __name__ == "__main__":
    raise SystemExit(main())
