#!/usr/bin/env python3
"""Live TrackFormer v62 causal track + v23 intensity, precomputed server-side.

v62 is a different kind of model from v23. It builds a broad causal atmospheric
state over the western Pacific from public GFS f000 *analysis* only, then
integrates a route out of the evolving pressure and flow field. The shipped
route is 75% local multi-level + 25% broad Pacific-domain, exactly as
scripts/run_public_data_v23_v62_comparison.py composes it in the research repo.

It forecasts position and nothing else -- there is no intensity decoder -- so
this script pairs it with the v23 10-seed fp32 ensemble, which supplies wind,
pressure, RMW and the 34/50/64 kt radii. The emitted JSON says which model
produced which field so nothing is misattributed downstream.

Causality: only f000 analysis cycles valid at or before the storm's own issue
time are opened. No positive forecast lead, no official JMA/JTWC forecast
track, and no post-issue observation reaches inference. Every analysis cycle
used is listed in the output.

If anything in the v62 path fails or is unavailable -- GFS cycle not posted
yet, storm too young to have 24 h of history, GRIB decode error -- the storm
falls back to the v23 track and says so in `track_source`, so the site degrades
to exactly its previous behaviour rather than losing a forecast.

Run by .github/workflows/refresh-typhoon-forecast.yml.
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(HERE))

# Reuse the verified JMA + Digital Typhoon fetching and the v23 ensemble rather
# than restating any of it.
import run_v23_forecast as v23run  # noqa: E402

# The v62 route modules live in yu314-coder/typhoon-predict; the workflow checks
# that repo out and points V62_SRC_DIR at its root.
V62_SRC = os.environ.get("V62_SRC_DIR", str(REPO_ROOT.parent / "typhoon-predict"))

OUT_PATH = REPO_ROOT / "assets" / "typhoon-tracker" / "model" / "v23-live-forecast.json"
GRIB_DIR = Path(os.environ.get("V62_GRIB_DIR", "/tmp/v62-grib"))
UA = {"User-Agent": "typhoon-tracker-forecast-bot/1.0 (+https://yu314-coder.github.io)"}

LEVELS = (850.0, 500.0, 200.0)
DLM_WEIGHTS = np.asarray([0.269, 0.500, 0.231], dtype="float32")
# The four dlm4 int8 channel scales the released cache normalises with. Copied
# from track_build/dlm4_int8.npz["scale"] -- four floats, so the 67 MB training
# archive that file also carries is not needed for inference.
DLM4_SCALE = np.asarray([4.7021923, 3.075009, 9.006815, 4.8768406], dtype="float32")
PACIFIC_WEIGHT = 0.25
LOCAL_WEIGHT = 1.0 - PACIFIC_WEIGHT


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# GFS f000 analysis: pick cycles, fetch from NOMADS, decode.
# ---------------------------------------------------------------------------
def gfs_url(key):
    """key is 'YYYYMMDD_HH'. Variable/level subsetting alone takes the global
    0.25-degree file to a few MB, which is what makes this viable in CI."""
    date, hour = key[:8], key[9:11]
    query = {
        "dir": f"/gfs.{date}/{hour}/atmos",
        "file": f"gfs.t{hour}z.pgrb2.0p25.f000",
        "lev_850_mb": "on", "lev_500_mb": "on", "lev_200_mb": "on",
        "lev_mean_sea_level": "on",
        "var_HGT": "on", "var_UGRD": "on", "var_VGRD": "on", "var_PRMSL": "on",
    }
    return "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?" + urllib.parse.urlencode(query)


def cycle_key(when):
    cyc = (when.hour // 6) * 6
    return when.strftime("%Y%m%d") + f"_{cyc:02d}"


def key_to_dt(key):
    return dt.datetime(int(key[:4]), int(key[4:6]), int(key[6:8]), int(key[9:11]), tzinfo=dt.timezone.utc)


def fetch_cycle(key):
    """Download one f000 analysis, cached on disk. Returns None if not posted."""
    GRIB_DIR.mkdir(parents=True, exist_ok=True)
    path = GRIB_DIR / f"gfs_{key}.grib2"
    if path.exists() and path.stat().st_size > 100_000:
        return path
    url = gfs_url(key)
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
    except Exception as e:
        log(f"  cycle {key}: fetch failed ({type(e).__name__}: {e})")
        return None
    if data[:1] == b"<" or len(data) < 100_000:
        log(f"  cycle {key}: not posted yet ({len(data)} bytes)")
        return None
    path.write_bytes(data)
    log(f"  cycle {key}: {len(data)/1e6:.1f} MB")
    return path


def _open(path, type_of_level):
    import xarray as xr
    return xr.open_dataset(
        path, engine="cfgrib",
        backend_kwargs={"filter_by_keys": {"typeOfLevel": type_of_level}, "indexpath": ""},
    )


def read_full(path):
    """Full-domain fields for the Pacific route: (7,H,W) = hgt500 + u/v at
    850/500/200, plus MSLP in hPa. Same channel order as the research repo's
    _read_grib so build_pacific_route reads what it expects."""
    pr = _open(path, "isobaricInhPa")
    sf = _open(path, "meanSea")
    try:
        pr = pr.sortby("latitude"); sf = sf.sortby("latitude")
        levels = np.asarray(pr["isobaricInhPa"].values, dtype="float32").reshape(-1)
        idx = [int(np.abs(levels - lv).argmin()) for lv in LEVELS]
        if any(abs(float(levels[i]) - lv) > 0.1 for i, lv in zip(idx, LEVELS)):
            raise RuntimeError(f"{path.name}: missing 850/500/200 hPa, has {levels.tolist()}")
        u = np.asarray(pr["u"].values, dtype="float32")
        v = np.asarray(pr["v"].values, dtype="float32")
        gh = np.asarray(pr["gh"].values, dtype="float32")
        lat = np.asarray(pr.latitude.values, dtype="float32")
        lon = np.asarray(pr.longitude.values, dtype="float32")
        mslp = np.asarray(sf["prmsl"].values, dtype="float32") / 100.0
        i850, i500, i200 = idx
        fields = np.stack([gh[i500], u[i850], v[i850], u[i500], v[i500], u[i200], v[i200]], axis=0)
    finally:
        pr.close(); sf.close()
    return fields.astype("float32"), mslp.astype("float32"), lat, lon


def _patch_grid(center):
    return center + (np.arange(17, dtype="float32") - 8.0) * 2.5


def read_patch(path, center_lat, center_lon):
    """Storm-centred 17x17 patch at 2.5 degrees: u/v at the three levels plus
    MSLP. Matches build_dolphin_analysis_causal_cache.py exactly."""
    pr = _open(path, "isobaricInhPa")
    sf = _open(path, "meanSea")
    try:
        pr = pr.sortby("latitude"); sf = sf.sortby("latitude")
        levels = np.asarray(pr["isobaricInhPa"].values, dtype="float32").reshape(-1)
        idx = [int(np.abs(levels - lv).argmin()) for lv in LEVELS]
        lat_g, lon_g = _patch_grid(center_lat), _patch_grid(center_lon % 360.0)
        u = np.asarray([pr["u"].isel(isobaricInhPa=i).interp(latitude=lat_g, longitude=lon_g).values for i in idx], dtype="float32")
        v = np.asarray([pr["v"].isel(isobaricInhPa=i).interp(latitude=lat_g, longitude=lon_g).values for i in idx], dtype="float32")
        mslp = np.asarray(sf["prmsl"].interp(latitude=lat_g, longitude=lon_g).values, dtype="float32") / 100.0
    finally:
        pr.close(); sf.close()
    for name, arr in (("u", u), ("v", v), ("mslp", mslp)):
        if not np.isfinite(arr).all():
            raise RuntimeError(f"{path.name}: non-finite {name} in storm patch")
    return u, v, mslp


# ---------------------------------------------------------------------------
# Track history helpers
# ---------------------------------------------------------------------------
def center_at(points, target, tol_hours=3.0):
    """Observed storm centre nearest an analysis time, or None if the track
    doesn't cover it. Never interpolates across a gap wider than tol_hours."""
    best, best_gap = None, None
    tms = target.timestamp() * 1000.0
    for p in points:
        gap = abs(p["ms"] - tms) / 3600000.0
        if best_gap is None or gap < best_gap:
            best, best_gap = p, gap
    if best is None or best_gap > tol_hours:
        return None
    return float(best["lat"]), float(best["lon"])


