#!/usr/bin/env python3
"""Refresh the price data embedded in index.html.

The symbols are read from the base64 blob already in index.html, so no ticker
list lives in the repo as plaintext — this script is generic and works off
whatever is currently embedded. It re-fetches each symbol from Yahoo's keyless
chart endpoint (server-side, so no CORS and no key) and writes the updated blob
back. Run on a schedule by .github/workflows/refresh-data.yml. A symbol that
fails to fetch keeps its previous values rather than dropping out.
"""
import base64
import datetime
import json
import os
import re
import time
import urllib.request

PAGE = "index.html"
API = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval={}&includePrePost=true"
UA = {"User-Agent": "Mozilla/5.0 (compatible; site-refresh/1.0)"}
RANGES = [("1D", "1d", "5m"), ("1W", "5d", "30m"), ("1M", "1mo", "1d"),
          ("3M", "3mo", "1d"), ("1Y", "1y", "1wk"), ("5Y", "5y", "1mo")]
BLOB_RE = re.compile(r'var EMBEDDED = JSON\.parse\(atob\("([A-Za-z0-9+/=]+)"\)\);')


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


def main():
    html = open(PAGE, encoding="utf-8").read()
    m = BLOB_RE.search(html)
    if not m:
        print("No embedded blob found — nothing to refresh.")
        return 0
    old = json.loads(base64.b64decode(m.group(1)))
    rows = []
    for q in old.get("quotes", []):
        sym = q.get("symbol")
        try:
            nq = fetch(sym)
            nq["name"] = q.get("name")
            nq["market"] = q.get("market")
            rows.append(nq)
            print(f"{sym:10s} {nq['price']} {nq['currency']} ({nq['session']})")
        except Exception as exc:
            print(f"{sym:10s} FAILED ({exc}) — keeping previous")
            rows.append(q)                               # never drop a symbol
    out = {
        "updated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": old.get("source", "Yahoo Finance chart API (no key)"),
        "ranges": [r[0] for r in RANGES],
        "quotes": rows,
    }
    b64 = base64.b64encode(json.dumps(out, separators=(",", ":")).encode()).decode()
    new = html[:m.start()] + 'var EMBEDDED = JSON.parse(atob("%s"));' % b64 + html[m.end():]
    if new != html:
        open(PAGE, "w", encoding="utf-8").write(new)
        print(f"updated {PAGE}")
    else:
        print("no change")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
