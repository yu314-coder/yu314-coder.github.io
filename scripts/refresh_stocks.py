#!/usr/bin/env python3
"""Snapshot a stock watchlist into static JSON for the hidden stocks page.

Same pattern as refresh_pypistats.py / refresh_store_stats.py: fetch server-side
(no CORS limits, no API key in the browser) and commit the result, so the page
always has real data to show. The page ALSO tries a live refresh in the browser
via a CORS proxy; this snapshot is what it falls back to when that is unavailable
— which is often, since public CORS proxies are rate-limited and flaky.

Yahoo's chart endpoint needs no key. No credentials are involved anywhere.
"""
import json
import os
import urllib.request

TICKERS = [
    # symbol,        display,                              market
    ("0050.TW", "Yuanta Taiwan Top 50 ETF", "TW"),
    ("0056.TW", "Yuanta Taiwan Dividend Plus ETF", "TW"),
    ("00929.TW", "Fuh Hwa Taiwan Tech Dividend ETF", "TW"),
    ("2330.TW", "TSMC 台積電", "TW"),
    ("AAPL", "Apple", "US"),
    ("AMD", "AMD", "US"),
    ("NVDA", "NVIDIA", "US"),
    ("GOOG", "Alphabet", "US"),
]
OUT = os.path.join("assets", "stocks", "data", "quotes.json")
API = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1mo&interval=1d"
UA = {"User-Agent": "Mozilla/5.0 (compatible; yu314-site/1.0)"}


def fetch(sym):
    req = urllib.request.Request(API.format(sym), headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    res = d["chart"]["result"][0]
    meta = res["meta"]
    closes = [c for c in (res.get("indicators", {}).get("quote", [{}])[0].get("close") or []) if c is not None]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    return {
        "symbol": sym,
        "price": price,
        "prev_close": prev,
        "change": (price - prev) if (price is not None and prev is not None) else None,
        "change_pct": ((price - prev) / prev * 100) if (price and prev) else None,
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName"),
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "fifty_two_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_low": meta.get("fiftyTwoWeekLow"),
        "market_time": meta.get("regularMarketTime"),
        "spark": [round(c, 4) for c in closes[-30:]],
    }


def main():
    import datetime
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    rows = []
    for sym, name, market in TICKERS:
        try:
            q = fetch(sym)
            q["name"] = name
            q["market"] = market
            rows.append(q)
            print(f"{sym:10s} {q['price']} {q['currency']} ({q['change_pct']:+.2f}%)")
        except Exception as exc:                      # never fail the whole run for one symbol
            print(f"{sym:10s} FAILED: {exc}")
            rows.append({"symbol": sym, "name": name, "market": market, "error": str(exc)[:120]})
    out = {
        "updated_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance chart API (no key)",
        "quotes": rows,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    ok = sum(1 for r in rows if "price" in r)
    print(f"wrote {OUT} — {ok}/{len(rows)} quotes")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
