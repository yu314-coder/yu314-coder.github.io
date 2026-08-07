#!/usr/bin/env python3
"""Rebuild v62-hindcasts.json from the per-storm files on disk.

The index is a single line of JSON, so git can never merge two changes to it --
any two commits that both touch it conflict, every time. Three workflows commit
to main on a schedule, so that is not a rare race: a backfill run that had built
six storms, including the first post-2011 ones, lost all of them to exactly this
and exited 1.

Rebasing is the wrong tool because there is nothing to reconcile. Every field in
the index is derivable from the storm files themselves, so the fix is to take
whatever is on main, put our new files beside it, and derive the index again.
That cannot conflict, and it cannot disagree with the files it describes.

The unavailable ledger and the era-blocked marks are NOT derivable -- they
record what the archive said, not what is on disk -- so they are carried over
from the existing index rather than recomputed.

    python scripts/rebuild_v62_index.py
"""

import datetime as dt
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = os.path.join(ROOT, "assets", "typhoon-tracker", "model")
INDEX = os.path.join(MODEL, "v62-hindcasts.json")
STORMS = os.path.join(MODEL, "v62")

NOTE = ("Per-storm v62 hindcasts, loaded lazily. History mode uses v62 wherever a run "
        "covers the initialisation on screen and v23 elsewhere.")


def main():
    keep = {}
    if os.path.exists(INDEX):
        try:
            with open(INDEX) as f:
                old = json.load(f)
            keep = {k: old[k] for k in ("unavailable", "era_blocked") if k in old}
        except Exception as e:
            print(f"  existing index unreadable ({e}); rebuilding from files alone",
                  file=sys.stderr)

    hindcasts = {}
    if os.path.isdir(STORMS):
        for name in sorted(os.listdir(STORMS)):
            if not name.endswith(".json"):
                continue
            sid = name[:-5]
            path = os.path.join(STORMS, name)
            try:
                with open(path) as f:
                    d = json.load(f)
            except Exception as e:
                print(f"  skipping {name}: {e}", file=sys.stderr)
                continue
            runs = d.get("runs") or []
            if not runs:
                continue
            scored = [r["track_mae_km"] for r in runs if "track_mae_km" in r]
            hindcasts[sid] = {
                "storm": d.get("storm"),
                "season": d.get("season"),
                "runs": len(runs),
                "first_issue_utc": runs[0]["issue_time_utc"],
                "last_issue_utc": runs[-1]["issue_time_utc"],
                "intensity_runs": sum(1 for r in runs if r.get("has_intensity")),
                "mean_track_mae_km": round(sum(scored) / len(scored), 1) if scored else None,
                "file": f"v62/{sid}.json",
            }

    out = {"generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "note": NOTE, "hindcasts": hindcasts}
    out.update(keep)
    with open(INDEX, "w") as f:
        f.write(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"  rebuilt index from {len(hindcasts)} storm file(s)"
          + (f", carried over {len(keep)} ledger key(s)" if keep else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
