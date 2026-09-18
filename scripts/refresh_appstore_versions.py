#!/usr/bin/env python3
"""Stamp each App Store app's FULL version history onto its tracker snapshot.

store-stats.html marks every release on the all-apps chart, so a jump in downloads can be read
against whether something shipped. The public iTunes lookup only knows the CURRENT version, so
this uses App Store Connect, which lists them all.

DATES ARE THE CAREFUL PART. App Store Connect exposes only `createdDate` on a version -- when
the version RECORD was made, which is submission, not public release. Usually that is a day or
two early, but not always: ManimStudio 1.0 was created 2026-04-28 and went public 2026-06-05,
thirty-eight days later. So both ends are anchored to Apple's own published dates, which are
authoritative:

  * the FIRST version takes `releaseDate` from the iTunes lookup -- the day the app itself
    became available, the figure the store shows;
  * the NEWEST takes `version_released` (currentVersionReleaseDate, already on the snapshot);
  * versions in between keep createdDate, and are marked `approx: true` so the page can say so.

That leaves the two marks anyone actually looks for exact, and the middles within a few days.

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
    return sorted(({"version": k, "released": v, "approx": True} for k, v in out.items()),
                  key=lambda r: r["released"])


def first_release(app_ids):
    """The day each app itself became available, from Apple's public lookup."""
    url = "https://itunes.apple.com/lookup?id=%s&country=us" % ",".join(app_ids)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log("  first-release lookup failed (%s)" % type(exc).__name__)
        return {}
    return {str(x["trackId"]): (x.get("releaseDate") or "")[:10]
            for x in data.get("results") or [] if x.get("trackId")}


def main():
    c = creds()
    if not c:
        return 0
    bearer = token(*c)
    index = json.loads((OUT / "index.json").read_text())
    firsts = first_release([a["id"] for a in index])
    touched = 0
    for app in index:
        path = OUT / ("%s.json" % app["id"])
        if not path.exists():
            continue
        hist = versions_for(app["id"], bearer)
        if not hist:
            continue
        cur = json.loads(path.read_text())
        launch = firsts.get(app["id"])
        if cur.get("version_released") and hist and hist[-1]["version"] == cur.get("version"):
            hist[-1]["released"] = cur["version_released"]
            hist[-1].pop("approx", None)
        if launch:
            # Versions created BEFORE the app was public never had a release of their own --
            # ManimStudio had 1.0, 1.1 and 1.2 on file before it launched on 2026-06-05. Dating
            # them by createdDate would put releases before the app existed, and moving them to
            # the launch date would invent three releases on one day. They collapse into the one
            # thing that is true: the app went on sale.
            hist = [v for v in hist if v["released"] > launch]
            hist.insert(0, {"version": "launch", "released": launch, "launch": True})
        cur["first_released"] = launch or cur.get("first_released")
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
