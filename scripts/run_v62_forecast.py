#!/usr/bin/env python3
"""Live TrackFormer v62, precomputed server-side.

v62 builds a broad causal atmospheric state over the western Pacific from public
GFS f000 *analysis* only, integrates a route out of the evolving pressure and
flow field (75% local multi-level + 25% broad Pacific, as the research repo
composes it), and -- since its structure head landed -- also predicts maximum
wind, central pressure, RMW and the four-quadrant R34/R50/R64 radii from a
frozen three-member v37G ensemble coupled to that same causal pressure map.
The uncertainty cone is the 90th-percentile radius over v62's own route members.

CAUSALITY -- present and past weather only, enforced rather than asserted.
Every input this run opens is registered with its valid time and checked against
the storm's issue time before use (see the Causality class). A later-valid input
raises and the storm falls back rather than shipping a contaminated forecast.
Specifically refused: any positive GFS lead (only f000 is requested, and the URL
is verified), JMA's official forecast rows (spec[2:] -- only the Analysis row
spec[1] is read, and its advancedHours is asserted to be 0), and any observed
fix later than the issue. The audit ledger of every input opened, with its valid
time, is written into the output JSON.

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
# Causality guard.
#
# "No forecast data, only present and past" is enforced here rather than
# asserted in the output. Every input this run opens is registered with its
# valid time and checked against the storm's issue time; a violation raises and
# the storm falls back rather than shipping a contaminated forecast. The ledger
# is written into the JSON so the claim can be audited after the fact.
# ---------------------------------------------------------------------------
class CausalityError(RuntimeError):
    pass


class Causality:
    def __init__(self, issue):
        self.issue = issue
        self.inputs = []

    def use(self, kind, name, valid_time):
        """Register an input. Anything valid after the issue time is refused."""
        if valid_time is not None and valid_time > self.issue:
            raise CausalityError(
                f"{kind} '{name}' is valid {valid_time:%Y-%m-%dT%H:%MZ}, after the "
                f"issue time {self.issue:%Y-%m-%dT%H:%MZ} — refusing to use it")
        self.inputs.append({
            "kind": kind, "name": name,
            "valid_time_utc": valid_time.strftime("%Y-%m-%dT%H:%M:%SZ") if valid_time else None,
        })

    def use_analysis_url(self, key, url, valid_time):
        # f000 is the analysis. Any positive lead would be a forecast.
        if "f000" not in url:
            raise CausalityError(f"GFS request for {key} is not an f000 analysis: {url}")
        self.use("gfs_f000_analysis", key, valid_time)

    def ledger(self):
        latest = max((i["valid_time_utc"] for i in self.inputs if i["valid_time_utc"]), default=None)
        return {
            "issue_time_utc": self.issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "inputs_opened": self.inputs,
            "latest_input_valid_time_utc": latest,
            "future_rows_used_for_inference": 0,
            "official_forecasts_used_for_inference": False,
            "forecast_products_used": [],
            "enforcement": ("every input above was checked against the issue time before use; "
                            "a later-valid input raises CausalityError and the storm falls back"),
        }


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


def cone_from_members(local_route, members, base_lat, base_lon, lats, lons, pct=90.0):
    """Per-lead radius containing `pct` of v62's own route members, measured from
    the deterministic route. Members are blended with the local route exactly as
    the deterministic route is, so the spread is the real ensemble's."""
    members = np.asarray(members, dtype="float32")
    if members.ndim != 3 or not len(members):
        return None
    blended = LOCAL_WEIGHT * np.asarray(local_route, dtype="float32")[None, :, :] + PACIFIC_WEIGHT * members
    out = []
    for lead in range(blended.shape[1]):
        d = []
        for m in range(blended.shape[0]):
            la, lo = base_lat, base_lon
            for k in range(lead + 1):
                la += float(blended[m, k, 1]) / 111.2
                lo += float(blended[m, k, 0]) / (111.2 * max(math.cos(math.radians(la)), 0.20))
            dlon = ((lo - lons[lead] + 180.0) % 360.0) - 180.0
            d.append(math.hypot(dlon * 111.2 * math.cos(math.radians(0.5 * (la + lats[lead]))),
                                (la - lats[lead]) * 111.2))
        d.sort()
        k = (len(d) - 1) * pct / 100.0
        lo_i, hi_i = int(math.floor(k)), int(math.ceil(k))
        out.append(round(d[lo_i] if lo_i == hi_i else d[lo_i] + (d[hi_i] - d[lo_i]) * (k - lo_i), 1))
    return out


# ---------------------------------------------------------------------------
# v62 intensity / structure head (frozen v37G experts)
# ---------------------------------------------------------------------------
_INTENSITY = None