def recent_motion(points):
    """Current motion in km per 6 h, from observations at or before issue."""
    rows = points[-5:]
    samples = []
    for prev, cur in zip(rows, rows[1:]):
        hours = (cur["ms"] - prev["ms"]) / 3600000.0
        if hours <= 0:
            continue
        dlon = ((cur["lon"] - prev["lon"] + 180.0) % 360.0) - 180.0
        mlat = math.radians(0.5 * (cur["lat"] + prev["lat"]))
        east = dlon * 111.2 * math.cos(mlat)
        north = (cur["lat"] - prev["lat"]) * 111.2
        samples.append((east * 6.0 / hours, north * 6.0 / hours))
    if not samples:
        return None
    return (float(np.mean([s[0] for s in samples])), float(np.mean([s[1] for s in samples])))


# ---------------------------------------------------------------------------
# v62
# ---------------------------------------------------------------------------
def v62_track(points, issue):
    """Full v62 route for one storm, or None if it cannot run causally."""
    sys.path.insert(0, V62_SRC)
    from analysis_level_mean_route import build_level_analysis_mean_route
    from v61_big_system_route import weighted_route
    from v62_pacific_domain_route import build_pacific_route

    # Newest analysis cycle that is BOTH at or before the issue time and actually
    # posted. GFS f000 lands roughly 4 h after its cycle hour, so the cycle
    # matching the issue time is usually not there yet -- step back until one is
    # rather than giving up. Anything found this way is still causal, just older.
    paths = {}
    c0 = None
    for back in range(0, 30, 6):
        cand = cycle_key(issue - dt.timedelta(hours=back))
        if key_to_dt(cand) > issue:
            continue
        p = fetch_cycle(cand)
        if p is not None:
            c0, paths[cand] = cand, p
            break
    if c0 is None:
        log("  v62: no posted GFS analysis cycle at or before the issue time")
        return None

    base = key_to_dt(c0)
    lag_h = (issue - base).total_seconds() / 3600.0
    mains = [cycle_key(base - dt.timedelta(hours=h)) for h in (0, 12, 24)]
    prevs = [cycle_key(base - dt.timedelta(hours=h)) for h in (24, 36, 48)]

    centers = []
    for key in mains:
        c = center_at(points, key_to_dt(key))
        if c is None:
            log(f"  v62: no observed centre near {key}; track too short")
            return None
        centers.append(c)

    for key in sorted(set(mains + prevs)):
        if key in paths:
            continue
        p = fetch_cycle(key)
        if p is None:
            log(f"  v62: cycle {key} unavailable")
            return None
        paths[key] = p

    # local multi-level cache (the 75% term)
    cur_levels, hist_levels = None, []
    for i, (key, center) in enumerate(zip(mains, centers)):
        u, v, _ = read_patch(paths[key], center[0], center[1])
        stack = np.stack([u, v], axis=1).astype("float32")   # (3,2,17,17)
        if i == 0:
            cur_levels = stack
        else:
            hist_levels.append(stack)
    hist_levels = np.concatenate(hist_levels, axis=0)          # (6,2,17,17)
    available = np.ones((2,), dtype="float32")

    base_lat, base_lon = float(points[-1]["lat"]), float(points[-1]["lon"])
    local_states, local_weights, local_diag = build_level_analysis_mean_route(
        cur_levels, hist_levels, available, base_lat, base_lon)
    local_route = weighted_route(local_states, local_weights)

    # broad Pacific-domain route (the 25% term)
    fields, pressures = [], []
    lat = lon = None
    for key in mains:
        f, p, la, lo = read_full(paths[key])
        if lat is None:
            lat, lon = la, lo
        elif not (np.array_equal(lat, la) and np.array_equal(lon, lo)):
            raise RuntimeError("analysis grid changed between cycles")
        fields.append(f); pressures.append(p)
    fields = np.stack(fields).astype("float32")
    pressures = np.stack(pressures).astype("float32")

    members, weights, pac_diag = build_pacific_route(
        fields, pressures, lat, lon, base_lat, base_lon, recent_motion(points))
    pacific_route = weighted_route(members, weights)

    full = LOCAL_WEIGHT * local_route + PACIFIC_WEIGHT * pacific_route

    lats, lons = [], []
    la, lo = base_lat, base_lon
    for step in np.asarray(full, dtype="float32"):
        la += float(step[1]) / 111.2
        lo += float(step[0]) / (111.2 * max(math.cos(math.radians(la)), 0.20))
        lats.append(round(la, 3)); lons.append(round(lo, 3))

    return {
        "lats": lats, "lons": lons,
        "analysis_cycle": c0,
        "analysis_lag_hours": round(lag_h, 1),
        "cycles_used": sorted(set(mains + prevs)),
        "local_weight": LOCAL_WEIGHT, "pacific_weight": PACIFIC_WEIGHT,
        "domain": "100-190E, 0-60N",
        "source": "NOAA NOMADS GFS 0.25 degree f000 analysis only",
        "future_rows_used_for_inference": 0,
        "official_forecasts_used_for_inference": False,
    }


