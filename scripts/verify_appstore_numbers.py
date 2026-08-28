#!/usr/bin/env python3
"""Spot-check committed App Store numbers against Apple's raw report.

Re-fetches a handful of days straight from /v1/salesReports, prints the raw
Units rows Apple returns for the tracked apps, and compares them with what is
committed in assets/appstore-tracker/data. Any mismatch is printed loudly.

Read-only. Proves the stored numbers are Apple's, not something the pipeline
invented or double-counted.
"""
import datetime as dt, gzip, io, json, os, pathlib, sys, time
import urllib.error, urllib.request

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "assets/appstore-tracker/data"
APPS = {"6764472686": "ManimStudio", "6764759636": "EigenDenoise",
        "6792298083": "SidecarBridge", "6764729098": "GPS-location-app",
        "6764759491": "WhisperKit"}

def log(m): print(m, flush=True)

def token():
    import jwt
    now = int(time.time())
    return jwt.encode({"iss": os.environ["APPSTORE_ISSUER_ID"], "iat": now,
                       "exp": now + 15*60, "aud": "appstoreconnect-v1"},
                      os.environ["APPSTORE_PRIVATE_KEY"], algorithm="ES256",
                      headers={"kid": os.environ["APPSTORE_KEY_ID"], "typ": "JWT"})

def report(day, bearer, vendor):
    q = ("?filter%5Bfrequency%5D=DAILY&filter%5BreportType%5D=SALES"
         "&filter%5BreportSubType%5D=SUMMARY&filter%5Bversion%5D=1_1"
         f"&filter%5BvendorNumber%5D={vendor}&filter%5BreportDate%5D={day}")
    req = urllib.request.Request(
        "https://api.appstoreconnect.apple.com/v1/salesReports" + q,
        headers={"Authorization": "Bearer " + bearer, "Accept": "application/a-gzip"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        return None if e.code == 404 else []
    text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l.strip()]
    head = lines[0].split("\t")
    return [dict(zip(head, l.split("\t"))) for l in lines[1:]]

def main():
    if not os.environ.get("APPSTORE_ISSUER_ID"):
        log("not configured"); return 0
    b, vendor = token(), os.environ["APPSTORE_VENDOR_NUMBER"]
    stored = {a: json.loads((OUT / f"{a}.json").read_text()) for a in APPS
              if (OUT / f"{a}.json").exists()}

    # Check each app's busiest day (where an error would be most visible) plus
    # the two most recent days.
    days = set()
    for d in stored.values():
        rows = d["rows"]
        best = max(rows, key=lambda r: r["installs"])
        if best["installs"]:
            days.add(best["date"])
        for r in rows[-2:]:
            days.add(r["date"])

    bad = 0
    for day in sorted(days):
        rows = report(day, b, vendor)
        if rows is None:
            log(f"\n{day}: Apple returned 404 (no report — no sales that day)")
            rows = []
        raw = {}
        for r in rows:
            aid = (r.get("Apple Identifier") or "").strip()
            if aid in APPS:
                try: raw[aid] = raw.get(aid, 0) + int(float(r.get("Units") or 0))
                except ValueError: pass
        log(f"\n{day}   (Apple returned {len(rows)} row(s) total)")
        for aid, name in APPS.items():
            if aid not in stored: continue
            mine = next((r["installs"] for r in stored[aid]["rows"] if r["date"] == day), None)
            theirs = raw.get(aid, 0)
            if mine is None: continue
            ok = (mine == theirs)
            if not ok: bad += 1
            log(f"   {'OK ' if ok else 'MISMATCH'}  {name:<18} apple={theirs:<5} committed={mine}")

    log(f"\n{'ALL MATCH' if not bad else str(bad) + ' MISMATCH(ES)'} across {len(days)} day(s)")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
