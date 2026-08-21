"""Build Trackformer1.1 hindcasts for storms the reanalysis archive cannot reach.

The history builder needs NCEI's CFSR/CDAS reanalysis, which is not published
past mid-2025, so every 2025 and 2026 storm was stuck with nothing. But the
model does not actually require reanalysis: the live job has always run it on
NOAA GFS f000 analysis, and NOAA keeps a GFS archive going back years. NOMADS
only serves about ten days of it, which is the only reason past dates were out
of reach; the open-data S3 archive has the rest, and a GRIB .idx sidecar lets
the ten messages this model wants come down in ten range requests -- ~8 MB
against a 507 MB file.

So this drives the LIVE script's own GFS path over past initialisations rather
than re-implementing it. Same field construction, same weights, same causality
guard -- the runs it produces are the same kind of object the live job makes,
which is exactly what makes them comparable to the ones already published.

Observed fixes come from this site's IBTrACS best track instead of JMA's live
feed, since JMA's per-storm files are gone once a storm is over. Every fix is
still pushed through the causality guard, so a fix later than the issue time
raises rather than silently leaking the future into a hindcast.

    python3 scripts/hindcast_from_gfs_archive.py --sid 2026126N08148
    python3 scripts/hindcast_from_gfs_archive.py --season 2026 --limit 2
    python3 scripts/hindcast_from_gfs_archive.py --missing --limit 4 --budget-min 240
"""
import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
MODEL = HERE / "assets/typhoon-tracker/model"

# Where this model's hindcasts land. Defaulted to 1.1's paths so nothing about
# an existing run changes, but overridable, because the `model` input on the
# workflow used to switch the WEIGHTS while leaving these hardcoded: a 1.2 run
# would have fetched 1.2's checkpoints and then written its output over the 1.1
# hindcasts, destroying the baseline it exists to be compared against. Each
# model gets its own directory and its own index.
OUTDIR = MODEL / os.environ.get("TF_OUTDIR", "trackformer11")
INDEX = MODEL / os.environ.get("TF_INDEX", "trackformer11-hindcasts.json")

# The live driver whose field construction and heads this replays. 1.2 builds a
# different packet entirely (residual route head, 647-wide context), so it has
# its own driver and cannot be run through 1.1's.
DRIVER = os.environ.get("TF_DRIVER", "run_trackformer11_forecast.py")
SEASONS = HERE / "assets/data/typhoons/seasons"
CATALOGUE = HERE / "assets/data/typhoons/index.json"

START = time.time()
BUDGET_MIN = float(os.environ.get("TF11_BUDGET_MIN", "0") or 0)


def log(m):
    print(m, flush=True)


def out_of_time(extra=0.0):
    return BUDGET_MIN and (time.time() - START) / 60.0 + extra >= BUDGET_MIN


def load_live():
    """Import the live forecast script as a module and use its GFS path."""
    spec = importlib.util.spec_from_file_location(
        "tf11live", str(HERE / "scripts" / DRIVER))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def km(la1, lo1, la2, lo2):
    r = 6371.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def when(p):
    t = p["t"]
    return dt.datetime.fromisoformat(t).replace(tzinfo=dt.timezone.utc)


def storm_points(sid, season):
    f = SEASONS / f"{season}.json"
    if not f.exists():
        return None
    return (json.loads(f.read_text()).get(sid) or {}).get("pts")


