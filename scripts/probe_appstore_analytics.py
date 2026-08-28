#!/usr/bin/env python3
"""Read-only dump of everything the Analytics Reports API will tell us.

Written because App Store Connect's web dashboard shows impressions while the
API was returning nothing, and guessing which of the two is wrong is not a
plan. This asks for EVERY report request, EVERY category, and EVERY
granularity, and prints exactly what comes back — no filtering, no assumptions.

Writes nothing. Safe to run any time.
"""
import json, os, sys, time, urllib.error, urllib.request

BASE = "https://api.appstoreconnect.apple.com/v1"
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

def api(path, bearer):
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + bearer})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode()[:300]
        except Exception: pass
        return {"_error": f"HTTP {e.code}", "_body": body}

def main():
    if not os.environ.get("APPSTORE_ISSUER_ID"):
        log("not configured"); return 0
    b = token()
    for app_id, name in APPS.items():
        log(f"\n{'='*66}\n{name}  ({app_id})\n{'='*66}")
        reqs = api(f"/apps/{app_id}/analyticsReportRequests?limit=50", b)
        if "_error" in reqs:
            log(f"  requests: {reqs['_error']} {reqs['_body']}"); continue
        for rq in reqs.get("data", []):
            at = rq.get("attributes", {})
            log(f"\n  request {rq['id']}")
            log(f"    accessType={at.get('accessType')}  "
                f"stoppedDueToInactivity={at.get('stoppedDueToInactivity')}")
            reports = api(f"/analyticsReportRequests/{rq['id']}/reports?limit=200", b)
            if "_error" in reports:
                log(f"    reports: {reports['_error']} {reports['_body']}"); continue
            rows = reports.get("data", [])
            if not rows:
                log("    reports: NONE")
                continue
            for rep in rows:
                ra = rep.get("attributes", {})
                nm, cat = ra.get("name"), ra.get("category")
                insts = api(f"/analyticsReports/{rep['id']}/instances?limit=200", b)
                if "_error" in insts:
                    log(f"    - {nm} [{cat}]: instances {insts['_error']}")
                    continue
                idata = insts.get("data", [])
                if not idata:
                    log(f"    - {nm} [{cat}]: 0 instances")
                    continue
                grans = {}
                for i in idata:
                    a = i.get("attributes", {})
                    grans.setdefault(a.get("granularity"), []).append(a.get("processingDate"))
                desc = "; ".join(f"{g}: {len(d)} ({min(d)}..{max(d)})"
                                 for g, d in grans.items())
                log(f"    - {nm} [{cat}]: {len(idata)} instances -> {desc}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
