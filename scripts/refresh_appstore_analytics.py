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

# The COMMERCE category carries "App Downloads", the only place Apple publishes
# the download breakdown explicitly: total, first-time and redownloads as
# separate columns. The sales endpoint gives Units, which IS first-time
# downloads, but never names the other two — so "total downloads minus
# redownloads" can be shown as Apple's own arithmetic rather than asserted.
DOWNLOAD_CATEGORY = "COMMERCE"


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


def ensure_request(app_id, bearer, access="ONGOING"):
    """Return a report-request id for one app, creating it if absent.

    Creating one is a subscription, not a query. Two kinds matter here:

      ONGOING            — Apple generates daily reports from now on. It gives
                           nothing for the past, so on its own the impression
                           series would start today and sit permanently shorter
                           than the 120-day download series beside it.
      ONE_TIME_SNAPSHOT  — historical data, which is what actually lets the two
                           series line up.

    So we ask for both and read whichever has instances. Idempotent: an
    existing request is reused, and Apple answers a duplicate create with 409.
    """
    def existing():
        """(id_or_None, lookup_succeeded). The second value matters: a failed
        lookup looks exactly like 'no request exists', and acting on that would
        create a duplicate subscription. At an hourly cadence a transient blip
        is a matter of when, not if, so never create on anything but a clean
        answer."""
        got = api(f"/apps/{app_id}/analyticsReportRequests"
                  f"?filter[accessType]={access}&limit=50", bearer)
        if "_error" in got:
            return None, False
        for item in got.get("data", []):
            if not item.get("attributes", {}).get("stoppedDueToInactivity"):
                return item["id"], True
        return None, True

    found, ok = existing()
    if found:
        return found, False
    if not ok:
        log(f"    could not list {access} requests — not creating one blind")
        return None, False
    made = api("/analyticsReportRequests", bearer, method="POST", body={
        "data": {"type": "analyticsReportRequests",
                 "attributes": {"accessType": access},
                 "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}
    })
    if made.get("_conflict"):
        again, _ = existing()
        return again, False
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
    # Snapshot first: it carries history, which is what makes impressions line
    # up with the download series rather than starting from today.
    req_id = None
    for access in ("ONE_TIME_SNAPSHOT", "ONGOING"):
        rid, created = ensure_request(app_id, bearer, access)
        if created:
            log(f"    created a {access} report request — Apple takes about "
                f"24-48h to generate the first one")
        if rid and not created:
            req_id = rid
            break
        if rid and req_id is None:
            req_id = rid
    if not req_id:
        log("    no report request and could not create one")
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


def download_breakdown(app_id, bearer):
    """Total / first-time / redownloads per day, from the App Downloads report.

    Returns {} until Apple has generated it. Columns are matched by meaning,
    and the headers actually seen are logged, since guessing at them is what
    makes this kind of code rot.
    """
    req_id = None
    for access in ("ONE_TIME_SNAPSHOT", "ONGOING"):
        rid, created = ensure_request(app_id, bearer, access)
        if rid and not created:
            req_id = rid
            break
    if not req_id:
        return {}
    reports = api(f"/analyticsReportRequests/{req_id}/reports"
                  f"?filter[category]={DOWNLOAD_CATEGORY}&limit=200", bearer)
    target = None
    for r in reports.get("data", []):
        n = (r.get("attributes", {}).get("name") or "").lower()
        if "app downloads" in n and "standard" in n:
            target = r
            break
    if target is None:
        return {}
    inst = api(f"/analyticsReports/{target['id']}/instances"
               "?filter[granularity]=DAILY&limit=200", bearer)
    if not inst.get("data"):
        log("    App Downloads report not generated yet")
        return {}

    per_day = {}
    logged_head = False
    for i in inst["data"]:
        day = i.get("attributes", {}).get("processingDate")
        segs = api(f"/analyticsReportInstances/{i['id']}/segments", bearer)
        for sgm in segs.get("data", []):
            url = sgm.get("attributes", {}).get("url")
            if not url:
                continue
            head, rows = read_segment(url)
            if not rows:
                continue
            if not logged_head:
                log(f"    App Downloads columns: {head}")
                logged_head = True
            c_date = pick(head, "date") or "Date"
            c_total = pick(head, "total", "download") or pick(head, "download")
            c_first = pick(head, "first", "time") or pick(head, "first")
            c_re = pick(head, "redownload") or pick(head, "re-download")
            for row in rows:
                d = (row.get(c_date) or day or "")[:10]
                if not d:
                    continue
                slot = per_day.setdefault(d, {})
                for key, col in (("total", c_total), ("first_time", c_first),
                                 ("redownloads", c_re)):
                    if not col:
                        continue
                    try:
                        slot[key] = slot.get(key, 0) + int(float(row.get(col) or 0))
                    except ValueError:
                        pass
    return per_day


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
        try:
            dl = download_breakdown(app_id, bearer)
        except Exception as exc:                              # noqa: BLE001
            log(f"    downloads breakdown: {type(exc).__name__}: {exc}")
            dl = {}

        if not per_day and not dl:
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
        if per_day:
            payload["impressions"] = sum(v["impressions"] for v in per_day.values())
            payload["page_views"] = sum(v["page_views"] for v in per_day.values())
        if dl:
            # Keep all three so the page can show first-time downloads AND say
            # what it left out, instead of implying Units is the whole story.
            for key in ("total", "first_time", "redownloads"):
                tot = sum(v.get(key, 0) for v in dl.values())
                if tot:
                    payload["downloads_" + key] = tot
            by_date = {r["date"]: r for r in payload.get("rows", [])}
            for d, vals in dl.items():
                row = by_date.get(d)
                if row is not None:
                    for key in ("total", "first_time", "redownloads"):
                        if key in vals:
                            row["dl_" + key] = vals[key]
        if per_country:
            payload["impression_territories"] = [
                {"code": cc, "impressions": n}
                for cc, n in sorted(per_country.items(), key=lambda kv: (-kv[1], kv[0]))]
        # Same rule as the sales script: don't rewrite the file just to move a
        # timestamp, or an hourly run commits every hour for nothing.
        before = json.loads((OUT / f"{app_id}.json").read_text())
        if {k: v for k, v in before.items() if k != "engagement_updated_utc"} == \
           {k: v for k, v in payload.items() if k != "engagement_updated_utc"}:
            log("    engagement unchanged")
            continue
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