def build_one(live, sid, name, season, pts, intensity_on=True):
    """Every initialisation with 24 h of history behind it and a lead ahead."""
    runs = []
    for i in range(4, len(pts) - 1):
        if out_of_time(2.0):
            log("  budget reached; stopping this storm here")
            break
        issue = when(pts[i])
        history = [p for p in pts[: i + 1] if p.get("la") is not None]
        if len(history) < 5:
            continue
        guard = live.Causality(issue)
        try:
            points = []
            for p in history:
                ms = int(when(p).timestamp() * 1000)
                guard.use("observed_fix", when(p).strftime("%Y-%m-%dT%H:%MZ"), when(p))
                points.append({"ms": ms, "lat": float(p["la"]), "lon": float(p["lo"]),
                               "wind": p.get("w"), "pres": p.get("p")})
            route = live.tf11_track(points, issue, guard)
            if not route:
                continue
            run = {"issue_time_utc": issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "lead_hours": [6 * (n + 1) for n in range(len(route["lats"]))],
                   "lats": route["lats"], "lons": route["lons"]}
            if route.get("cone_km"):
                run["cone_km"] = [round(float(c), 1) for c in route["cone_km"]]
                run["cone_percentile"] = route.get("cone_percentile", 90.0)
            if route.get("member_count"):
                run["member_count"] = route["member_count"]
            # Intensity is optional: a storm with no wind report anywhere in its
            # history cannot be encoded, and a track-only run is still worth
            # having. Never fabricate the missing half.
            if intensity_on:
                try:
                    fixes = live.tf10run.fixes_from_points(points)
                    if fixes:
                        field = live.field_patch(route["_paths"][route["_mains"][0]],
                                                 route["_paths"][route["_prevs"][0]],
                                                 route["_centers"][0])
                        route_points = [{"lead_hours": h, "lat": la, "lon": lo}
                                        for h, la, lo in zip(run["lead_hours"],
                                                             route["lats"], route["lons"])]
                        rows, meta = live.tf11_intensity(
                            fixes, field, route["_state_pressure"], route["_state_fields"],
                            route["_lat"], route["_lon"],
                            float(fixes[-1]["lat"]), float(fixes[-1]["lon"]), route_points)
                        if rows:
                            run["vmax_kt"] = [round(float(r["vmax_kt"]), 1) for r in rows]
                            run["pres_hpa"] = [
                                round(float(r.get("pressure_hpa",
                                                  r.get("central_pressure_hpa"))), 1)
                                for r in rows]
                            run["has_intensity"] = True
                            # No RMW and no quadrant radii. The structure head is
                            # residual: with no observed wind field to take a
                            # residual from, its radii are not noisy but wrong by
                            # an order of magnitude -- 9 km against an observed
                            # 272 km on the first live run -- and they would be
                            # drawn as rings on the map. IBTrACS best track here
                            # carries no quadrant radii to anchor on, so none ship.
                            run["structure_anchor"] = 0
                except Exception as e:                      # noqa: BLE001
                    log(f"  init {issue:%Y-%m-%dT%H}Z intensity skipped "
                        f"({type(e).__name__}: {e})")
            errs = []
            for k, h in enumerate(run["lead_hours"]):
                tgt = issue + dt.timedelta(hours=h)
                near = min(pts, key=lambda p: abs((when(p) - tgt).total_seconds()))
                if abs((when(near) - tgt).total_seconds()) <= 3 * 3600:
                    errs.append(km(float(near["la"]), float(near["lo"]),
                                   run["lats"][k], run["lons"][k]))
            if errs:
                run["track_mae_km"] = round(sum(errs) / len(errs), 1)
                run["scored_leads"] = len(errs)
            runs.append(run)
            log(f"  init {issue:%Y-%m-%dT%H}Z ok"
                + (f", {run['track_mae_km']} km" if "track_mae_km" in run else ""))
        except live.CausalityError as e:
            log(f"  init {issue:%Y-%m-%dT%H}Z refused by the causality guard: {e}")
        except Exception as e:                              # noqa: BLE001
            log(f"  init {issue:%Y-%m-%dT%H}Z skipped ({type(e).__name__}: {e})")
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid")
    ap.add_argument("--season", type=int)
    ap.add_argument("--missing", action="store_true",
                    help="every catalogued storm with no hindcast yet")
    ap.add_argument("--limit", type=int, default=1)
    ap.add_argument("--no-intensity", action="store_true")
    ap.add_argument("--list", action="store_true",
                    help="print the selected storm ids as JSON and exit, so a "
                         "workflow can fan them out across runners instead of "
                         "grinding through them on one")
    args = ap.parse_args()

    # A model's first batch has no index yet. Start one instead of dying.
    index = json.loads(INDEX.read_text()) if INDEX.exists() else {
        "note": "Per-storm Trackformer hindcasts, loaded lazily.",
        "hindcasts": {}, "unavailable": {}}
    index.setdefault("hindcasts", {})
    catalogue = json.loads(CATALOGUE.read_text())

    targets = []
    for c in catalogue:
        sid, season = c["sid"], int(c["season"])
        if args.sid and sid != args.sid:
            continue
        if args.season and season != args.season:
            continue
        if args.missing and sid in index["hindcasts"]:
            continue
        if not (args.sid or args.season or args.missing):
            continue
        targets.append(c)
    targets.sort(key=lambda c: c["start"], reverse=True)
    targets = targets[: args.limit]
    if args.list:
        print(json.dumps([c["sid"] for c in targets]))
        return 0

    if not targets:
        log("  nothing to do")
        return 0

    live = load_live()
    log(f"  {len(targets)} storm(s) to build")
    built = 0
    for c in targets:
        sid, season, name = c["sid"], int(c["season"]), c["name"]
        if out_of_time(5.0):
            log("  budget reached; stopping before the next storm")
            break
        pts = storm_points(sid, season)
        if not pts or len(pts) < 6:
            log(f"  {name} {season}: too few fixes; skipped")
            continue
        log(f"{name} {season} ({sid}) — {len(pts)} fixes")
        runs = build_one(live, sid, name, season, pts, not args.no_intensity)
        if not runs:
            log(f"  {name}: produced nothing")
            continue
        scored = [r["track_mae_km"] for r in runs if "track_mae_km" in r]
        payload = {
            "storm": name, "sid": sid, "season": season,
            "origin": "gfs-archive",
            "model": "Trackformer1.1 causal route",
            "source": ("NOAA GFS 0.25 degree f000 analysis from NOAA's open-data archive, "
                       "subset to the ten messages the model reads. Same analysis product and "
                       "same field construction the live job uses, replayed at each past "
                       "initialisation; every input is checked against the issue time."),
            "truth_used_for": "scoring only",
            "future_rows_used_for_inference": 0,
            "official_forecasts_used_for_inference": False,
            "runs": runs,
        }
        OUTDIR.mkdir(parents=True, exist_ok=True)
        (OUTDIR / f"{sid}.json").write_text(json.dumps(payload, separators=(",", ":")))
        index["hindcasts"][sid] = {
            "storm": name, "season": season, "runs": len(runs),
            "first_issue_utc": runs[0]["issue_time_utc"],
            "last_issue_utc": runs[-1]["issue_time_utc"],
            "intensity_runs": sum(1 for r in runs if r.get("has_intensity")),
            "mean_track_mae_km": round(sum(scored) / len(scored), 1) if scored else None,
            "origin": "gfs-archive",
            "file": f"trackformer11/{sid}.json",
        }
        (index.get("unavailable") or {}).pop(sid, None)
        INDEX.write_text(json.dumps(index, separators=(",", ":")))
        built += 1
        log(f"  {name}: {len(runs)} runs written, mean "
            f"{index['hindcasts'][sid]['mean_track_mae_km']} km")
    log(f"  built {built} storm(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
