#!/usr/bin/env python3
"""Stamp each App Store app's FULL version history onto its tracker snapshot.

store-stats.html marks every release on the all-apps chart, so a jump in downloads can be read
against whether something shipped. The public iTunes lookup only knows the CURRENT version, so
this uses App Store Connect, which lists them all.

Dates: App Store Connect exposes only `createdDate` on a version -- when the version record was
made, which is a day or two before it goes live. The newest entry is therefore overridden with
`version_released` (Apple's published currentVersionReleaseDate, already on the snapshot) when
that is present, so the latest mark agrees with the date shown everywhere else on the page.
Older marks keep createdDate and are within a couple of days. Both are labelled as "released"
because at chart resolution the difference does not survive rounding to a bar.

Credentials, same three as refresh_appstore_stats.py:
  APPSTORE_ISSUER_ID / APPSTORE_KEY_ID / APPSTORE_PRIVATE_KEY
or, locally, ASC_ISSUER_ID / ASC_KEY_ID with the .p8 in ~/.appstoreconnect/private_keys/.

Writes nothing but the `versions` array. Fails soft: no history beats a wrong one.
"""
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parents[1]
OUT = HERE / "assets/appstore-tracker/data"
API = "https://api.appstoreconnect.apple.com/v1"
LIVE = {"READY_FOR_SALE", "REPLACED_WITH_NEW_INFO_FROM_DEVELOPER", "PENDING_DEVELOPER_RELEASE"}


def log(m):
    print(m, flush=True)


def creds():
    iss = os.environ.get("APPSTORE_ISSUER_ID") or os.environ.get("ASC_ISSUER_ID")
    kid = os.environ.get("APPSTORE_KEY_ID") or os.environ.get("ASC_KEY_ID")
    pem = os.environ.get("APPSTORE_PRIVATE_KEY")
    if not pem and kid:
        p = pathlib.Path.home() / ".appstoreconnect/private_keys" / ("AuthKey_%s.p8" % kid)
        if p.exists():
            pem = p.read_text()
    if not (iss and kid and pem):
        log("no App Store Connect credentials; leaving version history alone")
        return None
    return iss, kid, pem


def token(iss, kid, pem):
    import jwt                      # PyJWT with the cryptography extra, for ES256
    now = int(time.time())
    return jwt.encode({"iss": iss, "iat": now, "exp": now + 15 * 60,
                       "aud": "appstoreconnect-v1"},
                      pem, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})


def versions_for(app_id, bearer):
    url = (API + "/apps/%s/appStoreVersions?limit=200"
           "&fields[appStoreVersions]=versionString,createdDate,appStoreState" % app_id)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + bearer})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log("  %s: lookup failed (%s)" % (app_id, type(exc).__name__))
        return []
    out = {}
    for v in data.get("data") or []:
        a = v.get("attributes") or {}
        ver, made = a.get("versionString"), a.get("createdDate")
        if not ver or not made or a.get("appStoreState") not in LIVE:
            continue
        day = made[:10]
        # a version can have several records (resubmissions); keep the earliest
        if ver not in out or day < out[ver]:
            out[ver] = day
    return sorted(({"version": k, "released": v} for k, v in out.items()),
                  key=lambda r: r["released"])


def main():
    c = creds()
    if not c:
        return 0
    bearer = token(*c)
    index = json.loads((OUT / "index.json").read_text())
    touched = 0
    for app in index:
        path = OUT / ("%s.json" % app["id"])
        if not path.exists():
            continue
        hist = versions_for(app["id"], bearer)
        if not hist:
            continue
        # the newest mark uses the store's own published release date where we have it
        cur = json.loads(path.read_text())
        if cur.get("version_released") and hist[-1]["version"] == cur.get("version"):
            hist[-1]["released"] = cur["version_released"]
        if cur.get("versions") == hist:
            log("  %s: %d versions, unchanged" % (app["name"], len(hist)))
            continue
        cur["versions"] = hist
        path.write_text(json.dumps(cur, separators=(",", ":")))
        touched += 1
        log("  %s: %d versions, %s .. %s" % (app["name"], len(hist),
                                             hist[0]["released"], hist[-1]["released"]))
    log("updated %d app(s)" % touched)
    return 0


if __name__ == "__main__":
    sys.exit(main())
