#!/usr/bin/env python3
"""Stamp each App Store app's version history and the platforms it runs on.

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

PLATFORMS come from the same public lookup: `kind` plus `supportedDevices`, which is Apple's
own list of every model the binary will install on. A Mac App Store app is macOS; an iOS app
lists iPhone and iPad models, and lists Apple Watch models when it ships a watchOS app and Mac
models when it runs on Apple silicon. That is how GPS-location-app is known to be iOS, iPadOS
and watchOS while SidecarBridge is iOS, iPadOS and macOS -- read from Apple rather than typed.

Writes `versions` and `platforms`. Fails soft: no history beats a wrong one.
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
# Only what is actually on sale. PENDING_DEVELOPER_RELEASE is approved but unreleased and
# IN_REVIEW is not even that -- marking either as a release would put a line on the chart for
# something nobody could download.
LIVE = {"READY_FOR_SALE"}


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
           "&fields[appStoreVersions]=versionString,createdDate,appStoreState,platform" % app_id)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + bearer})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log("  %s: lookup failed (%s)" % (app_id, type(exc).__name__))
        return []
    # Keyed by (platform, version), NOT by version alone. A cross-platform app has a separate
    # stream per platform: SidecarBridge shipped 1.0 through 1.3 on iOS and again on macOS, and
    # collapsing them by version number merged two real release lines into one and left them out
    # of date order.
    out = {}
    for v in data.get("data") or []:
        a = v.get("attributes") or {}
        ver, made = a.get("versionString"), a.get("createdDate")
        if not ver or not made or a.get("appStoreState") not in LIVE:
            continue
        key = (PLATFORM.get(a.get("platform"), a.get("platform") or ""), ver)
        day = made[:10]
        if key not in out or day < out[key]:      # resubmissions: keep the earliest
            out[key] = day
    return sorted(({"version": k[1], "platform": k[0], "released": d, "approx": True}
                   for k, d in out.items()),
                  key=lambda r: (r["released"], r["platform"], r["version"]))


# Device-model prefix -> the OS that runs it. iPod touch is folded into iOS rather than listed:
# it is the same build and the same OS, and no one shopping for these apps is on one.
DEVICE_OS = (("iPhone", "iOS"), ("iPod", "iOS"), ("iPad", "iPadOS"),
             ("AppleWatch", "watchOS"), ("Watch", "watchOS"), ("Mac", "macOS"),
             ("AppleTV", "tvOS"), ("Vision", "visionOS"), ("RealityDevice", "visionOS"))
OS_ORDER = ["iOS", "iPadOS", "watchOS", "macOS", "tvOS", "visionOS"]
# App Store Connect's platform enum, as it appears on a version record.
PLATFORM = {"IOS": "iOS", "MAC_OS": "macOS", "TV_OS": "tvOS", "VISION_OS": "visionOS",
            "WATCH_OS": "watchOS"}


def platforms_of(result):
    """Every OS this app installs on, from Apple's own supportedDevices list."""
    if result.get("kind") == "mac-software":
        return ["macOS"]
    found = set()
    for dev in result.get("supportedDevices") or []:
        for prefix, os_name in DEVICE_OS:
            if dev.startswith(prefix):
                found.add(os_name)
                break
    return [o for o in OS_ORDER if o in found]


def lookup(app_ids):
    """Apple's public record for each app: first release date, and what it runs on."""
    url = "https://itunes.apple.com/lookup?id=%s&country=us" % ",".join(app_ids)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log("  public lookup failed (%s)" % type(exc).__name__)
        return {}
    return {str(x["trackId"]): {"first": (x.get("releaseDate") or "")[:10],
                                "platforms": platforms_of(x)}
            for x in data.get("results") or [] if x.get("trackId")}


def main():
    c = creds()
    if not c:
        return 0
    bearer = token(*c)
    index = json.loads((OUT / "index.json").read_text())
    pub = lookup([a["id"] for a in index])
    touched = 0
    for app in index:
        path = OUT / ("%s.json" % app["id"])
        if not path.exists():
            continue
        hist = versions_for(app["id"], bearer)
        if not hist:
            continue
        cur = json.loads(path.read_text())
        info = pub.get(app["id"]) or {}
        launch = info.get("first")
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
        # Compare BEFORE writing anything onto `cur`, or the check compares the new value with
        # itself and every app reports "unchanged" while nothing gets saved.
        same = (cur.get("versions") == hist
                and (not info.get("platforms") or cur.get("platforms") == info["platforms"])
                and (not launch or cur.get("first_released") == launch))
        if same:
            log("  %s: %d versions, unchanged" % (app["name"], len(hist)))
            continue
        cur["first_released"] = launch or cur.get("first_released")
        if info.get("platforms"):
            cur["platforms"] = info["platforms"]
        cur["versions"] = hist
        path.write_text(json.dumps(cur, separators=(",", ":")))
        touched += 1
        log("  %s: %d versions, %s .. %s  [%s]" % (app["name"], len(hist),
            hist[0]["released"], hist[-1]["released"], " · ".join(cur.get("platforms") or [])))
    log("updated %d app(s)" % touched)
    return 0


if __name__ == "__main__":
    sys.exit(main())
