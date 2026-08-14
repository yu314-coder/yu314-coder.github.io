#!/usr/bin/env python3
"""Precompute TrackFormer Trackformer1.0 forecasts for every currently-active JMA tropical cyclone,
server-side, so the browser can show a result instantly instead of downloading the ONNX
model and running WASM inference itself — the point being speed for clients on bad
connections, not a different model or a different result.

Runs the full 10-seed fp32 ensemble (no int8 quantization, no seed subset) -- the same
gap-closing move investigated for the (unshipped) Hugging Face Docker backend, but for
free: this just runs in the GitHub Actions runner that's already fetching the data.

Data fetching mirrors assets/typhoon-tracker/app.js's fetchJmaTc/parseDTWind/
parseDTPressure/mergeDTPressure *exactly* (same JMA + Digital Typhoon endpoints, same
column-header matching, same "unavailable == exact zeros, not fabricated" convention) --
this is a translation of already-verified logic, not a new implementation. Model inference
reuses run_v23.py's own build_window/forecast functions by import, not by copy, so there is
no way for this script to silently drift from the reference pipeline.

Run by .github/workflows/refresh-typhoon-forecast.yml, which checks out yu314-coder/
typhoon-predict's Trackformer1.0 weights alongside this repo and sets V23_MODELS_DIR to them.
The architecture, norm stats, terrain and inference core are vendored in
scripts/trackformer10/ so a repo-layout change upstream cannot break this job.
"""
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
import torch
from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
# Weights are large and fetched by the workflow; everything needed to run them
# is vendored beside this file.
MODELS_DIR = os.environ.get("TF10_MODELS_DIR", str(REPO_ROOT.parent / "typhoon-predict" / "models" / "trackformer10"))
sys.path.insert(0, str(HERE / "trackformer10"))
from trackformer10 import build_v23  # noqa: E402
import trackformer10_core as ref  # noqa: E402  (build_window/run_forecast/HIST — verified equivalent)

JMA_BASE = "https://www.jma.go.jp/bosai/typhoon/data/"
DT_WIND = "https://agora.ex.nii.ac.jp/digital-typhoon/summary/wnp/k/"
DT_TRACK = "https://agora.ex.nii.ac.jp/digital-typhoon/summary/wnp/l/"
OUT_PATH = REPO_ROOT / "assets" / "typhoon-tracker" / "model" / "trackformer-live-forecast.json"
UA = {"User-Agent": "typhoon-tracker-forecast-bot/1.0 (+https://yu314-coder.github.io)"}


def _fetch(url, tries=4):
    """Read a URL, retrying a few times before giving up.

    These endpoints are third-party and occasionally blink: a scheduled run
    died on a bare 404 from JMA's targetTc.json, a file that always exists and
    was serving normally either side of it. One transient response should not
    lose the cycle. A genuine outage still fails the job rather than quietly
    shipping yesterday's forecast."""
    wait = 2
    last = None
    for attempt in range(tries):
        try:
            with urlopen(Request(url, headers=UA), timeout=25) as r:
                return r.read()
        except (HTTPError, URLError, TimeoutError, OSError) as e:
            last = e
            if attempt == tries - 1:
                break
            print(f"  {url} -> {e}; retrying in {wait}s "
                  f"({attempt + 1}/{tries - 1})", file=sys.stderr, flush=True)
            time.sleep(wait)
            wait *= 2.5
    raise last


def get_json(url):
    return json.loads(_fetch(url))


def get_text(url):
    return _fetch(url).decode("utf-8", "replace")


def num(v):
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# JMA specifications.json -- same fields as app.js's parseJma, current-analysis point only
# (spec[0] is the title block, spec[1] is the current "実況/Analysis" point).
# ---------------------------------------------------------------------------
# 北/南/東/西 and the four inter-cardinals, as JMA writes them in the wind-area
# records. A single entry means the area is a circle.
JP_BEARING = {"北": 0, "北東": 45, "東": 90, "南東": 135,
              "南": 180, "南西": 225, "西": 270, "北西": 315}
EN_BEARING = {"north": 0, "northeast": 45, "east": 90, "southeast": 135,
              "south": 180, "southwest": 225, "west": 270, "northwest": 315}


