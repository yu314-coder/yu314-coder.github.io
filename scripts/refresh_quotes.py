#!/usr/bin/env python3
"""Refresh the home page's unlisted watchlist snapshot, assets/data/sx.txt.

The file is base64 JSON, so no ticker list lives in the repo as plaintext --
this script is generic and works off whatever symbols the file already holds.
It re-fetches each from Yahoo's keyless chart endpoint (server-side, so no
CORS and no key) and writes the file back. A symbol that fails to fetch keeps
its previous values rather than dropping out. Run on a schedule by
.github/workflows/refresh-data.yml.

The snapshot used to be embedded in index.html (41 KB of a 105 KB page that
every visitor downloaded for a panel almost nobody opens), with the page
refreshing it live through public CORS proxies. Those all stopped answering in
October 2026, so this file is now the panel's only source and is fetched when
the panel opens. The first run moves the old embedded blob out of index.html.

The file is only rewritten when a quote changed: updated_utc alone moving is
not a change, so the frequent schedule commits nothing while markets are shut.
"""
import base64
import datetime
import json
import os
import re
import time
import urllib.request

PAGE = "index.html"
SNAP = os.path.join("assets", "data", "sx.txt")
API = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval={}&includePrePost=true"
UA = {"User-Agent": "Mozilla/5.0 (compatible; site-refresh/1.0)"}
RANGES = [("1D", "1d", "5m"), ("1W", "5d", "30m"), ("1M", "1mo", "1d"),
          ("3M", "3mo", "1d"), ("1Y", "1y", "1wk"), ("5Y", "5y", "1mo")]
BLOB_RE = re.compile(r'var EMBEDDED = JSON\.parse\(atob\("([A-Za-z0-9+/=]+)"\)\);')


def px(v):
    """A price at the precision the panel shows (2 dp; 4 below 1). Yahoo revises
    single bars by 0.001 after the close, and at 4 dp each revision rewrote the
    file and made a commit nobody could see."""
    if v is None:
        return None
    return round(v, 2) if abs(v) >= 1 else round(v, 4)


def tidy(q):
    for k in ("price", "prev_close", "change", "day_high", "day_low", "w52_high", "w52_low",
              "ext_price", "ext_change"):
        q[k] = px(q.get(k))
    for k in ("change_pct", "ext_change_pct"):
        if q.get(k) is not None:
            q[k] = round(q[k], 2)
    q["series"] = {r: [px(c) for c in v] for r, v in (q.get("series") or {}).items()}
    if q.get("day"):
        q["day"]["pts"] = [[t, px(c)] for t, c in q["day"].get("pts") or []]
    return q


