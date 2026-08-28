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
    """Per-app units, and per-app units split by country, for one day.

    Returns ({app_id: units}, {app_id: {country_code: units}}). The country
    split is free: every sales row already carries a Country Code, so this is
    the same download data grouped a second way — no extra request, no extra
    API, and it needs nothing that units did not already need.

    Refunds arrive as negative units in the same column, so a plain sum is the
    net figure rather than a gross one. Every app tracked here is free with no
    in-app purchases, so in practice there is nothing to refund and the sum is
    just downloads — but the arithmetic is right either way if that changes.
    """
    out, by_country = {}, {}
    for r in rows:
        app_id = (r.get("Apple Identifier") or "").strip()
        if app_id not in APPS:
            continue
        try:
            n = int(float(r.get("Units") or 0))
        except ValueError:
            continue
        out[app_id] = out.get(app_id, 0) + n
        cc = (r.get("Country Code") or "").strip().upper()
        if cc:
            by_country.setdefault(app_id, {})
            by_country[app_id][cc] = by_country[app_id].get(cc, 0) + n
    return out, by_country


def load_existing(app_id):
    """Committed history for one app: ({date: units}, {date: {cc: units}})."""
    p = OUT / f"{app_id}.json"
    if not p.exists():
        return {}, {}
    try:
        d = json.loads(p.read_text())
        days = {row["date"]: row["installs"] for row in d.get("rows", [])}
        return days, dict(d.get("territory_days") or {})
    except Exception:
        return {}, {}


def main():
    c = creds()
    if not c:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    loaded = {a: load_existing(a) for a in APPS}
    history = {a: loaded[a][0] for a in APPS}
    # Country counts are kept per DAY, not as a running total, so that
    # re-fetching an overlapping day overwrites it instead of double-counting.
    terr = {a: loaded[a][1] for a in APPS}
    cold = not any(history.values())

    # A dimension added after the history already existed — country counts, say
    # — starts empty even though the unit series goes back months. Left alone,
    # an incremental run would fill only the last few days and the page would
    # show a 10-day country split underneath a 120-day download total: two
    # different windows presented as one number, which is exactly the misreading
    # this page exists to avoid. So reach back over the whole window until the
    # country data covers the days that actually have units. Self-healing: once
    # covered, runs go back to being incremental on their own.
    def needs_backfill(app_id):
        active = sum(1 for v in history[app_id].values() if v)
        return bool(active) and len(terr[app_id]) < active * 0.9

    gaps = [APPS[a] for a in APPS if needs_backfill(a)]
    span = COLD_START_DAYS if (cold or gaps) else WARM_DAYS
    if cold:
        log(f"cold start: fetching {span} day(s)")
    elif gaps:
        log(f"country data incomplete for {', '.join(gaps)} — "
            f"reaching back {span} day(s) to fill it")
    else:
        log(f"incremental: fetching {span} day(s)")

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
        counts, countries = units_by_app(rows)
        iso = day.isoformat()
        for app_id in APPS:
            history[app_id][iso] = counts.get(app_id, 0)
            got = countries.get(app_id)
            if got:
                terr[app_id][iso] = got
            else:
                terr[app_id].pop(iso, None)
        fetched += 1

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = []
    for app_id, name in APPS.items():
        days = history[app_id]
        if not days:
            continue
        rows = [{"date": d, "installs": days[d]} for d in sorted(days)]
        # Roll the per-day country split up once here so the page does not have
        # to; the per-day form stays as the mergeable source of truth.
        totals = {}
        for per in terr[app_id].values():
            for cc, n in per.items():
                totals[cc] = totals.get(cc, 0) + n
        territories = [{"code": cc, "units": n}
                       for cc, n in sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))]
        payload = {
            "app": name,
            "id": app_id,
            "store": "apple",
            "updated_utc": stamp,
            "window": f"{rows[0]['date']} to {rows[-1]['date']}",
            "downloads": sum(r["installs"] for r in rows),
            "territories": territories,
            "territory_days": terr[app_id],
            "rows": rows,
        }
        # Write only when something other than the clock moved. Apple publishes
        # once a day, so most runs find nothing new — and restamping
        # updated_utc every time would commit on every run, which at an hourly
        # cadence is 24 commits a day that say nothing. The stamp means "these
        # numbers are from this moment", so keeping the old one when the
        # numbers are old is also the more truthful thing to do.
        path = OUT / f"{app_id}.json"
        index.append({"id": app_id, "name": name})
        top = ", ".join(f"{t['code']} {t['units']}" for t in territories[:4]) or "no country data"
        if path.exists():
            try:
                prev = json.loads(path.read_text())
                if {k: v for k, v in prev.items() if k != "updated_utc"} == \
                   {k: v for k, v in payload.items() if k != "updated_utc"}:
                    log(f"  {name}: unchanged ({payload['downloads']} units)")
                    continue
            except Exception:                                 # noqa: BLE001
                pass                                          # unreadable: rewrite it
        path.write_text(json.dumps(payload, separators=(",", ":")))
        log(f"  {name}: {payload['downloads']} units over {len(rows)} day(s) "
            f"| {len(territories)} countries — {top}")

    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    log(f"wrote {len(index)} app(s) from {fetched} day(s) of reports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
