"""Fold per-storm hindcast payloads into the shared index.

The backfill used to run one storm at a time on one runner, because every
storm updates trackformer11-hindcasts.json and two runners doing that at once
would clobber each other. Fanning the storms out across runners fixes the
speed, so the index write has to move somewhere that only ever runs once --
here, after the matrix has finished and its artifacts are downloaded.

Each per-storm payload already carries everything the index entry needs, so
this derives the entry rather than trusting a second file to agree with the
first. A fragment that disagrees with its own payload cannot exist.

    python3 scripts/merge_hindcast_fragments.py fragments/
"""
import json
import os
import pathlib
import sys

MODEL = pathlib.Path(__file__).resolve().parents[1] / "assets/typhoon-tracker/model"

# Same env contract as hindcast_from_gfs_archive.py, and for the same reason:
# each model writes its own directory and index, so merging a 1.2 batch can
# never land on top of the 1.1 hindcasts it is meant to be compared with.
# Defaults are 1.1's paths, so an existing run is unaffected.
OUTDIR = MODEL / os.environ.get("TF_OUTDIR", "trackformer11")
INDEX = MODEL / os.environ.get("TF_INDEX", "trackformer11-hindcasts.json")


def entry_from(payload):
    """Build the index row a payload implies, matching the single-run writer.

    Key order matters only so the committed index diffs cleanly against rows
    the one-storm-at-a-time writer produced; the fields themselves are what
    the tracker reads.
    """
    runs = payload["runs"]
    scored = [r["track_mae_km"] for r in runs if "track_mae_km" in r]
    entry = {
        "storm": payload["storm"],
        "season": int(payload["season"]),
        "runs": len(runs),
        "first_issue_utc": runs[0]["issue_time_utc"],
        "last_issue_utc": runs[-1]["issue_time_utc"],
        "intensity_runs": sum(1 for r in runs if r.get("has_intensity")),
        "mean_track_mae_km": round(sum(scored) / len(scored), 1) if scored else None,
    }
    # Only stamp origin when the payload declares one. Reanalysis-built storms
    # carry no origin in either the payload or the index, and defaulting here
    # would relabel them as archive builds they never were.
    if payload.get("origin"):
        entry["origin"] = payload["origin"]
    entry["file"] = "%s/%s.json" % (OUTDIR.name, payload["sid"])
    return entry


def payload_time(payloads):
    """Latest issue time across the batch: a real timestamp, not a clock read.

    Workflow scripts must not invent a "now" -- the index is data, and a
    generated_at that does not correspond to any input is a small lie that
    later reads as provenance.
    """
    latest = ""
    for f in payloads:
        try:
            runs = json.loads(f.read_text()).get("runs") or []
        except Exception:
            continue
        for r in runs:
            t = r.get("issue_time_utc") or ""
            if t > latest:
                latest = t
    return latest or "unknown"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    root = pathlib.Path(sys.argv[1])
    payloads = sorted(root.rglob("*.json"))
    if not payloads:
        print("no fragments to merge")
        return 0

    # A model's first batch has no index yet, which is precisely the run that
    # introduces a new model. Start one rather than dying on a missing file.
    if INDEX.exists():
        index = json.loads(INDEX.read_text())
    else:
        print("no %s yet; starting one" % INDEX.name)
        index = {"generated_at": payload_time(payloads),
                 "note": "Per-storm Trackformer hindcasts, loaded lazily.",
                 "hindcasts": {}, "unavailable": {}}
    index.setdefault("hindcasts", {})
    OUTDIR.mkdir(parents=True, exist_ok=True)

    merged = 0
    for f in payloads:
        payload = json.loads(f.read_text())
        sid = payload.get("sid")
        # Only per-storm payloads belong here. An artifact that picked up the
        # index itself, or anything else shaped differently, is skipped rather
        # than written over a real storm.
        if not sid or "runs" not in payload:
            print("  skipped %s: not a storm payload" % f.name)
            continue
        (OUTDIR / ("%s.json" % sid)).write_text(json.dumps(payload, separators=(",", ":")))
        index["hindcasts"][sid] = entry_from(payload)
        (index.get("unavailable") or {}).pop(sid, None)
        merged += 1
        print("  %s %s: %d runs, mean %s km"
              % (payload["storm"], payload["season"], len(payload["runs"]),
                 index["hindcasts"][sid]["mean_track_mae_km"]))

    INDEX.write_text(json.dumps(index, separators=(",", ":")))
    print("merged %d storm(s); index now holds %d" % (merged, len(index["hindcasts"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