def get(sym, rng, iv):
    req = urllib.request.Request(API.format(sym, rng, iv), headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["chart"]["result"][0]


def session_of(meta, now=None):
    cp = meta.get("currentTradingPeriod") or {}
    now = now or time.time()
    for name in ("pre", "regular", "post"):
        p = cp.get(name) or {}
        if p.get("start") is not None and p["start"] <= now < p.get("end", 0):
            return name
    return "closed"


def fetch(sym):
    day = get(sym, "1d", "5m")
    m = day["meta"]
    price = m.get("regularMarketPrice")
    prev = m.get("previousClose", m.get("chartPreviousClose"))
    ts = day.get("timestamp") or []
    closes = (day.get("indicators", {}).get("quote", [{}])[0].get("close")) or []
    bars = [(t, c) for t, c in zip(ts, closes) if c is not None]
    sess = session_of(m)

    ext_price = ext_ref = None
    cp = m.get("currentTradingPeriod") or {}
    reg = cp.get("regular") or {}
    pre, post = cp.get("pre") or {}, cp.get("post") or {}
    # Only markets with a real extended session get an off-market number. Taiwan
    # equities report zero-width pre/post windows, so any "outside" bar there is
    # just the opening auction and would duplicate the close.
    has_ext = (pre.get("end", 0) > pre.get("start", 0)
               or post.get("end", 0) > post.get("start", 0))
    if has_ext and bars and reg.get("start") is not None:
        outside = [(t, c) for t, c in bars if t < reg["start"] or t >= reg.get("end", 0)]
        inside = [c for t, c in bars if reg["start"] <= t < reg.get("end", 0)]
        if outside:
            ext_price = outside[-1][1]
            ext_ref = inside[-1] if inside else prev

    out = {
        "symbol": sym, "price": price, "prev_close": prev,
        "change": (price - prev) if (price is not None and prev is not None) else None,
        "change_pct": ((price - prev) / prev * 100) if (price and prev) else None,
        "currency": m.get("currency"), "exchange": m.get("fullExchangeName"),
        "tz": m.get("exchangeTimezoneName"),
        "day_high": m.get("regularMarketDayHigh"), "day_low": m.get("regularMarketDayLow"),
        "w52_high": m.get("fiftyTwoWeekHigh"), "w52_low": m.get("fiftyTwoWeekLow"),
        "market_time": m.get("regularMarketTime"), "session": sess,
        # The trading periods this snapshot saw, so the page can tell "open" from
        # "closed" by its own clock between snapshots.
        "tp": {k: [(cp.get(k) or {}).get("start"), (cp.get(k) or {}).get("end")]
               for k in ("pre", "regular", "post")},
        "ext_price": ext_price,
        "ext_change": (ext_price - ext_ref) if (ext_price is not None and ext_ref) else None,
        "ext_change_pct": ((ext_price - ext_ref) / ext_ref * 100) if (ext_price and ext_ref) else None,
        "series": {}, "range_pct": {},
    }
    # 1D chart is anchored to the REGULAR session (US 9:30–16:00, TW 9:00–13:30) so
    # its first point is the market open, like Google Finance. tradingPeriods.regular
    # tracks the day the data covers; currentTradingPeriod rolls to the next session
    # once the market shuts, so prefer the former. A partial session (mid-day) stops
    # the line at "now" because t1 stays the scheduled close.
    tp = m.get("tradingPeriods") or {}
    try:
        regp = tp["regular"][0][0]
    except (KeyError, IndexError, TypeError):
        regp = reg
    r0, r1 = regp.get("start"), regp.get("end")
    reg_bars = [(t, c) for t, c in bars if r0 is not None and r1 is not None and r0 <= t <= r1]
    if len(reg_bars) >= 2:
        t0, t1 = int(r0), int(r1)
        dpts = [[int(t), round(c, 4)] for t, c in reg_bars]
    elif len(bars) >= 2:
        # Pre-market before the open (no regular bars yet) or a holiday: keep what
        # we have rather than emitting an empty chart.
        t0, t1 = int(bars[0][0]), int(bars[-1][0])
        dpts = [[int(t), round(c, 4)] for t, c in bars]
    else:
        t0 = t1 = None
        dpts = []
    out["day"] = {"t0": t0, "t1": t1, "pts": dpts[-260:]}
    out["range_pct"]["1D"] = round(out["change_pct"], 2) if out["change_pct"] is not None else None
    for label, rng, iv in RANGES:
        if label == "1D":
            continue
        try:
            cl = [c for c in ((get(sym, rng, iv).get("indicators", {}).get("quote", [{}])[0].get("close")) or []) if c is not None]
            if not cl:
                continue
            out["series"][label] = [round(c, 4) for c in cl[-160:]]
            base = cl[0]
            out["range_pct"][label] = round((cl[-1] - base) / base * 100, 2) if base else None
        except Exception as exc:
            print(f"    {sym} {label}: {exc}")
    return out


def load_old():
    """The current snapshot: the file, or (first run) the blob still embedded in index.html."""
    if os.path.exists(SNAP):
        with open(SNAP, encoding="ascii") as f:
            return json.loads(base64.b64decode(f.read().strip()))
    m = BLOB_RE.search(open(PAGE, encoding="utf-8").read())
    return json.loads(base64.b64decode(m.group(1))) if m else None


def strip_embedded():
    """Drop the old embedded blob from index.html once the file exists (first run only)."""
    html = open(PAGE, encoding="utf-8").read()
    m = BLOB_RE.search(html)
    if m:
        open(PAGE, "w", encoding="utf-8").write(html[:m.start()] + html[m.end():])
        print(f"moved the embedded snapshot out of {PAGE}")


def main():
    old = load_old()
    if not old:
        print("No snapshot found — nothing to refresh.")
        return 0
    rows = []
    for q in old.get("quotes", []):
        sym = q.get("symbol")
        try:
            nq = tidy(fetch(sym))
            nq["name"] = q.get("name")
            nq["market"] = q.get("market")
            rows.append(nq)
            print(f"{sym:10s} {nq['price']} {nq['currency']} ({nq['session']})")
        except Exception as exc:
            print(f"{sym:10s} FAILED ({exc}) — keeping previous")
            rows.append(q)                               # never drop a symbol
    if os.path.exists(SNAP) and rows == old.get("quotes"):
        print("no change")
        return 0
    out = {
        "updated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": old.get("source", "Yahoo Finance chart API (no key)"),
        "ranges": [r[0] for r in RANGES],
        "quotes": rows,
    }
    os.makedirs(os.path.dirname(SNAP), exist_ok=True)
    with open(SNAP, "w", encoding="ascii") as f:
        f.write(base64.b64encode(json.dumps(out, separators=(",", ":")).encode()).decode() + "\n")
    print(f"updated {SNAP}")
    strip_embedded()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
