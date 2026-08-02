#!/usr/bin/env python3
"""Publish v62 hindcasts for the track-history explorer.

Track-history mode cannot call v62 the way live mode does. v62 integrates a
route from real analysis fields, and there are two hard reasons that path does
not exist for a past storm:

  * NOMADS keeps roughly nine days of GFS. Measured: -9 d serves, -10 d is 404,
    older is 403. The explorer covers 1979 and 1985-present.
  * The explorer re-forecasts on every slider move, client-side and instantly.
    One v62 initialisation needs ~34 MB of GRIB decoded first.

That is exactly why v23 exists -- it is field-free, so it can re-run anywhere in
a storm's life from track history alone. So history mode stays on v23 by
default, and uses v62 only where a real v62 run has been published for that
storm and initialisation.

This script turns those published runs into something the site can read. Point
it at yu314-coder/typhoon-predict's track_build/*_v62_v23_public_data.json
manifests; it matches each to an IBTrACS storm id in this repo's season data and
writes assets/typhoon-tracker/model/v62-hindcasts.json. Re-run it whenever a new
v62 case is published and that storm lights up in the explorer.

Nothing is invented: a manifest that cannot be matched to a storm in the season
data is reported and skipped rather than guessed at.
"""
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEASONS = REPO_ROOT / "assets" / "data" / "typhoons" / "seasons"
OUT = REPO_ROOT / "assets" / "typhoon-tracker" / "model" / "v62-hindcasts.json"
RAW = "https://raw.githubusercontent.com/yu314-coder/typhoon-predict/main/"
MANIFESTS = (
    "track_build/tip_v62_v23_public_data.json",
    "track_build/dolphin_v62_v23_public_data.json",
)
UA = {"User-Agent": "typhoon-tracker-hindcast-builder/1.0"}


def log(m):
    print(m, file=sys.stderr, flush=True)


def fetch(path):
    with urllib.request.urlopen(urllib.request.Request(RAW + path, headers=UA), timeout=60) as r:
        return json.load(r)


def parse_iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def match_storm(name, issue):
    """Find the IBTrACS id whose track carries this name and spans the issue."""
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
        first = parse_iso(pts[0]["t"] + "Z" if "Z" not in pts[0]["t"] else pts[0]["t"])
        last = parse_iso(pts[-1]["t"] + "Z" if "Z" not in pts[-1]["t"] else pts[-1]["t"])
        if first <= issue <= last:
            return sid, None
        return None, f"'{name}' found ({sid}) but issue {issue:%Y-%m-%d %H:%M} outside its track"
    return None, f"'{name}' not in {issue.year} season data (not archived yet?)"


def main():
    out = {}
    skipped = []
    for path in MANIFESTS:
        try:
            m = fetch(path)
        except Exception as e:
            log(f"skip {path}: fetch failed ({type(e).__name__}: {e})")
            skipped.append({"manifest": path, "reason": "fetch failed"})
            continue
        route = (m.get("routes") or {}).get("v62_full")
        if not route or not route.get("forecast"):
            log(f"skip {path}: no v62_full route")
            skipped.append({"manifest": path, "reason": "no v62_full route"})
            continue
        issue = parse_iso(m["issue_time_utc"])
        sid, why = match_storm(m.get("storm"), issue)
        if not sid:
            log(f"skip {path}: {why}")
            skipped.append({"manifest": path, "storm": m.get("storm"), "reason": why})
            continue
        fc = route["forecast"]
        score = (m.get("scores") or {}).get("v62_full") or {}
        entry = {
            "issue_time_utc": m["issue_time_utc"],
            "lead_hours": [int(p["lead_hours"]) for p in fc],
            "lats": [round(float(p["latitude"]), 3) for p in fc],
            "lons": [round(float(p["longitude"]), 3) for p in fc],
            "model": route.get("model") or "v62 full local + Pacific",
            "source": m.get("source_policy"),
            "track_mae_km": score.get("track_mae_km"),
            "track_error_120h_km": score.get("track_error_120h_km"),
            "persistence_mae_km": score.get("persistence_mae_km"),
            "future_rows_used_for_inference": m.get("future_rows_used_for_inference"),
            "official_forecasts_used_for_inference": m.get("official_forecasts_used_for_inference"),
            "manifest": path,
        }
        out.setdefault(sid, []).append(entry)
        log(f"{m.get('storm')} -> {sid} @ {m['issue_time_utc']}"
            + (f" (mae {score['track_mae_km']:.1f} km)" if score.get("track_mae_km") else " (live case, unscored)"))

    for sid in out:
        out[sid].sort(key=lambda e: e["issue_time_utc"])

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("Published v62 runs only. History mode uses v62 for the track where an entry "
                 "matches the storm and initialisation on screen, and v23 everywhere else -- "
                 "v62 needs real analysis fields, which do not exist for most past storms."),
        "intensity_source": "v23 (v62 forecasts position only)",
        "hindcasts": out,
        "skipped": skipped,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {OUT} ({len(out)} storm(s), {sum(len(v) for v in out.values())} run(s))")


if __name__ == "__main__":
    main()
