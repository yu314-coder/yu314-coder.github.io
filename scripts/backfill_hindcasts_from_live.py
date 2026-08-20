"""Recover Trackformer1.1 hindcasts from the live forecasts already published.

History mode had nothing for 2025 or 2026 because the history builder needs
NCEI's CFSR/CDAS reanalysis, and NCEI has not published most of those days. But
the *live* job runs the same Trackformer1.1 on NOAA GFS f000 analysis every 20
minutes, and every one of its forecasts was committed to this repository. So
storms that visibly had a route while they were live -- Dolphin, Chan-hom,
Peilou, Nangka -- were sitting in git history with nothing reading them.

This walks the history of trackformer-live-forecast.json, dedupes the runs by
(storm, issue time), scores each against best track, and writes them out in the
hindcast format history mode already reads.

These are NOT reanalysis hindcasts and are not labelled as though they were.
A reanalysis run sees the atmosphere as it was later reconstructed; these saw
the GFS analysis available at the moment they were issued, which is a harder
and more honest test. Each file records that in `source` and carries
`origin: "live-archive"`, and the index entry does too.

    python3 scripts/backfill_hindcasts_from_live.py            # write
    python3 scripts/backfill_hindcasts_from_live.py --dry-run  # report only
"""
import argparse
import datetime as dt
import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
LIVE = "assets/typhoon-tracker/model/trackformer-live-forecast.json"
OUTDIR = HERE / "assets/typhoon-tracker/model/trackformer11"
INDEX = HERE / "assets/typhoon-tracker/model/trackformer11-hindcasts.json"
CATALOGUE = HERE / "assets/data/typhoons/index.json"
SEASONS = HERE / "assets/data/typhoons/seasons"


def log(m):
    print(m, flush=True)


def git(*args):
    return subprocess.run(["git", "-C", str(HERE)] + list(args),
                          capture_output=True, text=True).stdout


def km(la1, lo1, la2, lo2):
    r = 6371.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = math.radians(la2 - la1), math.radians(lo2 - lo1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def iso(s):
    """The live file writes issue times both with and without a Z."""
    s = str(s).strip().replace("Z", "")
    return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)


def collect_runs():
    """Every distinct (tcId, issue_time) the live file ever published."""
    revs = [l.strip() for l in git("log", "--follow", "--format=%H", "--", LIVE).splitlines() if l.strip()]
    log(f"  walking {len(revs)} revisions of the live forecast")
    # A shallow checkout has no history to walk, and this reported "1 revision,
    # wrote 0 storms" and exited green -- which looks identical to "nothing new
    # to recover". Say which it is, because the difference is a workflow that
    # quietly does nothing forever.
    if len(revs) < 5 and Path(HERE / ".git" / "shallow").exists():
        log("  this is a SHALLOW clone, so almost none of the history is here. "
            "Nothing can be recovered until it is checked out with fetch-depth: 0.")
    found = {}                      # (tcId, issue) -> (name, entry)
    for h in revs:
        raw = git("show", f"{h}:{LIVE}")
        if not raw.strip():
            continue
        try:
            doc = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for tc, v in (doc.get("storms") or {}).items():
            issue = v.get("issue_time") or (v.get("causality") or {}).get("issue_time_utc")
            if not issue or not v.get("lats") or not v.get("lons"):
                continue
            key = (tc, iso(issue).strftime("%Y-%m-%dT%H:%M:%SZ"))
            # The same JMA issue time can carry more than one published forecast,
            # because the model re-runs when a newer GFS cycle lands while JMA's
            # analysis time has not moved. git log is newest-first, so the first
            # revision to mention a run holds the last version published for it,
            # and that is the one to keep. A named revision still beats an
            # unnamed one -- early runs go out before JMA names the storm.
            name = v.get("name") or ""
            named = bool(name) and not name.startswith("TC")
            if key not in found:
                found[key] = (name or tc, v)
            elif named and found[key][0].startswith("TC"):
                found[key] = (name, found[key][1])   # keep the newer forecast, take the name
    return found


def truth_for(sid, season):
    f = SEASONS / f"{season}.json"
    if not f.exists():
        return None
    return (json.loads(f.read_text()).get(sid) or {}).get("pts")