def jma_text(value):
    """JMA writes a localisable field either as a plain string or as a
    {"jp": ..., "en": ...} pair, and which one you get varies by storm and by
    bulletin. Treating the pair as a string is what took the whole run down:
    'dict' object has no attribute 'strip'."""
    if isinstance(value, dict):
        value = value.get("jp") or value.get("en") or ""
    return str(value or "").strip()


def jma_bearing(value):
    """The named side of a wind area, in either language. An unnamed or
    whole-area entry has no bearing, which downstream reads as a circle."""
    name = jma_text(value)
    if not name:
        return None
    return JP_BEARING.get(name, EN_BEARING.get(name.lower()))


def jma_semicircles(warning):
    """[{area, range:{nm}}] -> [(bearing_or_None, radius_nm)], or None.

    A part that does not parse is dropped rather than raised: a malformed wind
    area should cost the radii, not the storm's whole track forecast.
    """
    if not warning:
        return None
    out = []
    for part in warning:
        if not isinstance(part, dict):
            continue
        nm_value = ((part.get("range") or {}).get("nm"))
        if nm_value in (None, ""):
            continue
        try:
            radius = float(nm_value)
        except (TypeError, ValueError):
            continue
        out.append((jma_bearing(part.get("area")), radius))
    return out or None


def parse_jma(tc_id, spec):
    if not spec or len(spec) < 2:
        return None
    title = spec[0] or {}
    a = spec[1] or {}
    pos = ((a.get("position") or {}).get("deg")) or []
    if len(pos) < 2:
        return None
    sus = ((a.get("maximumWind") or {}).get("sustained")) or {}
    return {
        "tcId": tc_id,
        "name": jma_text((title.get("name") or {}).get("en")) or tc_id,
        "number": title.get("typhoonNumber") or "",
        "lat": pos[0], "lon": pos[1],
        "windKt": num(sus.get("kt")),
        "pressure": num(a.get("pressure")),
        "validUTC": (a.get("validtime") or {}).get("UTC"),
        # JMA publishes both wind areas on the analysis itself, as one entry per
        # semicircle with the side named in Japanese and the radius in nautical
        # miles. Same numbers as Digital Typhoon's major/minor columns, from the
        # issuing agency and already fetched, so this is the better source for the
        # current fix -- which is the one the intensity anchor reads.
        "storm_semicircles": jma_semicircles(a.get("stormWarning")),
        "gale_semicircles": jma_semicircles(a.get("galeWarning")),
    }


def cells_of(tr):
    return [c.get_text(strip=True) for c in tr.find_all(["th", "td"], recursive=False)]


def dt_num(v):
    return None if v in (None, "", "-", "—") else (float(v) if re.match(r"^-?\d+(\.\d+)?$", v) else None)


def cell_at(c, i, default=None):
    return c[i] if 0 <= i < len(c) else default


def dt_time_ms(c, ci):
    y = int(cell_at(c, ci["y"]))
    mo = int(cell_at(c, ci["mo"]) or 1)
    d = int(cell_at(c, ci["d"]) or 1)
    h = int(cell_at(c, ci["h"]) or 0)
    return int(datetime(y, mo, d, h, 0, tzinfo=timezone.utc).timestamp() * 1000)


