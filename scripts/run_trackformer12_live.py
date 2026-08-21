"""Live Trackformer 1.2 route for every storm JMA currently lists.

This runs BESIDE the 1.1 job rather than replacing it, and the distinction is
not cosmetic. Trackformer 1.2's route head corrects a base route, and the base
route it was trained against is a frozen upstream member that is not published.
Without it the release documents a kinematic persistence fallback and says it
"should be labeled as fallback inputs in any benchmark" -- so that is what this
writes, and the payload says so on every storm.

How much that matters, measured on Saudel at 2026-08-21T09Z: the checkpoint
caps its correction at 3.0 (300 km) while the persistence base route runs
2761 km by +120 h, so at long leads at most about a tenth of the track is the
model and the rest is persistence. The output carries `model_share_max` so the
page can be honest about it rather than implying a 398 km benchmark forecast.

Causality is enforced, not assumed: every observed fix and every analysis cycle
is pushed through the same guard the 1.1 job uses, so a JMA or Digital Typhoon
row later than the issue time raises rather than leaking a forecast in.
"""
import datetime as dt
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

import run_trackformer11_forecast as live11          # noqa: E402
import run_trackformer10_forecast as tf10            # noqa: E402

TF12_SRC = os.environ.get("TF12_SRC_DIR", os.environ.get("TF11_SRC_DIR", ""))
GEO_PATH = REPO / "assets/typhoon-tracker/model/static/tf12_route_geography.npz"
OUT_PATH = REPO / "assets/typhoon-tracker/model/trackformer12-live-forecast.json"
MODEL_ROOT = os.environ.get("TF12_MODELS_DIR", "")

# The model is called Trackformer 1.2. "1.2.28" is a build identifier the
# release carries internally -- a dev-side number, not the public name.
#
# The point of the check below is NOT the string. It is that the module and
# the checkpoints came from the SAME archive: they used to be assembled from
# two places (module from the branch tip, weights from a release), which is
# how code and checkpoints drift apart without anyone noticing. The payload is
# served as provenance, so refuse rather than publish an unchecked pairing.
#
# The strong check is the manifest's release_tag, which survives renames.
# MODEL_VERSION is an allowlist because upstream renamed it "1.2.28" -> "1.2"
# on the branch tip (c02c9d2) while the shipped archive still says "1.2.28";
# pinning one literal would refuse to publish the moment a release is cut from
# that tip, silently taking the overlay off the site.
MODEL_NAME = "Trackformer 1.2"
RELEASE_TAG = os.environ.get("TF12_RELEASE_TAG", "trackformer-1.2.28")
ALLOWED_BUILDS = [v.strip() for v in
                  os.environ.get("TF12_EXPECT_VERSION", "1.2.28,1.2").split(",")
                  if v.strip()]


def log(m):
    print(m, flush=True)


def load_tf12():
    sys.path.insert(0, TF12_SRC)
    import trackformer_1_2 as tf12
    got = getattr(tf12, "MODEL_VERSION", None)
    if ALLOWED_BUILDS and got not in ALLOWED_BUILDS:
        raise SystemExit(
            "refusing to publish: loaded trackformer_1_2 reports MODEL_VERSION "
            "%r, which is not among the builds this job accepts (%s). If a new "
            "release renamed it, add it to TF12_EXPECT_VERSION deliberately."
            % (got, ", ".join(ALLOWED_BUILDS)))

    # Weights and module must be the same release. The manifest ships beside
    # the checkpoints, so its release_tag is what actually proves it.
    manifest = Path(MODEL_ROOT) / "manifest.json" if MODEL_ROOT else None
    tag = None
    if manifest and manifest.exists():
        tag = (json.loads(manifest.read_text()) or {}).get("release_tag")
        if RELEASE_TAG and tag and tag != RELEASE_TAG:
            raise SystemExit(
                "refusing to publish: the checkpoints beside this module are "
                "from release %r but the job fetched %r. The module and the "
                "weights are not the same release." % (tag, RELEASE_TAG))
    else:
        log("  note: no manifest beside the checkpoints; release_tag unverified")
    log(f"  {MODEL_NAME} (build {got}) from {tag or RELEASE_TAG}")
    return tf12


def regrid(path, lat, lon):
    """The 10 GFS messages the fetcher already pulls, on the released route grid."""
    import xarray as xr
    def op(level):
        return xr.open_dataset(path, engine="cfgrib",
                               backend_kwargs={"filter_by_keys": {"typeOfLevel": level},
                                               "indexpath": ""})
    msl, iso = op("meanSea"), op("isobaricInhPa")
    def rg(da):
        return da.sortby("latitude").interp(latitude=lat, longitude=lon,
                                            method="linear").values.astype("float32")
    slp = rg(msl["prmsl"]) / 100.0
    lev = lambda name, L: rg(iso[name].sel(isobaricInhPa=L))
    h500 = lev("gh", 500)
    seven = np.stack([h500, lev("u", 850), lev("v", 850), lev("u", 500),
                      lev("v", 500), lev("u", 200), lev("v", 200)]).astype("float32")
    return slp, h500, seven