def intensity_model():
    global _INTENSITY
    if _INTENSITY is None:
        sys.path.insert(0, V62_SRC)
        from v62_intensity_structure import V62IntensityEnsemble
        root = Path(V62_SRC) / "v37" / "structure_spatial"
        _INTENSITY = V62IntensityEnsemble(root / "checkpoints",
                                          root / "v37g_intensity_calibration.json",
                                          device="cpu")
    return _INTENSITY


def field_patch(path_now, path_prev24, center):
    """The 4x17x17 v23-compatible analysis patch the structure head contracts for:
    SLP anomaly, 24 h SLP tendency, and the deep-layer-mean u/v — normalised by the
    dlm4 scale and clipped to +/-4. Both frames are sampled on the SAME storm centre,
    exactly as build_dolphin_analysis_causal_cache.py does."""
    u, v, mslp = read_patch(path_now, center[0], center[1])
    _, _, mslp_prev = read_patch(path_prev24, center[0], center[1])
    u_dlm = np.tensordot(DLM_WEIGHTS, u, axes=(0, 0))
    v_dlm = np.tensordot(DLM_WEIGHTS, v, axes=(0, 0))
    raw = np.stack([mslp - float(mslp.mean()), mslp - mslp_prev, u_dlm, v_dlm], axis=0).astype("float32")
    return np.clip(raw / DLM4_SCALE[:, None, None], -4.0, 4.0).astype("float32")


def intensity_records(fixes):
    """The v37G record schema. Anything genuinely unobserved for a live storm --
    RMW, ROCI, the quadrant radii -- is left as None so build_track_window flags it
    unavailable, rather than being invented."""
    rows = []
    for f in fixes:
        rows.append({
            "time_utc": f["time"] + ":00Z" if len(f["time"]) == 16 else f["time"],
            "lat": float(f["lat"]), "lon": float(f["lon"]),
            "vmax_kt": f["vmax_kt"],
            "pressure_hpa": f["pres_hpa"],
            "rmw_nm": None, "roci_nm": None, "dist2land_km": None,
            "r34_ne_nm": None, "r34_se_nm": None, "r34_sw_nm": None, "r34_nw_nm": None,
            "r50_ne_nm": None, "r50_se_nm": None, "r50_sw_nm": None, "r50_nw_nm": None,
            "r64_ne_nm": None, "r64_se_nm": None, "r64_sw_nm": None, "r64_nw_nm": None,
        })
    return rows


def v62_intensity(fixes, field, state_pressure, state_fields, lat, lon,
                  base_lat, base_lon, route_points):
    """vmax / central pressure / RMW / R34-R50-R64, then coupled to v62's own
    causal pressure-map state. Returns (rows, metadata) or (None, reason)."""
    sys.path.insert(0, V62_SRC)
    sys.path.insert(0, str(Path(V62_SRC) / "scripts"))
    # The window builder the v37G head was validated with. NOT run_v23's: that one
    # derives the seasonal phase from a numpy datetime64 minutes artefact and sets
    # 4 availability flags, where this sets 16 and uses a real per-row day-of-year.
    from predict_ibtracs_jma_only import build_track_window
    from v62_intensity_structure import couple_forecast_to_pressure_map

    stats = np.load(HERE / "v23" / "v23_norm_stats.npz")
    terrain = np.load(HERE / "v23" / "v23_terrain_wp.npz")
    rows_i, cols_i = np.where(terrain["lsm"] > 0.5)
    land_lat = terrain["lat"][rows_i].astype("float32")
    land_lon = terrain["lon"][cols_i].astype("float32")

    records = intensity_records(fixes)
    if not records:
        return None, "no observed fixes"
    track, _, _ = build_track_window(records, stats["tmean"].astype("float32"),
                                     stats["tstd"].astype("float32"), land_lat, land_lon)
    # A just-formed storm can have a single fix. build_track_window pads the window
    # by repeating the earliest row, and the reference runner uses the current fix as
    # its own predecessor in that case -- match it rather than refusing.
    cur = records[-1]
    prev = records[-2] if len(records) > 1 else cur
    if cur["vmax_kt"] is None or cur["pressure_hpa"] is None:
        return None, "current wind or pressure not reported"

    def fnum(x, fallback):
        return float(x) if x is not None else float(fallback)

    rows, meta = intensity_model().predict(
        track, field,
        float(cur["vmax_kt"]), float(cur["pressure_hpa"]),
        fnum(prev["vmax_kt"], cur["vmax_kt"]), fnum(prev["pressure_hpa"], cur["pressure_hpa"]))
    rows, map_meta = couple_forecast_to_pressure_map(
        rows, state_pressure, state_fields, lat, lon, base_lat, base_lon,
        route_points, float(cur["vmax_kt"]), float(cur["pressure_hpa"]))
    meta["pressure_map_coupling"] = map_meta
    return rows, meta


