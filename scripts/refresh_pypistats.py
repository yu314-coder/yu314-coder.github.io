#!/usr/bin/env python3
"""Snapshot pypistats.org daily downloads for the tracked packages into static
JSON that the PyPI-stats page reads same-origin — no CORS proxy at runtime.

pypistats.org runs ~a week ahead of the ClickHouse public dataset the page uses
for country/version breakdowns, but it sends no CORS headers, so a browser can't
call it directly. Fetching it here (server-side, in CI) and committing the result
gives the chart fresh data with zero third-party runtime dependency.

Refreshed daily by .github/workflows/refresh-pypi-stats.yml.
"""
import datetime
import json
import os
import urllib.request

# The page's "My packages" quick-picks — keep in sync with assets/pypi-tracker/index.html.
# A just-published package 404s here until pypistats.org first indexes it; that is
# handled below as a normal failure, so it can be listed from day one.
PACKAGES = ["rmt-denoise", "cairometal", "narrate", "ollama-installer", "python-to-binary"]
OUT_DIR = os.path.join("assets", "pypi-tracker", "data")


def fetch(pkg):
    url = f"https://pypistats.org/api/packages/{pkg}/overall"
    req = urllib.request.Request(url, headers={"User-Agent": "yu314-coder.github.io stats refresher"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    # Keep BOTH series, not just one.
    #
    # pypistats splits every day into with_mirrors and without_mirrors. Mirrors
    # are bandwidth: CDN and mirror fetches, CI caches, anything re-serving the
    # file rather than a person or a build installing it. The difference between
    # the two is often most of the number, and which one you want depends on the
    # question -- "how much traffic did this cause" is a different question from
    # "how many installs were there".
    #
    # Only with_mirrors used to be stored, so the page could not answer the
    # second question at all and the choice had already been made for the reader.
    per_day = {}
    for row in data.get("data", []):
        cat = row.get("category")
        if cat not in ("with_mirrors", "without_mirrors"):
            continue
        d = per_day.setdefault(row["date"], {"with_mirrors": 0, "without_mirrors": 0})
        d[cat] += int(row.get("downloads") or 0)
    # `downloads` stays as the with-mirrors figure so an older page still reads
    # this file correctly.
    return [{"date": d,
             "downloads": per_day[d]["with_mirrors"],
             "with_mirrors": per_day[d]["with_mirrors"],
             "without_mirrors": per_day[d]["without_mirrors"]}
            for d in sorted(per_day)]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for pkg in PACKAGES:
        try:
            rows = fetch(pkg)
        except Exception as exc:  # keep the last good snapshot on any failure
            print(f"{pkg}: FAILED ({exc}) — keeping existing snapshot")
            continue
        out = {
            "package": pkg,
            "updated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "rows": rows,
        }
        with open(os.path.join(OUT_DIR, f"{pkg}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        last = rows[-1] if rows else None
        print(f"{pkg}: {len(rows)} days, latest "
              + (f"{last['date']} ({last['with_mirrors']} with mirrors, "
                 f"{last['without_mirrors']} without)" if last else "none"))


if __name__ == "__main__":
    main()