def great_circle_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def six_hour_step(a, b):
    """Observed displacement between two fixes, scaled to six hours, in 100 km."""
    (la1, lo1, t1), (la2, lo2, t2) = a, b
    hours = (t2 - t1).total_seconds() / 3600.0
    if hours <= 0:
        return np.zeros(2, dtype="float32")
    scale = 6.0 / hours
    dx = ((lo2 - lo1 + 180.0) % 360.0 - 180.0) * 111.2 * math.cos(math.radians((la1 + la2) / 2))
    return np.array([dx * scale / 100.0, (la2 - la1) * 111.2 * scale / 100.0], dtype="float32")


def observed_history(tc_id, analysis, guard):
    """JMA analysis plus Digital Typhoon best track, every row guarded."""
    dt_id = "20" + analysis["number"] if re.match(r"^\d{4}$", analysis["number"] or "") else None
    wind = pres = None
    if dt_id:
        try:
            wind = tf10.parse_dt_wind(tf10.get_text(f"{tf10.DT_WIND}{dt_id}.html.en"))
        except Exception as e:                                  # noqa: BLE001
            log(f"  {tc_id}: DT wind unavailable ({type(e).__name__})")
        try:
            pres = tf10.parse_dt_pressure(tf10.get_text(f"{tf10.DT_TRACK}{dt_id}.html.en"))
        except Exception as e:                                  # noqa: BLE001
            log(f"  {tc_id}: DT pressure unavailable ({type(e).__name__})")
    issue = dt.datetime.fromisoformat(analysis["validUTC"].replace("Z", "+00:00"))
    rows = []
    for o in tf10.build_points(analysis, wind, pres):
        when = dt.datetime.fromtimestamp(o["ms"] / 1000, dt.timezone.utc)
        guard.use("observed_fix", when.strftime("%Y-%m-%dT%H:%MZ"), when)
        rows.append((float(o["lat"]), float(o["lon"]), when))
    guard.use("jma_analysis", f"{tc_id}/specifications.json[1]", issue)
    rows.append((float(analysis["lat"]), float(analysis["lon"]), issue))
    # The analysis row usually repeats the last best-track fix. Left in, the six
    # hour displacement collapses to zero and the storm is forecast to stand still.
    seen, out = set(), []
    for row in sorted((r for r in rows if r[2] <= issue), key=lambda r: r[2]):
        if row[2] in seen:
            out[-1] = row
        else:
            seen.add(row[2])
            out.append(row)
    return out, issue