# Digital Typhoon "Detailed Best Track Wind" (k) page -- wind + position, past fixes.
def parse_dt_wind(html):
    soup = BeautifulSoup(html, "html.parser")
    trs = soup.find_all("tr")
    header = None
    for tr in trs:
        cells = cells_of(tr)
        if len(cells) >= 10 and "Lat." in cells and "Radius of Major Storm Axis" in "|".join(cells):
            header = cells
            break
    if not header:
        return None

    def col(label):
        for i, c in enumerate(header):
            if label in c:
                return i
        return -1

    ci = {"y": col("Year"), "mo": col("Month"), "d": col("Day"), "h": col("Hour"),
          "lat": col("Lat"), "lon": col("Long"), "wind": col("Wind"),
          # JMA describes each wind area as two semicircles, not a circle: a
          # direction, the radius on that side (major) and the radius on the other
          # (minor). Both areas are published -- storm is 50 kt, gale is 30 kt.
          "storm_dir": col("Direc. of Major Storm Axis"),
          "storm_major": col("Radius of Major Storm Axis"),
          "storm_minor": col("Radius of Minor Storm Axis"),
          "gale_dir": col("Direc. of Major Gale Axis"),
          "gale_major": col("Radius of Major Gale Axis"),
          "gale_minor": col("Radius of Minor Gale Axis")}
    if ci["y"] < 0 or ci["lat"] < 0:
        return None
    out = []
    for tr in trs:
        c = cells_of(tr)
        if not (10 <= len(c) <= 30) or not re.match(r"^\d{4}$", cell_at(c, ci["y"], "") or ""):
            continue
        lat, lon = dt_num(cell_at(c, ci["lat"])), dt_num(cell_at(c, ci["lon"]))
        if lat is None or lon is None:
            continue
        def rad(key):
            return dt_num(cell_at(c, ci[key])) if ci.get(key, -1) >= 0 else None

        def direction(key):
            v = (cell_at(c, ci[key]) or "").strip() if ci.get(key, -1) >= 0 else ""
            return v if v and v not in ("-", "\u2014") else None

        out.append({"ms": dt_time_ms(c, ci), "lat": lat, "lon": lon,
                    "wind": dt_num(cell_at(c, ci["wind"])),
                    "storm_dir": direction("storm_dir"),
                    "storm_major_nm": rad("storm_major"), "storm_minor_nm": rad("storm_minor"),
                    "gale_dir": direction("gale_dir"),
                    "gale_major_nm": rad("gale_major"), "gale_minor_nm": rad("gale_minor")})
    return out or None


# Digital Typhoon "Detailed Track Information" (l) page -- same grid, carries pressure.
def parse_dt_pressure(html):
    soup = BeautifulSoup(html, "html.parser")
    trs = soup.find_all("tr")
    header = None
    for tr in trs:
        cells = cells_of(tr)
        if len(cells) >= 6 and "Lat." in cells and "Pressure" in "|".join(cells):
            header = cells
            break
    if not header:
        return None

    def col(label):
        for i, c in enumerate(header):
            if label in c:
                return i
        return -1

    ci = {"y": col("Year"), "mo": col("Month"), "d": col("Day"), "h": col("Hour"), "pres": col("Pressure")}
    if ci["y"] < 0 or ci["pres"] < 0:
        return None
    out = {}
    for tr in trs:
        c = cells_of(tr)
        if not (6 <= len(c) <= 20) or not re.match(r"^\d{4}$", cell_at(c, ci["y"], "") or ""):
            continue
        pres = dt_num(cell_at(c, ci["pres"]))
        if pres is None:
            continue
        out[dt_time_ms(c, ci)] = pres
    return out or None


# Same 1h dedup + sort as app.js's tfLivePts, and the same pressure merge as mergeDTPressure.
def build_points(a, dt_wind, dt_pres):
    now_ms = int(datetime.fromisoformat(a["validUTC"].replace("Z", "+00:00")).timestamp() * 1000) \
        if a.get("validUTC") else None
    raw = []
    if dt_wind:
        for o in dt_wind:
            if now_ms is not None and abs(o["ms"] - now_ms) < 3600000:
                continue
            raw.append({"ms": o["ms"], "lat": o["lat"], "lon": o["lon"],
                        "wind": o["wind"], "pres": (dt_pres or {}).get(o["ms"]),
                        **{k: o.get(k) for k in ("storm_dir", "storm_major_nm", "storm_minor_nm",
                                                 "gale_dir", "gale_major_nm", "gale_minor_nm")}})
    raw.append({"ms": now_ms if now_ms is not None else 0, "lat": a["lat"], "lon": a["lon"],
                "wind": a["windKt"], "pres": a["pressure"],
                "storm_semicircles": a.get("storm_semicircles"),
                "gale_semicircles": a.get("gale_semicircles")})
    raw.sort(key=lambda o: o["ms"])
    return raw


