#!/usr/bin/env python3
"""Keep the version numbers written into the HTML in step with the snapshots.

Most versions on this site are injected at runtime from the committed JSON, so
they cannot go stale. A few are also written into the markup as a fallback, shown
if the fetch fails: the Windows badges on the projects page, rmt-denoise's on the
PyPI page, the App Store version named in SidecarBridge's status line, python-to-binary's
version on its tab, and the lowest OS each App Store app installs on (min_os). A fallback that is never updated is just a slower kind of rot —
it was a hand-typed v1.1.3.0 sitting under a live v1.1.4.0 badge that made the
contradiction visible in the first place.

This rewrites those literals from the same snapshots the page reads at runtime,
so the fallback is always the last known good value rather than whatever was
true when someone typed it.

Idempotent: writes a file only when the number actually differs.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parents[1]

# (html file, attribute, directory holding <key>.json[, field in it -- "version" if left out])
TARGETS = [
    ("projects.html", "data-msstore", "assets/store-tracker/data"),
    ("pypi-stats.html", "data-pkg", "assets/pypi-tracker/data"),
    ("index.html", "data-msstore", "assets/store-tracker/data"),
    # A version written into a sentence rather than a badge, so it carries no "v" prefix.
    ("projects.html", "data-appver", "assets/appstore-tracker/data"),
    ("projects.html", "data-pypi", "assets/pypi-tracker/data"),
    # "iOS 18.5+", "macOS 26.2 or later": Apple's minimumOsVersion, which the snapshot keeps as min_os.
    ("projects.html", "data-minos", "assets/appstore-tracker/data", "min_os"),
]


def main():
    changed = 0
    for fname, attr, datadir, *rest in TARGETS:
        field = rest[0] if rest else "version"
        path = HERE / fname
        if not path.exists():
            continue
        html = path.read_text()
        original = html

        # <span ... data-attr="KEY" ...>vX.Y.Z</span>, or the same without the "v" where the
        # number sits in a sentence. The prefix is captured and put back as it was found, so a
        # badge keeps its v and prose keeps its bare number.
        pattern = re.compile(
            r'(' + re.escape(attr) + r'="([^"]+)"[^>]*>)(v?)[0-9][0-9A-Za-z.\-]*(</)')

        def swap(m):
            nonlocal changed
            key = m.group(2)
            src = HERE / datadir / f"{key}.json"
            if not src.exists():
                return m.group(0)
            try:
                ver = json.loads(src.read_text()).get(field)
            except Exception:                                 # noqa: BLE001
                return m.group(0)
            if not ver:
                return m.group(0)
            return f"{m.group(1)}{m.group(3)}{ver}{m.group(4)}"

        html = pattern.sub(swap, html)
        if html != original:
            path.write_text(html)
            changed += 1
            print(f"  {fname}: fallback versions synced")
        else:
            print(f"  {fname}: already current")
    print(f"updated {changed} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
