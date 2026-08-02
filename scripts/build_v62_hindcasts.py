#!/usr/bin/env python3
"""Publish v62 runs for the track-history explorer.

Track-history mode cannot call v62 the way live mode does. v62 integrates a
route from real analysis fields, and for a past storm those mostly do not exist:
NOMADS keeps about nine days of GFS (measured -9 d serves, -10 d 404, older
403) against an explorer covering 1979 and 1985-present -- the Tip 1979 case
uses CFSR reanalysis for exactly that reason. History mode also re-forecasts on
every slider move, client-side and instantly, while one v62 initialisation needs
~34 MB of GRIB decoded first.

So published v62 runs are turned into a static file instead. Point this at
yu314-coder/typhoon-predict's track_build/*_v62_pacific_domain_case_map.json
manifests -- those carry the full v62 state, not just the route:

    track      lat/lon at 20 six-hour leads
    intensity  vmax, central pressure, RMW  (frozen v37G structure head,
               coupled to the causal pressure map)
    structure  four-quadrant R34/R50/R64
    ensemble   189 route members -> a cone from v62's OWN spread

Because the structure head landed, v62 no longer needs v23 for anything here.
The cone is now v62's own member spread rather than borrowed error statistics.

Re-run this whenever a new v62 case is published and that storm lights up in the
explorer. A manifest that cannot be matched to a storm in the season data is
reported and skipped, never guessed at.
"""
import datetime as dt
import json
import math
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEASONS = REPO_ROOT / "assets" / "data" / "typhoons" / "seasons"
OUT = REPO_ROOT / "assets" / "typhoon-tracker" / "model" / "v62-hindcasts.json"
RAW = "https://raw.githubusercontent.com/yu314-coder/typhoon-predict/main/"
MANIFESTS = (
    "track_build/tip_v62_pacific_domain_case_map.json",
    "track_build/dolphin_v62_pacific_domain_case_map.json",
)
UA = {"User-Agent": "typhoon-tracker-hindcast-builder/1.0"}
SPAGHETTI_MEMBERS = 40      # drawn routes; the file keeps this many of the 189
CONE_PERCENTILE = 90.0


def log(m):
    print(m, file=sys.stderr, flush=True)


def fetch(path):
    with urllib.request.urlopen(urllib.request.Request(RAW + path, headers=UA), timeout=90) as r:
        return json.load(r)


def parse_iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def normalize(manifest):
    """Both manifest shapes -> one case dict. Tip is wrapped in cases[] with a
    score; Dolphin is flat and live (no post-issue truth to score against)."""
    if isinstance(manifest.get("cases"), list) and manifest["cases"]:
        case = dict(manifest["cases"][0])
        case.setdefault("storm", manifest.get("storm"))
        case.setdefault("observed", case.get("observed_before_issue"))
        return case
    case = dict(manifest)
    case.setdefault("storm", manifest.get("storm"))
    return case


def km_between(lat1, lon1, lat2, lon2):
    dlon = ((lon2 - lon1 + 180.0) % 360.0) - 180.0
    return math.hypot(dlon * 111.2 * math.cos(math.radians(0.5 * (lat1 + lat2))),
                      (lat2 - lat1) * 111.2)


def percentile(values, pct):
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * pct / 100.0
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return v[lo] if lo == hi else v[lo] + (v[hi] - v[lo]) * (k - lo)


def cone_from_members(fc, members):
    """Per-lead radius containing CONE_PERCENTILE of the members, measured from
    the deterministic route. v62's own spread -- nothing borrowed."""
    if not members:
        return None
    out = []
    for i, p in enumerate(fc):
        d = []
        for m in members:
            if i < len(m):
                d.append(km_between(p["lat"], p["lon"], m[i]["lat"], m[i]["lon"]))
        out.append(round(percentile(d, CONE_PERCENTILE) or 0.0, 1))
    return out


