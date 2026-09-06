#!/usr/bin/env python3
"""Keep the version numbers written into the HTML in step with the snapshots.

Most versions on this site are injected at runtime from the committed JSON, so
they cannot go stale. Two are also written into the markup as a fallback, shown
if the fetch fails: the Windows badge on the projects page and rmt-denoise's on
the PyPI page. A fallback that is never updated is just a slower kind of rot —
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

# (html file, attribute, directory holding <key>.json)
TARGETS = [
    ("projects.html", "data-msstore", "assets/store-tracker/data"),
    ("pypi-stats.html", "data-pkg", "assets/pypi-tracker/data"),
    ("index.html", "data-msstore", "assets/store-tracker/data"),
]


def main():
    changed = 0
    for fname, attr, datadir in TARGETS:
        path = HERE / fname
        if not path.exists():
            continue
        html = path.read_text()
        original = html

        # <span ... data-attr="KEY" ...>vX.Y.Z</span>
        pattern = re.compile(
            r'(' + re.escape(attr) + r'="([^"]+)"[^>]*>)v[0-9][0-9A-Za-z.\-]*(</)')

        def swap(m):
            nonlocal changed
            key = m.group(2)
            src = HERE / datadir / f"{key}.json"
            if not src.exists():
                return m.group(0)
            try:
                ver = json.loads(src.read_text()).get("version")
            except Exception:                                 # noqa: BLE001
                return m.group(0)
            if not ver:
                return m.group(0)
            return f"{m.group(1)}v{ver}{m.group(3)}"

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