def score(run_lats, run_lons, leads, issue, pts):
    """Mean great-circle error against best track, matched within 3 hours --
    the same rule the reanalysis builder scores by."""
    if not pts:
        return None, 0
    errs = []
    for k, h in enumerate(leads):
        tgt = issue + dt.timedelta(hours=float(h))
        best, bestd = None, None
        for p in pts:
            d = abs((dt.datetime.fromisoformat(p["t"]).replace(tzinfo=dt.timezone.utc) - tgt).total_seconds())
            if bestd is None or d < bestd:
                best, bestd = p, d
        if best is not None and bestd <= 3 * 3600:
            errs.append(km(float(best["la"]), float(best["lo"]), run_lats[k], run_lons[k]))
    if not errs:
        return None, 0
    return round(sum(errs) / len(errs), 1), len(errs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="overwrite a storm that already has a reanalysis hindcast")
    args = ap.parse_args()

    catalogue = json.loads(CATALOGUE.read_text())
    by_name = {}
    for s in catalogue:
        by_name.setdefault((str(s["name"]).strip().lower(), int(s["season"])), s)

    index = json.loads(INDEX.read_text())
    index.setdefault("hindcasts", {})
    index.setdefault("unavailable", {})

    runs = collect_runs()
    log(f"  {len(runs)} distinct live runs recovered")

    # A storm's first forecasts go out before JMA names it, so those runs carry
    # only the cyclone number. Learn the number-to-storm mapping from the runs
    # that were named, and the unnamed ones come back too.
    by_tc = {}
    for (tc, issue), (name, v) in runs.items():
        if name and not name.startswith("TC"):
            hit = by_name.get((name.strip().lower(), iso(issue).year))
            if hit:
                by_tc[tc] = hit

    per_storm = {}
    unmatched = set()
    for (tc, issue), (name, v) in sorted(runs.items(), key=lambda kv: kv[0][1]):
        issue_dt = iso(issue)
        hit = by_name.get((name.strip().lower(), issue_dt.year)) or by_tc.get(tc)
        if not hit:
            unmatched.add(f"{name} ({tc}, {issue_dt.year})")
            continue
        per_storm.setdefault(hit["sid"], {"storm": hit, "runs": []})["runs"].append((issue_dt, v))

    for u in sorted(unmatched):
        log(f"  no catalogue match: {u}")

    written = 0
    for sid, blob in sorted(per_storm.items()):
        st = blob["storm"]
        season = int(st["season"])
        existing = index["hindcasts"].get(sid)
        if existing and existing.get("origin") != "live-archive" and not args.force:
            log(f"  {st['name']} {season}: already has a reanalysis hindcast; left alone")
            continue
        pts = truth_for(sid, season)
        out_runs, intensity_runs, maes = [], 0, []
        for issue_dt, v in sorted(blob["runs"], key=lambda x: x[0]):
            tf = v.get("trackformer11") or {}
            lats = [round(float(x), 3) for x in v["lats"]]
            lons = [round(float(x), 3) for x in v["lons"]]
            leads = [int(x) for x in v["lead_hours"]]
            mae, scored = score(lats, lons, leads, issue_dt, pts)
            r = {"issue_time_utc": issue_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "lead_hours": leads, "lats": lats, "lons": lons}
            if tf.get("cone_km"):
                r["cone_km"] = [round(float(c), 1) for c in tf["cone_km"]]
                r["cone_percentile"] = tf.get("cone_percentile", 90.0)
            if tf.get("member_count"):
                r["member_count"] = tf["member_count"]
            if v.get("vmax_kt") and v.get("pres_hpa"):
                r["vmax_kt"] = [round(float(x)) for x in v["vmax_kt"]]
                r["pres_hpa"] = [round(float(x)) for x in v["pres_hpa"]]
                r["has_intensity"] = True
                r["structure_anchor"] = int(v.get("structure_anchor") or 0)
                intensity_runs += 1
            if mae is not None:
                r["track_mae_km"] = mae
                r["scored_leads"] = scored
                maes.append(mae)
            out_runs.append(r)

        payload = {
            "storm": st["name"], "sid": sid, "season": season,
            "origin": "live-archive",
            "model": "Trackformer1.1 causal route + intensity/structure head",
            "source": ("NOAA GFS 0.25 degree f000 analysis, as issued live. These are the "
                       "forecasts this site published while the storm was running, recovered "
                       "from the repository's own history -- not reanalysis hindcasts. Each saw "
                       "only the analysis available at its issue time."),
            "truth_used_for": "scoring only",
            "future_rows_used_for_inference": 0,
            "official_forecasts_used_for_inference": False,
            "runs": out_runs,
        }
        if not args.dry_run:
            OUTDIR.mkdir(parents=True, exist_ok=True)
            (OUTDIR / f"{sid}.json").write_text(json.dumps(payload, separators=(",", ":")))
        index["hindcasts"][sid] = {
            "storm": st["name"], "season": season, "runs": len(out_runs),
            "first_issue_utc": out_runs[0]["issue_time_utc"],
            "last_issue_utc": out_runs[-1]["issue_time_utc"],
            "intensity_runs": intensity_runs,
            "mean_track_mae_km": round(sum(maes) / len(maes), 1) if maes else None,
            "origin": "live-archive",
            "file": f"trackformer11/{sid}.json",
        }
        index["unavailable"].pop(sid, None)     # it has runs now
        written += 1
        log(f"  {st['name']} {season}: {len(out_runs)} runs, {intensity_runs} with intensity, "
            f"mean track error {index['hindcasts'][sid]['mean_track_mae_km']} km")

    if not args.dry_run and written:
        index["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        INDEX.write_text(json.dumps(index, separators=(",", ":")))
    log(f"  {'would write' if args.dry_run else 'wrote'} {written} storm(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