def match_storm(name, issue):
    season = SEASONS / f"{issue.year}.json"
    if not season.exists():
        return None, f"no season file for {issue.year}"
    data = json.loads(season.read_text(encoding="utf-8"))
    want = (name or "").strip().lower()
    for sid, storm in data.items():
        if (storm.get("name") or "").strip().lower() != want:
            continue
        pts = storm.get("pts") or []
        if not pts:
            continue

        def as_dt(t):
            return parse_iso(t if ("Z" in t or "+" in t) else t + "Z")

        if as_dt(pts[0]["t"]) <= issue <= as_dt(pts[-1]["t"]):
            return sid, None
        return None, f"'{name}' found ({sid}) but issue {issue:%Y-%m-%d %H:%M} outside its track"
    return None, f"'{name}' not in {issue.year} season data (not archived yet?)"


def main():
    out, skipped = {}, []
    for path in MANIFESTS:
        try:
            case = normalize(fetch(path))
        except Exception as e:
            log(f"skip {path}: {type(e).__name__}: {e}")
            skipped.append({"manifest": path, "reason": str(e)})
            continue
        fc = case.get("forecast") or []
        if not fc:
            skipped.append({"manifest": path, "reason": "no forecast"})
            continue
        issue = parse_iso(case["issue_time_utc"])
        sid, why = match_storm(case.get("storm"), issue)
        if not sid:
            log(f"skip {path}: {why}")
            skipped.append({"manifest": path, "storm": case.get("storm"), "reason": why})
            continue

        members = case.get("ensemble_forecasts") or []
        step = max(1, len(members) // SPAGHETTI_MEMBERS)
        kept = members[::step][:SPAGHETTI_MEMBERS]
        score = case.get("score") or {}
        has_intensity = "vmax_kt" in fc[0]

        entry = {
            "issue_time_utc": case["issue_time_utc"],
            "lead_hours": [int(p["lead_hours"]) for p in fc],
            "lats": [round(float(p["lat"]), 3) for p in fc],
            "lons": [round(float(p["lon"]), 3) for p in fc],
            "model": case.get("model") or "v62 causal route + intensity/structure head",
            "intensity_source": (case.get("forecast_intensity_source") if has_intensity else None),
            "has_intensity": has_intensity,
            "track_mae_km": score.get("track_mae_km"),
            "track_error_120h_km": score.get("track_error_120h_km"),
            "persistence_mae_km": score.get("persistence_mae_km"),
            "future_rows_used_for_inference": case.get("future_rows_used_for_inference"),
            "official_forecasts_used_for_inference": (
                case.get("official_forecasts_used_for_inference")
                if case.get("official_forecasts_used_for_inference") is not None
                else case.get("official_jma_jtwc_forecasts_used")),
            "manifest": path,
        }
        if has_intensity:
            entry["vmax_kt"] = [round(float(p["vmax_kt"]), 1) for p in fc]
            entry["pres_hpa"] = [round(float(p.get("pressure_hpa", p.get("central_pressure_hpa"))), 1) for p in fc]
            entry["rmw_km"] = [round(float(p["rmw_km"]), 1) for p in fc]
            entry["radii_km"] = [[round(float(x), 1) for x in p["wind_radii_km"]] for p in fc]
        cone = cone_from_members(fc, members)
        if cone:
            entry["cone_km"] = cone
            entry["cone_percentile"] = CONE_PERCENTILE
            entry["member_count"] = len(members)
            entry["members"] = [
                {"lats": [round(float(q["lat"]), 3) for q in m],
                 "lons": [round(float(q["lon"]), 3) for q in m]}
                for m in kept
            ]
        out.setdefault(sid, []).append(entry)
        log(f"{case.get('storm')} -> {sid} @ {case['issue_time_utc']}: "
            f"intensity={has_intensity} members={len(members)} "
            + (f"mae {score['track_mae_km']:.1f} km" if score.get("track_mae_km") else "unscored (live case)"))

    for sid in out:
        out[sid].sort(key=lambda e: e["issue_time_utc"])

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("Published v62 runs only. History mode uses v62 where an entry matches the storm and "
                 "initialisation on screen, and v23 everywhere else -- v62 needs real analysis fields, "
                 "which do not exist for most past storms."),
        "cone": f"{CONE_PERCENTILE:.0f}th-percentile radius over v62's own {SPAGHETTI_MEMBERS}+ route members",
        "hindcasts": out,
        "skipped": skipped,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {OUT} ({len(out)} storm(s), {sum(len(v) for v in out.values())} run(s), "
        f"{OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