# ---------------------------------------------------------------------------
# v62
# ---------------------------------------------------------------------------
def v62_track(points, issue, guard):
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
            guard.use_analysis_url(cand, gfs_url(cand), key_to_dt(cand))
            c0, paths[cand] = cand, p
            break
    if c0 is None:
        log("  v62: no posted GFS analysis cycle at or before the issue time")
        return None

    base = key_to_dt(c0)
    lag_h = (issue - base).total_seconds() / 3600.0
    mains = [cycle_key(base - dt.timedelta(hours=h)) for h in (0, 12, 24)]
    prevs = [cycle_key(base - dt.timedelta(hours=h)) for h in (24, 36, 48)]

    # The t0 centre is mandatory. A storm younger than 24 h simply has no observed
    # position at t-12/t-24 -- that is a missing input, not a reason to refuse the
    # model. build_level_analysis_mean_route takes an availability pair for exactly
    # this and renormalises its snapshot weights, so the history slots are zero-filled
    # and flagged rather than fabricated, the same convention used everywhere else here.
    centers = [center_at(points, key_to_dt(mains[0]))]
    if centers[0] is None:
        log(f"  v62: no observed centre near {mains[0]}; cannot anchor the route")
        return None
    for key in mains[1:]:
        centers.append(center_at(points, key_to_dt(key)))
    available = np.asarray([1.0 if c is not None else 0.0 for c in centers[1:]], dtype="float32")
    if not available.all():
        missing = [k for k, c in zip(mains[1:], centers[1:]) if c is None]
        log(f"  v62: no observed centre at {', '.join(missing)}; "
            f"running on the current analysis alone (history flagged unavailable)")

    for key in sorted(set(mains + prevs)):
        if key in paths:
            continue
        p = fetch_cycle(key)
        if p is None:
            log(f"  v62: cycle {key} unavailable")
            return None
        guard.use_analysis_url(key, gfs_url(key), key_to_dt(key))
        paths[key] = p

    # local multi-level cache (the 75% term)
    u, v, _ = read_patch(paths[mains[0]], centers[0][0], centers[0][1])
    cur_levels = np.stack([u, v], axis=1).astype("float32")     # (3,2,17,17)
    hist_levels = []
    for key, center in zip(mains[1:], centers[1:]):
        if center is None:
            hist_levels.append(np.zeros((3, 2, 17, 17), dtype="float32"))
            continue
        hu, hv, _ = read_patch(paths[key], center[0], center[1])
        hist_levels.append(np.stack([hu, hv], axis=1).astype("float32"))
    hist_levels = np.concatenate(hist_levels, axis=0)           # (6,2,17,17)

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

    from v62_pacific_domain_route import forecast_pacific_state
    state_fields, state_pressure, _ = forecast_pacific_state(fields, pressures)
    full = LOCAL_WEIGHT * local_route + PACIFIC_WEIGHT * pacific_route

    lats, lons = [], []
    la, lo = base_lat, base_lon
    for step in np.asarray(full, dtype="float32"):
        la += float(step[1]) / 111.2
        lo += float(step[0]) / (111.2 * max(math.cos(math.radians(la)), 0.20))
        lats.append(round(la, 3)); lons.append(round(lo, 3))

    return {
        "lats": lats, "lons": lons,
        "_state_fields": state_fields, "_state_pressure": state_pressure,
        "_lat": lat, "_lon": lon, "_members": members, "_weights": weights,
        "_paths": paths, "_mains": mains, "_prevs": prevs, "_centers": centers,
        "_local_route": local_route,
        "analysis_cycle": c0,
        "analysis_lag_hours": round(lag_h, 1),
        "cycles_used": sorted(set(mains + prevs)),
        "local_weight": LOCAL_WEIGHT, "pacific_weight": PACIFIC_WEIGHT,
        "domain": "100-190E, 0-60N",
        "history_available": [float(x) for x in available],
        "source": "NOAA NOMADS GFS 0.25 degree f000 analysis only",
        "future_rows_used_for_inference": 0,
        "official_forecasts_used_for_inference": False,
    }


