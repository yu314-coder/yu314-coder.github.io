"""Regression tests for the JMA bulletin parser.

    python3 tests/jma_parse_test.py

These exist because the live forecast run died on 2026-08-14 with

    TC2620: skipped (AttributeError: 'dict' object has no attribute 'strip')
    1 storm(s) active and none forecast; leaving trackformer-live-forecast.json
    untouched rather than replacing it with an empty file

JMA writes a localisable field either as a plain string or as a {"jp", "en"}
pair, and which one you get varies by storm and by bulletin -- in that payload
`part`, `category` and `speed.note` are all pairs. The wind area was being
treated as a string, so the pair form took the whole run down: the storm was
skipped, no forecast was produced, and the guard correctly refused to blank the
live overlay and exited non-zero.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "tf10", os.path.join(HERE, "scripts", "run_trackformer10_forecast.py"))
tf10 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tf10)

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))


def semis(name, warning, want):
    try:
        got = tf10.jma_semicircles(warning)
    except Exception as e:                                  # noqa: BLE001
        got = f"{type(e).__name__}: {e}"
    check(name, got == want, "" if got == want else f"got {got!r} want {want!r}")


# --- the shape that broke it ------------------------------------------------
semis("an area written as a {jp, en} pair parses",
      [{"area": {"jp": "北東", "en": "northeast"}, "range": {"nm": "150"}},
       {"area": {"jp": "南西", "en": "southwest"}, "range": {"nm": "90"}}],
      [(45, 150.0), (225, 90.0)])

# --- and everything it used to handle still does ----------------------------
semis("a plain Japanese area still parses",
      [{"area": "北東", "range": {"nm": "150"}}, {"area": "南西", "range": {"nm": "90"}}],
      [(45, 150.0), (225, 90.0)])
semis("an English area parses, whatever its case",
      [{"area": "Northeast", "range": {"nm": "120"}}], [(45, 120.0)])
semis("a whole-area entry has no bearing, so it reads as a circle",
      [{"area": {"jp": "全域", "en": "all"}, "range": {"nm": "80"}}], [(None, 80.0)])
semis("so does a part with no area at all", [{"range": {"nm": "60"}}], [(None, 60.0)])
semis("nothing usable gives None, not an empty list", [{"range": {}}], None)
semis("no warning at all gives None", None, None)

# A malformed part must cost the radii, never the storm: the whole point of the
# failure was one bad field taking down a run that had a track to publish.
semis("a junk part is dropped rather than raised",
      ["nonsense", {"area": {"jp": "東"}, "range": {"nm": "70"}}, {"range": {"nm": "x"}}],
      [(90, 70.0)])

check("jma_text unwraps a pair", tf10.jma_text({"jp": "北", "en": "north"}) == "北")
check("jma_text passes a string through", tf10.jma_text("  北東  ") == "北東")
check("jma_text turns nothing into an empty string",
      tf10.jma_text(None) == "" and tf10.jma_text({}) == "")

# A full bulletin in the pair-heavy shape must parse end to end.
spec_doc = [
    {"name": {"jp": "ナンカー", "en": "Nangka"}, "typhoonNumber": "2617"},
    {"part": {"jp": "実況", "en": "Analysis"},
     "category": {"jp": "台風", "en": "TY"},
     "position": {"deg": [28.0, 155.0]},
     "speed": {"note": {"jp": "ゆっくり", "en": "Slow"}},
     "pressure": "996",
     "maximumWind": {"sustained": {"kt": "65"}},
     "validtime": {"UTC": "2026-08-14T12:00:00Z"},
     "stormWarning": [{"area": {"jp": "北東", "en": "northeast"}, "range": {"nm": "70"}},
                      {"area": {"jp": "南西", "en": "southwest"}, "range": {"nm": "50"}}],
     "galeWarning": [{"area": {"jp": "北東", "en": "northeast"}, "range": {"nm": "200"}},
                     {"area": {"jp": "南西", "en": "southwest"}, "range": {"nm": "150"}}]},
]
try:
    parsed = tf10.parse_jma("TC2620", spec_doc)
    err = None
except Exception as e:                                      # noqa: BLE001
    parsed, err = None, f"{type(e).__name__}: {e}"
check("a whole pair-shaped bulletin parses", parsed is not None, err or "")
if parsed:
    check("with its name, fix and pressure",
          parsed["name"] == "Nangka" and parsed["lat"] == 28.0 and parsed["pressure"] == 996.0,
          f"{parsed['name']} {parsed['lat']} {parsed['pressure']}")
    check("and both wind areas as semicircles",
          parsed["storm_semicircles"] == [(45, 70.0), (225, 50.0)] and
          parsed["gale_semicircles"] == [(45, 200.0), (225, 150.0)],
          f"{parsed['storm_semicircles']} {parsed['gale_semicircles']}")

failed = 0
for name, ok, detail in results:
    failed += not ok
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f"   [{detail}]" if detail else ""))
print(f"\n{len(results) - failed}/{len(results)} passed")
sys.exit(1 if failed else 0)