def main():
    tf12 = load_tf12()
    lat, lon = tf12.ROUTE_LATITUDES, tf12.ROUTE_LONGITUDES
    geo = np.load(GEO_PATH, allow_pickle=True)
    static_map, glat, glon = geo["static_map"], geo["lat"], geo["lon"]
    names = [str(x) for x in geo["names"]]
    model = tf12.Trackformer12(MODEL_ROOT or TF12_SRC, device="cpu")
    stats = np.load(Path(model.model_root) / "trackformer_1_2_system_context_stats.npz")

    active = live11.active_storms()
    storms, failures = {}, []
    for entry in active:
        tc_id = entry.get("tropicalCyclone")
        try:
            spec = tf10.get_json(f"{tf10.JMA_BASE}{tc_id}/specifications.json")
            analysis = tf10.parse_jma(tc_id, spec)
            if not analysis:
                log(f"  {tc_id}: no analysis row"); continue
            issue = dt.datetime.fromisoformat(analysis["validUTC"].replace("Z", "+00:00"))
            guard = live11.Causality(issue)
            history, issue = observed_history(tc_id, analysis, guard)
            if len(history) < 3:
                log(f"  {tc_id}: {len(history)} distinct fix(es); motion needs three")
                continue
            cycles = []
            for back in (0, 6, 12):
                want = issue - dt.timedelta(hours=back)
                key = live11.cycle_key(want)
                path = live11.fetch_cycle(key)
                if path is None:
                    raise RuntimeError(f"GFS cycle {key} unavailable")
                guard.use_analysis_url(key, live11.gfs_url(key), live11.key_to_dt(key))
                cycles.append(regrid(path, lat, lon))
            slp3 = np.stack([c[0] for c in cycles])[None]
            h5003 = np.stack([c[1] for c in cycles])[None]
            field = tf12.prepare_route_field(slp3, h5003)
            lat0, lon0 = history[-1][0], history[-1][1]
            current = six_hour_step(history[-2], history[-1])
            previous = six_hour_step(history[-3], history[-2])
            base_position = tf12.build_kinematic_base_position(current[None], previous[None])
            base_route = np.repeat(current[None][:, None, :], tf12.LEADS, axis=1).astype("float32")
            synoptic = tf12.build_synoptic_features(slp3, h5003, lat, lon, lat0, lon0)
            # channel_names is optional, but it is checked against
            # ROUTE_SYSTEM_CHANNELS -- so passing it turns a silently permuted
            # analysis stack into an exception instead of a plausible wrong
            # forecast. The order below is the one regrid() stacks.
            system = tf12.build_route_system_features(
                cycles[0][2][None], cycles[1][2][None], lat, lon, lat0, lon0, 0.0, 1.0,
                feature_mean=stats["system_mean"], feature_std=stats["system_std"],
                channel_names=("hgt500", "uwnd850", "vwnd850", "uwnd500",
                               "vwnd500", "uwnd200", "vwnd200"))
            near = [(float(o["lat"]), float(o["lon"]), float(o.get("windKt") or 0.0))
                    for o in (tf10.parse_jma(x.get("tropicalCyclone"),
                              tf10.get_json(f"{tf10.JMA_BASE}{x.get('tropicalCyclone')}"
                                            "/specifications.json")) or {}
                              for x in active if x.get("tropicalCyclone") != tc_id) if o]
            if near:
                nl = np.array([[o[0] for o in near]], dtype="float32")
                no = np.array([[o[1] for o in near]], dtype="float32")
                nv = np.array([[o[2] for o in near]], dtype="float32")
                na = np.zeros_like(nl)
            else:
                nl = no = nv = na = np.zeros((1, 1), dtype="float32")
            interaction = tf12.build_nearby_interaction_features(
                nl, no, nv, na, lat0, lon0,
                feature_mean=stats["interaction_mean"], feature_std=stats["interaction_std"])
            geography = tf12.build_route_geography_features(
                base_position, lat0, lon0, glat, glon, static_map, names)
            kinematic = tf12.build_route_kinematic_features(current[None], previous[None], lat0, lon0)
            context = tf12.build_route_context(synoptic, system, interaction, geography,
                                               kinematic, base_route, base_position)
            route = model.predict_route(field, context, base_position)
            lats, lons = tf12.local_position_to_latlon(route["position_100km"], lat0, lon0)
            # How far the route travels, so the share attributable to the model
            # rather than to the persistence base route can be stated rather than
            # left for a reader to assume.
            total = sum(great_circle_km(float(lats[0][k]), float(lons[0][k]),
                                        float(lats[0][k + 1]), float(lons[0][k + 1]))
                        for k in range(len(lats[0]) - 1))
            storms[tc_id] = {
                "tcId": tc_id, "name": analysis["name"],
                "issue_time": issue.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "base_lat": lat0, "base_lon": lon0,
                "lead_hours": list(tf12.LEAD_HOURS),
                "lats": [round(float(x), 3) for x in lats[0]],
                "lons": [round(float(x), 3) for x in lons[0]],
                "land_probability": [round(float(x), 3) for x in route["land_probability"][0]],
                "model": MODEL_NAME + " route head",
                "base_route": "kinematic persistence fallback",
                "base_route_note": ("The incumbent base route this checkpoint was trained "
                                    "around is not published. This uses the release's "
                                    "documented persistence fallback, so at long leads most "
                                    "of the displacement is persistence rather than the model."),
                "max_correction_km": 300.0,
                "track_length_km": round(total, 1),
                "model_share_max": round(min(1.0, 300.0 / total), 3) if total > 0 else None,
                "causality": guard.ledger(),
                "fixes_used": len(history),
            }
            log(f"  {tc_id} {analysis['name']}: route from {lat0:.1f}N {lon0:.1f}E, "
                f"{len(history)} fixes")
        except Exception as e:                                  # noqa: BLE001
            failures.append(f"{tc_id}: {type(e).__name__}: {e}")
            log(f"  {tc_id}: skipped ({type(e).__name__}: {e})")

    if active and not storms and failures:
        for line in failures:
            log(f"  {line}")
        log(f"{len(active)} storm(s) active and none forecast; leaving {OUT_PATH.name} alone")
        return 1
    OUT_PATH.write_text(json.dumps({
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": MODEL_NAME,
        # The public name does not identify a build. Record the build that was
        # ACTUALLY loaded -- read off the module, not the value this job hoped
        # for -- so a published forecast can be reproduced from what ran.
        "model_build": getattr(tf12, "MODEL_VERSION", None),
        "release_tag": RELEASE_TAG,
        "note": ("Route head only. The base route is the release's documented kinematic "
                 "persistence fallback, not the private incumbent route, so this is not the "
                 "configuration behind the published matched-storm benchmark."),
        "storms": storms,
    }, separators=(",", ":")))
    log(f"  wrote {len(storms)} storm(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
