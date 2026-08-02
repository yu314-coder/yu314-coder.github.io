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
# CFSv2/CDAS takes over on 2011-04-01. There is no low-resolution equivalent and no
# .idx sidecar, so each analysis is the full 78 MB pressure-level file -- roughly 17x
# the CFSR era. Ranged self-indexing was measured and is slower than just fetching:
# walking the GRIB message chain did not clear 40 of ~550 messages in two minutes.
CDAS = ("https://www.ncei.noaa.gov/data/climate-forecast-system/access/operational-analysis/"
        "6-hourly-by-pressure/{y}/{ym}/{ymd}/cdas1.t{hh}z.pgrbhanl.grib2")
UA = {"User-Agent": "typhoon-tracker-history-builder/1.0 (+https://yu314-coder.github.io)"}

LEVELS = (850.0, 500.0, 200.0)
DLM_WEIGHTS = np.asarray([0.269, 0.500, 0.231], dtype="float32")
DLM4_SCALE = np.asarray([4.7021923, 3.075009, 9.006815, 4.8768406], dtype="float32")
PACIFIC_WEIGHT, LOCAL_WEIGHT = 0.25, 0.75
KEEP_MEMBERS = 20          # drawn routes kept per initialisation
CONE_PCT = 90.0
# The analysis archive changes product mid-2011, not at a year boundary:
#   CFSR   1979-01-01 .. 2011-03-31
#   CDAS   2011-04-01 onward   (CFSv2; NCEI operational-analysis/6-hourly-by-pressure,
#                               cdas1.tHHz.pgrbhanl.grib2 -- 78 MB, no .idx sidecar,
#                               so it is not yet wired up here)
CFSR_END = dt.datetime(2011, 3, 31, 18, tzinfo=dt.timezone.utc)


def log(m):
    print(m, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
def analysis_url(stamp):
    """CFSR before 2011-04-01, CDAS/CFSv2 from it. The archive changes product
    mid-season, so this is decided per analysis time, not per year."""
    when = dt.datetime.strptime(stamp, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    if when <= CFSR_END:
        return CFSR.format(y=stamp[:4], ym=stamp[:6], ymd=stamp[:8], t=stamp), "CFSR"
    return CDAS.format(y=stamp[:4], ym=stamp[:6], ymd=stamp[:8], hh=stamp[8:]), "CDAS"


def cfsr_path(stamp):
    """stamp is YYYYMMDDHH. Downloaded once, then reused across every
    initialisation that needs it -- consecutive inits share four of five."""
    CACHE.mkdir(parents=True, exist_ok=True)
    url, kind = analysis_url(stamp)
    p = CACHE / f"{kind.lower()}.{stamp}.grb2"
    if p.exists() and p.stat().st_size > 500_000:
        return p
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if len(data) < 500_000 or data[:4] != b"GRIB":
        raise RuntimeError(f"CFSR {stamp}: not a GRIB file ({len(data)} bytes)")
    p.write_bytes(data)
    return p


_FULL, _PATCH = {}, {}


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
                lats.append(round(la_, 3)); lons.append(round(lo_, 3))

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
                cone.append(round(pct(d, CONE_PCT), 1))
            step = max(1, ens.shape[0] // KEEP_MEMBERS)
            for m in range(0, ens.shape[0], step):
                if len(members) >= KEEP_MEMBERS: break
                a_, o_, mla, mlo = base_lat, base_lon, [], []
                for k in range(ens.shape[1]):
                    a_ += float(ens[m, k, 1]) / 111.2
                    o_ += float(ens[m, k, 0]) / (111.2 * max(math.cos(math.radians(a_)), 0.20))
                    mla.append(round(a_, 3)); mlo.append(round(o_, 3))
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
                    run["vmax_kt"] = [round(float(r["vmax_kt"]), 1) for r in rows]
                    run["pres_hpa"] = [round(float(r.get("pressure_hpa", r.get("central_pressure_hpa"))), 1) for r in rows]
                    run["rmw_km"] = [round(float(r["rmw_km"]), 1) for r in rows]
                    run["radii_km"] = [[round(float(x), 1) for x in r["wind_radii_km"]] for r in rows]
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


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sid", nargs="*", help="IBTrACS storm id(s)")
    ap.add_argument("--top", type=int, help="instead: the N most intense CFSR-era storms")
    ap.add_argument("--no-intensity", action="store_true")
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

    if args.top:
        ranked = sorted(catalogue.items(),
                        key=lambda kv: -max((p.get("w") or 0) for p in kv[1][1]["pts"]))
        targets = [sid for sid, _ in ranked[: args.top]]
    else:
        targets = args.sid
    if not targets:
        ap.error("give a storm id or --top N")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = load_index()
    for sid in targets:
        if sid not in catalogue:
            log(f"{sid}: not in the CFSR-era season data; skipped"); continue
        year, storm = catalogue[sid]
        log(f"{storm.get('name', sid)} {year} ({sid}) …")
        _FULL.clear()
        runs, why = run_storm(sid, year, storm, intensity_on=not args.no_intensity)
        if not runs:
            log(f"  no runs ({why}); skipped"); continue
        payload = {
            "storm": storm.get("name"), "sid": sid, "season": year,
            "model": "v62 causal route + v37G intensity/structure head",
            "source": ("NOAA CFSR 6-hourly low-resolution reanalysis (to 2011-03-31) / CDAS CFSv2 "
                       "pressure-level analysis (from 2011-04-01), at or before each issue"),
            "resolution_note": ("2.5 deg CFSR; validated against the 0.5 deg file on the published Tip "
                                "case at 138.6 km vs 141.2 km mean track error, tracks separating ~15 km"),
            "future_rows_used_for_inference": 0,
            "official_forecasts_used_for_inference": False,
            "truth_used_for": "scoring only",
            "runs": runs,
        }
        out = OUT_DIR / f"{sid}.json"
        out.write_text(json.dumps(payload) + "\n")
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
        log(f"  {len(runs)} initialisations ({index['hindcasts'][sid]['intensity_runs']} with intensity), "
            f"{out.stat().st_size/1024:.0f} KB"
            + (f", mean {index['hindcasts'][sid]['mean_track_mae_km']} km over {len(scored)} scored" if scored else ""))

    index["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index["note"] = ("Per-storm v62 hindcasts, loaded lazily. History mode uses v62 wherever a run covers "
                     "the initialisation on screen and v23 elsewhere.")
    INDEX.write_text(json.dumps(index, indent=2) + "\n")
    log(f"index -> {INDEX} ({len(index['hindcasts'])} storm(s))")


if __name__ == "__main__":
    main()
