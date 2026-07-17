#!/usr/bin/env python3
"""Snapshot Microsoft Store app-acquisition (download) counts into static JSON
that store-stats.html reads same-origin — the same pattern as refresh_pypistats.py.

The Microsoft Store analytics API needs a Microsoft Entra (Azure AD) access token,
which requires private credentials that can't live in a static site. So we fetch
here (server-side, in CI) using GitHub Actions **secrets** and commit the result.

Secrets (add in GitHub → Settings → Secrets and variables → Actions):
  STORE_TENANT_ID      – your Entra tenant (directory) ID
  STORE_CLIENT_ID      – the Entra app (client) ID associated with Partner Center
  STORE_CLIENT_SECRET  – a client secret / key for that app

Until those three are set the script is a graceful no-op (exit 0, writes nothing),
so the workflow stays green before you've wired up the credentials.

Docs: https://learn.microsoft.com/windows/uwp/monetize/acquisitions-data
Refreshed nightly by .github/workflows/refresh-store-stats.yml.
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

# Your Microsoft Store apps. The `id` is the Store ID / product ID the analytics
# API expects as applicationId — verify it against Partner Center (it's also in
# the .tsv you can export from the acquisitions report) if a fetch comes back empty.
APPS = [
    {"id": "9NZFT55DVCBS", "name": "ManimStudio"},
    {"id": "9P969D6N7P6J", "name": "t-SNE Visualization"},
    {"id": "9nzj475s7b01", "name": "Generalized Covariance Matrix"},
]

OUT_DIR = os.path.join("assets", "store-tracker", "data")
TOKEN_HOST = "https://login.microsoftonline.com"
# Acquisitions = downloads (a license grant / "customer got the app"). This is the
# same number Partner Center shows as acquisitions — NOT Store-listing page views
# (those are a separate acquisition-funnel report) and NOT installs (another metric).
API_BASE = "https://manage.devcenter.microsoft.com/v1.0/my/analytics/acquisitions"
RESOURCE = "https://manage.devcenter.microsoft.com"
# Pull from the app's lifetime so the total matches Partner Center's total. The API
# has no daily data before 2016-10-01; override with STORE_START_DATE if needed.
START_DATE = os.environ.get("STORE_START_DATE", "2016-10-01")


def get_token(tenant, client_id, client_secret):
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "resource": RESOURCE,
    }).encode()
    req = urllib.request.Request(f"{TOKEN_HOST}/{tenant}/oauth2/token", data=body,
                                headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)["access_token"]


def api_get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def fetch_daily(app_id, token, start, end):
    """Daily total acquisitions for one app: groupby=date, following @nextLink."""
    params = {
        "applicationId": app_id,
        "startDate": start.strftime("%Y-%m-%d"),
        "endDate": end.strftime("%Y-%m-%d"),
        "aggregationLevel": "day",
        "groupby": "date",
    }
    url = API_BASE + "?" + urllib.parse.urlencode(params)
    per_day = {}
    while url:
        data = api_get(url, token)
        for row in data.get("Value", []):
            d = (row.get("date") or "")[:10]
            if d:
                per_day[d] = per_day.get(d, 0) + int(row.get("acquisitionQuantity") or 0)
        url = data.get("@nextLink") or None
        if url and url.startswith("/"):
            url = "https://manage.devcenter.microsoft.com" + url
    return [{"date": d, "downloads": per_day[d]} for d in sorted(per_day)]


def fetch_markets(app_id, token, start, end):
    """Top markets over the window (best-effort — never fatal)."""
    try:
        params = {"applicationId": app_id, "startDate": start.strftime("%Y-%m-%d"),
                  "endDate": end.strftime("%Y-%m-%d"), "groupby": "market"}
        data = api_get(API_BASE + "?" + urllib.parse.urlencode(params), token)
        tally = {}
        for row in data.get("Value", []):
            m = row.get("market") or "??"
            tally[m] = tally.get(m, 0) + int(row.get("acquisitionQuantity") or 0)
        top = sorted(tally.items(), key=lambda kv: -kv[1])[:8]
        return [{"market": m, "downloads": n} for m, n in top]
    except Exception as exc:
        print(f"  (markets skipped: {exc})")
        return []


def main():
    tenant = os.environ.get("STORE_TENANT_ID")
    client_id = os.environ.get("STORE_CLIENT_ID")
    client_secret = os.environ.get("STORE_CLIENT_SECRET")
    if not (tenant and client_id and client_secret):
        print("STORE_TENANT_ID / STORE_CLIENT_ID / STORE_CLIENT_SECRET not set — "
              "nothing to do yet (add them as GitHub Actions secrets). Exiting 0.")
        return 0

    try:
        token = get_token(tenant, client_id, client_secret)
    except Exception as exc:
        # Most likely cause down the line: Microsoft's MFA/API-auth tightening
        # blocking the headless app-only flow. Fall back to the manual .tsv route.
        print(f"ERROR getting Entra token: {exc}", file=sys.stderr)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    start, end = datetime.date.fromisoformat(START_DATE), now.date()
    index = []
    print(f"Fetching acquisitions (=downloads) {start}..{end}. Compare each 'total' "
          f"below against the acquisitions number in Partner Center.")
    for app in APPS:
        try:
            rows = fetch_daily(app["id"], token, start, end)
        except Exception as exc:
            print(f"{app['name']}: FAILED ({exc}) — keeping existing snapshot")
            index.append({"id": app["id"], "name": app["name"]})
            continue
        out = {
            "app": app["name"], "id": app["id"],
            "updated_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total": sum(r["downloads"] for r in rows),
            "rows": rows,
            "top_markets": fetch_markets(app["id"], token, start, end),
        }
        with open(os.path.join(OUT_DIR, app["id"] + ".json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        index.append({"id": app["id"], "name": app["name"]})
        print(f"{app['name']}: {len(rows)} days, total {out['total']}, "
              f"latest {rows[-1]['date'] if rows else 'none'}")

    with open(os.path.join(OUT_DIR, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