def fixes_from_points(points):
    # A fix with no wind report can't be encoded (vmax_kt is a required, non-fabricated
    # field for the model) -- drop it rather than invent a value, same "never fabricate"
    # convention used throughout this project.
    usable = [p for p in points if p["wind"] is not None]
    fixes = []
    for o in usable[-ref.HIST:]:
        t = datetime.fromtimestamp(o["ms"] / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M")
        fixes.append({"time": t, "lat": o["lat"], "lon": o["lon"], "vmax_kt": o["wind"], "pres_hpa": o["pres"],
                      **{k: o.get(k) for k in ("storm_dir", "storm_major_nm", "storm_minor_nm",
                                               "gale_dir", "gale_major_nm", "gale_minor_nm",
                                               "storm_semicircles", "gale_semicircles")}})
    return fixes


def run_forecast(models, fixes):
    times = [f["time"] for f in fixes]
    lat = np.array([f["lat"] for f in fixes], dtype="float64")
    lon = np.array([f["lon"] for f in fixes], dtype="float64")
    vmax = np.array([f["vmax_kt"] for f in fixes], dtype="float64")
    pres = np.array([f["pres_hpa"] if f["pres_hpa"] is not None else np.nan for f in fixes], dtype="float64")
    tns = np.array([np.datetime64(t).astype("datetime64[ns]").astype("int64") for t in times])
    lats, lons, vmaxs, presses, n_padded = ref.run_forecast(models, times, tns, lat, lon, vmax, pres)
    return {
        "issue_time": times[-1],
        "base_lat": float(lat[-1]), "base_lon": float(lon[-1]),
        "lead_hours": list(range(6, 121, 6)),
        "lats": [round(float(x), 3) for x in lats],
        "lons": [round(float(x), 3) for x in lons],
        "vmax_kt": [round(float(x), 1) for x in vmaxs],
        "pres_hpa": [round(float(x), 1) for x in presses],
        "n_padded_history": n_padded,
        "seeds": len(models), "precision": "fp32",
    }


def process_storm(tc, models):
    tc_id = tc["tropicalCyclone"]
    spec = get_json(f"{JMA_BASE}{tc_id}/specifications.json")
    a = parse_jma(tc_id, spec)
    if not a:
        return None
    dt_id = "20" + a["number"] if re.match(r"^\d{4}$", a["number"] or "") else None
    dt_wind = dt_pres = None
    if dt_id:
        try:
            dt_wind = parse_dt_wind(get_text(f"{DT_WIND}{dt_id}.html.en"))
        except Exception as e:
            print(f"{tc_id}: DT wind page failed ({e}), history from JMA analysis only", file=sys.stderr)
        try:
            dt_pres = parse_dt_pressure(get_text(f"{DT_TRACK}{dt_id}.html.en"))
        except Exception as e:
            print(f"{tc_id}: DT pressure page failed ({e})", file=sys.stderr)
    points = build_points(a, dt_wind, dt_pres)
    fixes = fixes_from_points(points)
    if not fixes:
        return None
    out = run_forecast(models, fixes)
    out["tcId"] = tc_id
    out["name"] = a["name"]
    return out


def load_models():
    root = Path(MODELS_DIR)
    ckpts = sorted(root.glob("v23_seed*.pt")) or sorted(root.rglob("v23_seed*.pt"))
    if not ckpts:
        sys.exit(f"no v23_seed*.pt checkpoints found in {MODELS_DIR}")
    models = []
    for c in ckpts:
        m = build_v23().eval()
        m.load_state_dict(torch.load(c, map_location="cpu", weights_only=False)["model"])
        models.append(m)
    print(f"loaded {len(models)} Trackformer1.0 seeds from {MODELS_DIR}", file=sys.stderr)
    return models


def main():
    active = get_json(JMA_BASE + "targetTc.json")
    storms = {}
    if active:
        models = load_models()
        for tc in active:
            tc_id = tc.get("tropicalCyclone")
            try:
                r = process_storm(tc, models)
                if r:
                    storms[tc_id] = r
                    print(f"{tc_id} ({r['name']}): forecast ok, {r['n_padded_history']} padded history steps",
                          file=sys.stderr)
            except Exception as e:
                print(f"{tc_id}: skipped ({e})", file=sys.stderr)
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "storms": storms}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    print(f"wrote {OUT_PATH} ({len(storms)} storm(s))", file=sys.stderr)


if __name__ == "__main__":
    main()