# ---------------------------------------------------------------------------
def process_storm(tc, models):
    tc_id = tc["tropicalCyclone"]
    spec = v23run.get_json(f"{v23run.JMA_BASE}{tc_id}/specifications.json")
    a = v23run.parse_jma(tc_id, spec)
    if not a:
        return None
    import re
    dt_id = "20" + a["number"] if re.match(r"^\d{4}$", a["number"] or "") else None
    dt_wind = dt_pres = None
    if dt_id:
        try:
            dt_wind = v23run.parse_dt_wind(v23run.get_text(f"{v23run.DT_WIND}{dt_id}.html.en"))
        except Exception as e:
            log(f"{tc_id}: DT wind page failed ({e})")
        try:
            dt_pres = v23run.parse_dt_pressure(v23run.get_text(f"{v23run.DT_TRACK}{dt_id}.html.en"))
        except Exception as e:
            log(f"{tc_id}: DT pressure page failed ({e})")

    raw = v23run.build_points(a, dt_wind, dt_pres)
    fixes = v23run.fixes_from_points(raw)
    if not fixes:
        return None

    out = v23run.run_forecast(models, fixes)
    out["tcId"] = tc_id
    out["name"] = a["name"]
    # v23 track kept verbatim so the comparison is always available
    out["v23_lats"] = list(out["lats"])
    out["v23_lons"] = list(out["lons"])
    out["intensity_source"] = "v23"

    issue = dt.datetime.fromisoformat(a["validUTC"].replace("Z", "+00:00"))
    pts = [{"ms": o["ms"], "lat": o["lat"], "lon": o["lon"]} for o in raw
           if o["lat"] is not None and o["lon"] is not None]
    v62 = None
    try:
        v62 = v62_track(pts, issue)
    except Exception as e:
        log(f"{tc_id}: v62 failed ({type(e).__name__}: {e})")
    if v62:
        out["lats"] = v62["lats"]
        out["lons"] = v62["lons"]
        out["track_source"] = "v62"
        out["v62"] = v62
        log(f"{tc_id} ({a['name']}): v62 track from {v62['analysis_cycle']}, v23 intensity")
    else:
        out["track_source"] = "v23"
        out["v62"] = None
        log(f"{tc_id} ({a['name']}): v62 unavailable, using v23 track")
    return out


def main():
    active = v23run.get_json(v23run.JMA_BASE + "targetTc.json")
    storms = {}
    if active:
        models = v23run.load_models()
        for tc in active:
            tc_id = tc.get("tropicalCyclone")
            try:
                r = process_storm(tc, models)
                if r:
                    storms[tc_id] = r
            except Exception as e:
                log(f"{tc_id}: skipped ({type(e).__name__}: {e})")
    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "storms": storms,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    log(f"wrote {OUT_PATH} ({len(storms)} storm(s))")


if __name__ == "__main__":
    main()