# ---------------------------------------------------------------------------
def process_storm(tc, models):
    tc_id = tc["tropicalCyclone"]
    spec = v23run.get_json(f"{v23run.JMA_BASE}{tc_id}/specifications.json")
    # spec[1] is JMA's Analysis; spec[2:] are its OFFICIAL FORECAST rows and must
    # never be read. Assert the row we take really is the analysis rather than
    # trusting its position.
    if len(spec) < 2 or (spec[1] or {}).get("advancedHours") not in (0, "0"):
        raise CausalityError(f"{tc_id}: spec[1] is not the analysis row "
                             f"(advancedHours={(spec[1] or {}).get('advancedHours')!r})")
    a = v23run.parse_jma(tc_id, spec)
    if not a:
        return None
    issue = dt.datetime.fromisoformat(a["validUTC"].replace("Z", "+00:00"))
    guard = Causality(issue)
    guard.use("jma_analysis", f"{tc_id}/specifications.json[1]", issue)

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
    # Every observed fix must be at or before the issue. Digital Typhoon is a
    # best-track archive, but this is checked rather than assumed.
    for o in raw:
        guard.use("observed_fix", dt.datetime.fromtimestamp(o["ms"] / 1000, dt.timezone.utc)
                  .strftime("%Y-%m-%dT%H:%MZ"),
                  dt.datetime.fromtimestamp(o["ms"] / 1000, dt.timezone.utc))
    fixes = v23run.fixes_from_points(raw)
    if not fixes:
        return None

    out = v23run.run_forecast(models, fixes)
    out["tcId"] = tc_id
    out["name"] = a["name"]
    out["v23_lats"] = list(out["lats"])      # kept so the comparison is always available
    out["v23_lons"] = list(out["lons"])

    pts = [{"ms": o["ms"], "lat": o["lat"], "lon": o["lon"]} for o in raw
           if o["lat"] is not None and o["lon"] is not None]
    v62 = None
    try:
        v62 = v62_track(pts, issue, guard)
    except CausalityError as e:
        log(f"{tc_id}: REFUSED — {e}")
    except Exception as e:
        log(f"{tc_id}: v62 track failed ({type(e).__name__}: {e})")

    if not v62:
        out["track_source"] = "v23"
        out["intensity_source"] = "v23"
        out["v62"] = None
        out["causality"] = guard.ledger()
        log(f"{tc_id} ({a['name']}): v62 unavailable, using v23 for track and intensity")
        return out

    out["lats"] = v62["lats"]
    out["lons"] = v62["lons"]
    out["track_source"] = "v62"

    # --- v62 intensity / structure ---------------------------------------
    intensity_note = None
    try:
        field = field_patch(v62["_paths"][v62["_mains"][0]],
                            v62["_paths"][v62["_prevs"][0]],
                            v62["_centers"][0])
        route_points = [{"lead_hours": h, "lat": la, "lon": lo}
                        for h, la, lo in zip(out["lead_hours"], v62["lats"], v62["lons"])]
        rows, meta = v62_intensity(fixes, field, v62["_state_pressure"], v62["_state_fields"],
                                   v62["_lat"], v62["_lon"],
                                   float(fixes[-1]["lat"]), float(fixes[-1]["lon"]), route_points)
        if rows:
            out["vmax_kt"] = [round(float(r["vmax_kt"]), 1) for r in rows]
            out["pres_hpa"] = [round(float(r.get("pressure_hpa", r.get("central_pressure_hpa"))), 1) for r in rows]
            out["rmw_km"] = [round(float(r["rmw_km"]), 1) for r in rows]
            out["radii_km"] = [[round(float(x), 1) for x in r["wind_radii_km"]] for r in rows]
            out["intensity_source"] = "v62"
            v62["intensity_model"] = meta
        else:
            intensity_note = meta
    except Exception as e:
        intensity_note = f"{type(e).__name__}: {e}"

    if out.get("intensity_source") != "v62":
        out["intensity_source"] = "v23"
        v62["intensity_fallback_reason"] = str(intensity_note)
        log(f"{tc_id}: v62 intensity unavailable ({intensity_note}); keeping v23 intensity")

    # cone from v62's own route members, so the drawn spread is its statistic
    try:
        v62["cone_km"] = cone_from_members(v62["_local_route"], v62["_members"],
                                           float(fixes[-1]["lat"]), float(fixes[-1]["lon"]),
                                           v62["lats"], v62["lons"])
        v62["cone_percentile"] = 90.0
        v62["member_count"] = int(np.asarray(v62["_members"]).shape[0])
    except Exception as e:
        log(f"{tc_id}: cone unavailable ({type(e).__name__}: {e})")

    for k in [k for k in v62 if k.startswith("_")]:
        v62.pop(k)
    out["v62"] = v62
    out["causality"] = guard.ledger()
    log(f"{tc_id} ({a['name']}): v62 track from {v62['analysis_cycle']}, "
        f"intensity={out['intensity_source']}")
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
