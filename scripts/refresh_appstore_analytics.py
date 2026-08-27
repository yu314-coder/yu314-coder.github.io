#!/usr/bin/env python3
"""Add impressions and product page views to the App Store snapshots.

These do NOT come from the sales endpoint that refresh_appstore_stats.py uses.
Units live in /v1/salesReports; impressions and page views live in the newer
Analytics Reports API, which works completely differently:

    POST /v1/analyticsReportRequests        (once per app — a subscription)
    GET  /v1/analyticsReportRequests/{id}/reports?filter[category]=...
    GET  /v1/analyticsReports/{id}/instances?filter[granularity]=DAILY
    GET  /v1/analyticsReportInstances/{id}/segments
    GET  <segment url>                      (signed; gzip or zip of a TSV)

Two consequences worth knowing before wondering why this looks idle:

  * The report request is a SUBSCRIPTION, not a query. Apple states the first
    report lands roughly 24–48 hours after an ONGOING request is created. Until
    then this script correctly finds nothing and leaves the snapshots alone.
  * A day's data is considered complete two days after that date, so the tail
    of the series moves for a couple of days before settling.

Because the exact enum values and column headings are not something to guess
at, this script DISCOVERS them: it logs the report names, granularities and
column headers it actually sees, and matches columns by meaning rather than by
a hardcoded index. The first real run tells us what Apple returns; the log is
the reference.

Reuses the same four secrets as refresh_appstore_stats.py. Graceful no-op
without them.
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
import urllib.parse
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "assets/appstore-tracker/data"
BASE = "https://api.appstoreconnect.apple.com/v1"

# Same five apps the sales script tracks.
APPS = {
    "6764472686": "ManimStudio",
    "6764759636": "EigenDenoise",
    "6792298083": "SidecarBridge",
    "6764729098": "GPS-location-app",
    "6764759491": "WhisperKit",
}

# Apple's category for discovery/engagement (impressions, page views, taps).
CATEGORY = "APP_STORE_ENGAGEMENT"


def log(m):
    print(m, flush=True)


def creds():
    need = ("APPSTORE_ISSUER_ID", "APPSTORE_KEY_ID",
            "APPSTORE_PRIVATE_KEY", "APPSTORE_VENDOR_NUMBER")
    got = {k: (os.environ.get(k) or "").strip() for k in need}
    missing = [k for k, v in got.items() if not v]
    if missing:
        log("not configured yet; missing " + ", ".join(missing))
        return None
    return got


def token(issuer_id, key_id, private_key):
    import jwt
    now = int(time.time())
    return jwt.encode(
        {"iss": issuer_id, "iat": now, "exp": now + 15 * 60,
         "aud": "appstoreconnect-v1"},
        private_key, algorithm="ES256",
        headers={"kid": key_id, "typ": "JWT"},
    )


def api(path_or_url, bearer, method="GET", body=None):
    url = path_or_url if path_or_url.startswith("http") else BASE + path_or_url
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + bearer,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read()).get("errors", [{}])[0].get("detail", "")
        except Exception:                                     # noqa: BLE001
            pass
        if e.code == 403:
            raise SystemExit(
                "403 from the Analytics API. The key needs Admin or "
                "Access to Reports. " + detail)
        if e.code == 409:
            return {"_conflict": True, "detail": detail}
        raise RuntimeError(f"HTTP {e.code} on {url}: {detail}") from None


def ensure_request(app_id, bearer):
    """Return the ONGOING report-request id for one app, creating it if absent.

    Creating one is a subscription, not a query — it starts Apple generating
    daily reports for this app from now on. It is idempotent here: an existing
    ONGOING request is reused, and Apple answers a duplicate create with 409.
    """
    got = api(f"/apps/{app_id}/analyticsReportRequests"
              "?filter[accessType]=ONGOING&limit=50", bearer)
    for item in got.get("data", []):
        if not item.get("attributes", {}).get("stoppedDueToInactivity"):
            return item["id"], False
    made = api("/analyticsReportRequests", bearer, method="POST", body={
        "data": {"type": "analyticsReportRequests",
                 "attributes": {"accessType": "ONGOING"},
                 "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}
    })
    if made.get("_conflict"):
        got = api(f"/apps/{app_id}/analyticsReportRequests"
                  "?filter[accessType]=ONGOING&limit=50", bearer)
        for item in got.get("data", []):
            return item["id"], False
        return None, False
    return made.get("data", {}).get("id"), True


def read_segment(url):
    """Download one segment and return its rows as dicts.

    Apple has shipped these as gzip and as zip depending on the report, so
    sniff rather than assume.
    """
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = r.read()
    text = None
    if raw[:2] == b"\x1f\x8b":
        text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8", "replace")
    elif raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            name = z.namelist()[0]
            text = z.read(name).decode("utf-8", "replace")
    else:
        text = raw.decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return [], []
    sep = "\t" if "\t" in lines[0] else ","
    head = [h.strip() for h in lines[0].split(sep)]
    return head, [dict(zip(head, l.split(sep))) for l in lines[1:]]


def pick(head, *wants):
    """First column whose name contains all the given words (case-insensitive)."""
    for h in head:
        low = h.lower()
        if all(w in low for w in wants):
            return h
    return None


def harvest(app_id, bearer):
    """Per-day engagement for one app.

    Returns ({date: {impressions, page_views}}, {country_code: impressions}),
    or ({}, {}) when Apple has not generated anything yet. The engagement
    report carries a Territory column, same as the sales report carries a
    Country Code, so impressions get a country split for free too.
    """
    req_id, created = ensure_request(app_id, bearer)
    if not req_id:
        log(f"    no report request and could not create one")
        return {}, {}
    if created:
        log(f"    created an ONGOING report request — Apple's first report "
            f"takes about 24-48h, so expect nothing until then")
        return {}, {}

    reports = api(f"/analyticsReportRequests/{req_id}/reports"
                  f"?filter[category]={CATEGORY}&limit=200", bearer)
    names = [r.get("attributes", {}).get("name", "?") for r in reports.get("data", [])]
    if not names:
        log(f"    no {CATEGORY} reports available yet")
        return {}, {}
    log(f"    reports offered: {', '.join(names)}")

    # Prefer the standard discovery/engagement report; fall back to anything
    # whose name mentions engagement or discovery.
    target = None
    for r in reports.get("data", []):
        n = (r.get("attributes", {}).get("name") or "").lower()
        if "discovery and engagement" in n:
            target = r
            break
    if target is None:
        for r in reports.get("data", []):
            n = (r.get("attributes", {}).get("name") or "").lower()
            if "engagement" in n or "discovery" in n:
                target = r
                break
    if target is None:
        log("    none of the offered reports look like discovery/engagement")
        return {}, {}

    inst = api(f"/analyticsReports/{target['id']}/instances"
               "?filter[granularity]=DAILY&limit=200", bearer)
    instances = inst.get("data", [])
    if not instances:
        log("    report exists but has no DAILY instances yet")
        return {}, {}
    log(f"    {len(instances)} daily instance(s)")

    per_day, per_country = {}, {}
    for i in instances:
        day = i.get("attributes", {}).get("processingDate")
        segs = api(f"/analyticsReportInstances/{i['id']}/segments", bearer)
        for sgm in segs.get("data", []):
            url = sgm.get("attributes", {}).get("url")
            if not url:
                continue
            head, rows = read_segment(url)
            if not rows:
                continue
            c_date = pick(head, "date") or "Date"
            c_event = pick(head, "event")
            c_count = pick(head, "count") or pick(head, "counts")
            c_terr = pick(head, "territory") or pick(head, "country")
            if not (c_event and c_count):
                log(f"    columns seen: {head}")
                log("    could not find an event/count column — skipping segment")
                continue
            for row in rows:
                d = (row.get(c_date) or day or "")[:10]
                if not d:
                    continue
                ev = (row.get(c_event) or "").strip().lower()
                try:
                    n = int(float(row.get(c_count) or 0))
                except ValueError:
                    continue
                slot = per_day.setdefault(d, {"impressions": 0, "page_views": 0})
                # Apple splits impressions into unique/total and page views by
                # page type; sum the families rather than pinning exact strings.
                if "impression" in ev:
                    slot["impressions"] += n
                    if c_terr:
                        cc = (row.get(c_terr) or "").strip().upper()
                        if cc:
                            per_country[cc] = per_country.get(cc, 0) + n
                elif "page view" in ev or "page_view" in ev:
                    slot["page_views"] += n
    return per_day, per_country


def main():
    c = creds()
    if not c:
        return 0
    if not OUT.exists():
        log("no sales snapshots yet — run refresh_appstore_stats.py first")
        return 0

    bearer = token(c["APPSTORE_ISSUER_ID"], c["APPSTORE_KEY_ID"],
                   c["APPSTORE_PRIVATE_KEY"])
    touched = 0
    for app_id, name in APPS.items():
        log(f"  {name}:")
        try:
            per_day, per_country = harvest(app_id, bearer)
        except SystemExit:
            raise
        except Exception as exc:                              # noqa: BLE001
            log(f"    {type(exc).__name__}: {exc} — leaving this app's snapshot alone")
            continue
        if not per_day:
            continue

        path = OUT / f"{app_id}.json"
        if not path.exists():
            continue
        payload = json.loads(path.read_text())
        by_date = {r["date"]: r for r in payload.get("rows", [])}
        for d, vals in per_day.items():
            row = by_date.get(d)
            if row is None:
                continue          # engagement day outside the sales window
            row["impressions"] = vals["impressions"]
            row["page_views"] = vals["page_views"]
        payload["impressions"] = sum(v["impressions"] for v in per_day.values())
        payload["page_views"] = sum(v["page_views"] for v in per_day.values())
        if per_country:
            payload["impression_territories"] = [
                {"code": cc, "impressions": n}
                for cc, n in sorted(per_country.items(), key=lambda kv: (-kv[1], kv[0]))]
        payload["engagement_updated_utc"] = dt.datetime.now(dt.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ")
        path.write_text(json.dumps(payload, separators=(",", ":")))
        touched += 1
        log(f"    {payload['impressions']} impressions, "
            f"{payload['page_views']} page views over {len(per_day)} day(s)")

    log(f"updated {touched} app(s) with engagement data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
