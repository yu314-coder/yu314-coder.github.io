#!/usr/bin/env python3
"""Snapshot App Store download counts into static JSON that store-stats.html
reads same-origin — the same pattern as refresh_pypistats.py and
refresh_store_stats.py.

Unlike the Microsoft side, this one can actually run unattended. Microsoft's
analytics API needs an Entra app registration that a personal MSA cannot
create, which is why the Store numbers on that page are hand-exported CSVs.
App Store Connect issues API keys straight from the developer account, so this
job needs nothing but four secrets.

Secrets (GitHub → Settings → Secrets and variables → Actions):
  APPSTORE_ISSUER_ID      – Users and Access → Integrations → Issuer ID
  APPSTORE_KEY_ID         – the key's Key ID
  APPSTORE_PRIVATE_KEY    – the whole .p8 file, BEGIN/END lines included
  APPSTORE_VENDOR_NUMBER  – Payments and Financial Reports → the 8-digit number

Until all four are set this is a graceful no-op (exit 0, writes nothing), so the
workflow stays green before the credentials are wired up.

Two things that commonly break this, both worth knowing before blaming the code:

  * the API key needs an Admin, Finance or Sales role. A Developer-role key gets
    403 on /v1/salesReports and no useful message with it.
  * the vendor number is NOT derivable from the app IDs; it is its own value on
    the Payments page.

Reports are per-day TSVs, gzipped, published on Apple's own schedule (a day or
so behind). A 404 for a given day is normal and means "no sales that day", not
a failure — the run treats it as zero and carries on. Each run merges into the
committed history rather than replacing it, so the series accumulates instead
of being capped by however many days one run could fetch.

Docs: https://developer.apple.com/documentation/appstoreconnectapi/download_sales_and_trends_reports
Refreshed nightly by .github/workflows/refresh-appstore-stats.yml.
"""
import datetime as dt
import gzip
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "assets/appstore-tracker/data"

API = "https://api.appstoreconnect.apple.com/v1/salesReports"

# The apps this site actually lists. Apple's report carries every app on the
# account, so this both filters and fixes the display name — the report's own
# "Title" column is whatever the current App Store listing says and can change
# under us mid-series.
APPS = {
    "6764472686": "ManimStudio",
    "6764759636": "EigenDenoise",
    "6792298083": "SidecarBridge",
    "6764729098": "GPS-location-app",
    "6764759491": "WhisperKit",
}

# How far back to reach on a cold start. Apple keeps daily reports for about a
# year; after the first run the merge below means we only need the recent tail.
COLD_START_DAYS = 120
WARM_DAYS = 10


def log(m):
    print(m, flush=True)


def creds():
    """Return the four secrets, or None when any is missing."""
    need = ("APPSTORE_ISSUER_ID", "APPSTORE_KEY_ID",
            "APPSTORE_PRIVATE_KEY", "APPSTORE_VENDOR_NUMBER")
    got = {k: (os.environ.get(k) or "").strip() for k in need}
    missing = [k for k, v in got.items() if not v]
    if missing:
        log("not configured yet; missing " + ", ".join(missing))
        return None
    return got


def token(issuer_id, key_id, private_key):
    """Sign the 20-minute ES256 JWT App Store Connect expects."""
    import jwt  # PyJWT, with the cryptography extra for ES256
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 15 * 60,
         "aud": "appstoreconnect-v1"},
        private_key,
        algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def report_for(day, bearer, vendor):
    """One day's SALES SUMMARY report as a list of TSV row dicts.

    Returns [] for a day Apple has no report for — that is an ordinary 404
    meaning nothing sold, not an error.
    """
    q = (
        "?filter%5Bfrequency%5D=DAILY"
        "&filter%5BreportType%5D=SALES"
        "&filter%5BreportSubType%5D=SUMMARY"
        "&filter%5Bversion%5D=1_1"
        f"&filter%5BvendorNumber%5D={vendor}"
        f"&filter%5BreportDate%5D={day.isoformat()}"
    )
    req = urllib.request.Request(API + q, headers={
        "Authorization": "Bearer " + bearer,
        "Accept": "application/a-gzip",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []
        if e.code == 403:
            raise SystemExit(
                "403 from /v1/salesReports — the API key's role is too low. "
                "It needs Admin, Finance or Sales; Developer is not enough."
            )
        raise
    text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return []
    head = lines[0].split("\t")
    return [dict(zip(head, l.split("\t"))) for l in lines[1:]]


def units_by_app(rows):
    """Sum Units per Apple Identifier, keeping only apps this site lists.

    Refunds arrive as negative units in the same column, so a plain sum is the
    net figure rather than a gross one. Every app tracked here is free with no
    in-app purchases, so in practice there is nothing to refund and the sum is
    just downloads — but the arithmetic is right either way if that changes.
    """
    out = {}
    for r in rows:
        app_id = (r.get("Apple Identifier") or "").strip()
        if app_id not in APPS:
            continue
        try:
            out[app_id] = out.get(app_id, 0) + int(float(r.get("Units") or 0))
        except ValueError:
            continue
    return out


def load_existing(app_id):
    p = OUT / f"{app_id}.json"
    if not p.exists():
        return {}
    try:
        d = json.loads(p.read_text())
        return {row["date"]: row["installs"] for row in d.get("rows", [])}
    except Exception:
        return {}


def main():
    c = creds()
    if not c:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    history = {a: load_existing(a) for a in APPS}
    cold = not any(history.values())
    span = COLD_START_DAYS if cold else WARM_DAYS
    log(f"{'cold start' if cold else 'incremental'}: fetching {span} day(s)")

    bearer = token(c["APPSTORE_ISSUER_ID"], c["APPSTORE_KEY_ID"],
                   c["APPSTORE_PRIVATE_KEY"])

    # Apple publishes a day or so behind, so start at yesterday rather than today.
    today = dt.date.today()
    fetched = 0
    for back in range(1, span + 1):
        day = today - dt.timedelta(days=back)
        try:
            rows = report_for(day, bearer, c["APPSTORE_VENDOR_NUMBER"])
        except SystemExit:
            raise
        except Exception as exc:                      # noqa: BLE001
            log(f"  {day}: {type(exc).__name__}: {exc} — skipped")
            continue
        counts = units_by_app(rows)
        for app_id in APPS:
            history[app_id][day.isoformat()] = counts.get(app_id, 0)
        fetched += 1

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []
    for app_id, name in APPS.items():
        days = history[app_id]
        if not days:
            continue
        rows = [{"date": d, "installs": days[d]} for d in sorted(days)]
        payload = {
            "app": name,
            "id": app_id,
            "store": "apple",
            "updated_utc": stamp,
            "window": f"{rows[0]['date']} to {rows[-1]['date']}",
            "downloads": sum(r["installs"] for r in rows),
            "rows": rows,
        }
        (OUT / f"{app_id}.json").write_text(json.dumps(payload, separators=(",", ":")))
        index.append({"id": app_id, "name": name})
        log(f"  {name}: {payload['downloads']} units over {len(rows)} day(s)")

    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    log(f"wrote {len(index)} app(s) from {fetched} day(s) of reports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
