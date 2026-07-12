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
PACKAGES = ["rmt-denoise", "cairometal", "narrate", "ollama-installer"]
OUT_DIR = os.path.join("assets", "pypi-tracker", "data")


def fetch(pkg):
    url = f"https://pypistats.org/api/packages/{pkg}/overall"
    req = urllib.request.Request(url, headers={"User-Agent": "yu314-coder.github.io stats refresher"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    # sum the with-mirrors series (matches the ClickHouse counts) per day
    per_day = {}
    for row in data.get("data", []):
        if row.get("category") != "with_mirrors":
            continue
        per_day[row["date"]] = per_day.get(row["date"], 0) + int(row.get("downloads") or 0)
    return [{"date": d, "downloads": per_day[d]} for d in sorted(per_day)]


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
        print(f"{pkg}: {len(rows)} days, latest {rows[-1]['date'] if rows else 'none'}")


if __name__ == "__main__":
    main()
