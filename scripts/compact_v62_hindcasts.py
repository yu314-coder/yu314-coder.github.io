#!/usr/bin/env python3
"""Shrink the stored v62 hindcasts without changing what they say.

Covering every storm from 1985 on means roughly a thousand of these files, and
at the precision they were first written that is ~490 MB of JSON in the repo.
Almost none of that precision is real:

  * track and member positions were stored to 3 decimal places, about 110 m,
    for lines drawn on a map where a pixel is several kilometres
  * cone radii, vmax, pressure, RMW and the wind radii were stored to 0.1,
    finer than the models resolve and finer than the observations they are
    scored against
  * the files were written with default json spacing

Rounding to 2 dp (about 1.1 km) and to whole units, and dropping the spacing,
halves the payload and changes nothing that can be seen or measured. The
ensemble members are decoration -- the cone is computed from all 189 of them
before any are dropped -- so how many are kept for drawing is a display choice.

    python scripts/compact_v62_hindcasts.py            # rewrite in place
    python scripts/compact_v62_hindcasts.py --check     # report, write nothing
    python scripts/compact_v62_hindcasts.py --members 12
"""

import argparse
import gzip
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V62 = ROOT / "assets" / "typhoon-tracker" / "model" / "v62"


def rnd(v, n):
    if v is None:
        return None
    r = round(float(v), n)
    return int(r) if n == 0 else r


def compact_run(r, keep_members):
    r["lats"] = [rnd(v, 2) for v in r["lats"]]
    r["lons"] = [rnd(v, 2) for v in r["lons"]]
    if r.get("cone_km") is not None:
        r["cone_km"] = [rnd(v, 0) for v in r["cone_km"]]
    for k in ("vmax_kt", "pres_hpa", "rmw_km"):
        if r.get(k) is not None:
            r[k] = [rnd(v, 0) for v in r[k]]
    if r.get("radii_km") is not None:
        r["radii_km"] = [[rnd(x, 0) for x in q] for q in r["radii_km"]]
    if r.get("track_mae_km") is not None:
        r["track_mae_km"] = rnd(r["track_mae_km"], 1)
    m = r.get("members")
    if m:
        if keep_members and len(m) > keep_members:
            step = max(1, len(m) // keep_members)
            m = m[::step][:keep_members]
        r["members"] = [{"lats": [rnd(v, 2) for v in mm["lats"]],
                         "lons": [rnd(v, 2) for v in mm["lons"]]} for mm in m]
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report sizes, write nothing")
    ap.add_argument("--members", type=int, default=0,
                    help="cap drawn ensemble members per run (0 keeps all stored)")
    args = ap.parse_args()

    files = sorted(V62.glob("*.json"))
    if not files:
        print("no hindcasts found")
        return 0

    before = after = gz = 0
    for f in files:
        raw = f.read_text()
        before += len(raw)
        d = json.loads(raw)
        for r in d.get("runs", []):
            compact_run(r, args.members)
        out = json.dumps(d, separators=(",", ":")) + "\n"
        after += len(out)
        gz += len(gzip.compress(out.encode(), 9))
        if not args.check:
            f.write_text(out)

    n = len(files)
    scale = 1080 / n
    mb = lambda b: b / 1048576
    print(f"  {n} files")
    print(f"    before  {mb(before):7.1f} MB   projected for 1080 storms: {mb(before * scale):6.0f} MB")
    print(f"    after   {mb(after):7.1f} MB   projected for 1080 storms: {mb(after * scale):6.0f} MB"
          f"   ({(1 - after / before) * 100:.0f}% smaller)")
    print(f"    on the wire, gzipped by Pages: {mb(gz):.1f} MB"
          f"  ({mb(gz * scale):.0f} MB for all, {gz / n / 1024:.0f} KB per storm)")
    if args.check:
        print("\n  --check: nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
