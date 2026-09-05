#!/usr/bin/env python3
"""Stamp the published Microsoft Store version onto the store-tracker snapshots.

The download numbers for these apps are hand-exported from Partner Center (a
personal Microsoft account has no Entra app for the acquisitions API — see
build_store_stats_from_csv.py). Versions are a different matter: they are
public, so there is no reason for them to be typed by hand and rot the way
python-to-binary's did.

Microsoft has no equivalent of Apple's lookup endpoint. The product API at
storeedgefd returns Version as an empty string, and packageManifests reports
"Unknown". displaycatalog does carry it, but PACKED INTO A SINGLE 64-BIT
INTEGER — 281479271940096 is v1.1.4.0, four 16-bit fields from the high end
down. That encoding is the only reason this is not a one-liner.

Writes nothing but the version fields, leaving the hand-read download figures
untouched. Fails soft: a stale version beats a blank one.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "assets/store-tracker/data"

# Store IDs, matching assets/store-tracker/data/index.json.
APPS = {
    "9NZFT55DVCBS": "ManimStudio",
    "9P969D6N7P6J": "t-SNE Visualization",
    "9NZJ475S7B01": "Generalized Covariance Matrix",
}

CATALOG = ("https://displaycatalog.mp.microsoft.com/v7.0/products/{id}"
           "?market=US&languages=en-US&fieldsTemplate=Details")


def log(m):
    print(m, flush=True)


def unpack(packed):
    """Microsoft's 64-bit packed version -> "a.b.c.d"."""
    v = int(packed)
    return "{}.{}.{}.{}".format((v >> 48) & 0xFFFF, (v >> 32) & 0xFFFF,
                                (v >> 16) & 0xFFFF, v & 0xFFFF)


def fetch(store_id):
    req = urllib.request.Request(CATALOG.format(id=store_id),
                                 headers={"MS-CV": "yu314-site"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log(f"  {store_id}: lookup failed ({type(exc).__name__})")
        return {}
    p = d.get("Product") or {}
    versions, updated = set(), None
    for sku in p.get("DisplaySkuAvailabilities") or []:
        props = (sku.get("Sku") or {}).get("Properties") or {}
        for pkg in props.get("Packages") or []:
            if pkg.get("Version"):
                versions.add(int(pkg["Version"]))
            updated = pkg.get("LastUpdateDate") or updated
    if not versions:
        return {}
    out = {"version": unpack(max(versions))}
    if updated:
        out["version_released"] = str(updated)[:10]
    return out


def main():
    if not OUT.exists():
        log("no store-tracker data yet")
        return 0
    touched = 0
    for store_id, name in APPS.items():
        path = OUT / f"{store_id}.json"
        if not path.exists():
            continue
        meta = fetch(store_id)
        if not meta:
            continue
        payload = json.loads(path.read_text())
        if all(payload.get(k) == v for k, v in meta.items()):
            log(f"  {name} v{meta['version']}: unchanged")
            continue
        payload.update(meta)
        path.write_text(json.dumps(payload, separators=(",", ":")))
        touched += 1
        log(f"  {name}: v{meta['version']}")
    log(f"updated {touched} app(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
