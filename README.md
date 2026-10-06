# Yu, Yao-Hsing 尤耀星 — Personal Portfolio

My research in random matrix theory, the apps and packages that came out of it, and the live data pages behind them.

**Live site:** [yu314-coder.github.io](https://yu314-coder.github.io/)

The research is mine. The apps, packages and this site are built with AI coding assistants (Claude, ChatGPT).

---

## Research

- **Paper** — on the limiting spectral distributions of products of sample covariance matrices with deterministic
  sequences. *Cambridge Journal for Junior Scientists*, Vol. 3 (2026) No. 2, pp. 365–382,
  doi:[10.4310/CJJS.260626162006](https://doi.org/10.4310/CJJS.260626162006).
- **2025 S. T. Yau High School Science Award** — Grand Finals, Bronze Medal; Asia Regional, Silver Medal.

---

## Pages

| Page | What it is |
|------|------------|
| [Home](https://yu314-coder.github.io/) | Animated eigenvalue-spiral hero, the published-research bar, live counters (apps shipped, app downloads, PyPI installs, countries) and ten "selected work" cards whose version badges come from the store snapshots |
| [About](https://yu314-coder.github.io/about.html) | Education, the paper and its advisors, skills, timeline |
| [Projects](https://yu314-coder.github.io/projects.html) | Grouped tiles: **Apps** (ManimStudio, CodeBench, Bootbox, GPS-location-app, SidecarBridge, others), **Research & AI** (Generalized Covariance + EigenDenoise, Apple on-device model teardown), **Tools** (py2bin). Versions are filled from the snapshots |
| [PyPI Stats](https://yu314-coder.github.io/pypi-stats.html) | Download analytics for my packages |
| [Store Stats](https://yu314-coder.github.io/store-stats.html) | App Store and Microsoft Store download dashboard |
| [Typhoon Tracks](https://yu314-coder.github.io/typhoon-tracks.html) | Western Pacific typhoon explorer with the Trackformer AI overlay |
| [Trackformer](https://yu314-coder.github.io/trackformer.html) | Model card for Trackformer 1.2, my typhoon-forecast model |
| [Privacy](https://yu314-coder.github.io/privacy.html) | Privacy policies for every published app |

### 🌀 Typhoon Tracks
A Western Pacific explorer on real agency data — nothing simulated, nothing filled in where a source hasn't published.

**History (IBTrACS v04r01, WP basin, 1945–present)** — about 2,090 storms in per-season shards under
`assets/data/typhoons/`, refreshed daily. Active storms are topped up in the browser from NCEI's IBTrACS
active-storms feed and the JTWC working best track (ATCF b-deck via UCAR/RAL), marked `LIVE`. Per-point Beaufort
force 8/10/12 wind radii, a time scrubber that animates position, wind, pressure, Dvorak T and radii together, season
overviews, ACE, rapid-intensification detection and ENSO (NOAA CPC ONI) badges. Two classification standards:
Saffir–Simpson-style on 1-minute winds, and Taiwan **CWA** on its official 10-minute thresholds applied to JMA's
10-minute wind analysis.

**Forecast (live JMA)** — JMA's 5-day forecasts fetched in the browser, the past leg enriched with Digital Typhoon
(NII) wind radii and UW-CIMSS ADT Dvorak numbers.

**AI overlay — Trackformer** ([typhoon-predict](https://github.com/yu314-coder/typhoon-predict))
- **Trackformer 1.2 first, read live in the visitor's browser** from the Trackformer Weather Lab API
  (`https://trackformer-weatherlab.rudin-euler-8253.chatgpt.site`: `/api/history/v1/storms/{id}`,
  `/api/history/v1/forecasts/{id}`, `/api/history/live`, `/api/benchmarks/released`). Nothing is mirrored into this
  repo. Every forecast is checked against the released checkpoint's SHA. A live run is only used within 12 h of the
  JMA analysis on screen. The shaded band is 1.2's published mean track error per lead, not the spread of the run.
  1.2 publishes no wind radii, so none are drawn.
- **Trackformer 1.1 as the fallback** — a live run written every few hours by `refresh-typhoon-forecast.yml` (a
  causal route built only from GFS analyses), and committed history hindcasts: 1,221 storms, seasons 1979–2026,
  44,620 runs under `assets/typhoon-tracker/model/trackformer11/`.
- **Track mode** ("Run my AI model") forecasts from any scrubbed point on a past storm and draws it against what the
  storm actually did.
- An **intensity chip** names the model and gives the category at +24 / 48 / 72 / 96 / 120 h on the chosen scale
  (Saffir–Simpson-style or CWA 輕度 / 中度 / 強烈).
- If neither model has a run for a time, nothing is drawn rather than a different model substituted. Clearly
  flagged experimental — not an operational forecast.

### Trackformer
The model card for Trackformer 1.2 (released 29 Sep 2026):
- **Model:** 21.5 M parameters, MIT licence, western North Pacific; trained 2000–2021, validated 2022–2023, tested
  2024–2025.
- **Track benchmark:** 1,473 daily starts from 270 storms — mean track error **471.2 km** vs 798.4 km for 1.1.
  Intensity is stated as no established gain.
- **Examples:** 50-member mean forecast videos streamed from
  [Hugging Face](https://huggingface.co/euler314/typhoon-predict) (Mangkhut, Fung-wong, Meranti, Soudelor).
- **Also on the page:** the archive of 32,230 forecasts, how to run it, the paper (PDF + BibTeX), and the version
  history (1.0, 16 Jul · 1.1, 20 Aug · 1.2, 29 Sep).
- Its figures refresh live from the same Weather Lab API; the values in the markup are only the fallback.

### 📊 Store Stats
- **App Store** (ManimStudio, EigenDenoise, SidecarBridge, GPS-location-app, WhisperKit):
  - Daily **first-time downloads** (redownloads and updates excluded), impressions and product-page views.
  - An iPhone / iPad / Mac / Apple Watch split, countries, and release marks on the charts.
  - Pulled by `refresh-appstore-stats.yml` from App Store Connect (sales reports, Analytics Reports API, app
    versions). It uses the repo secrets `APPSTORE_ISSUER_ID`, `APPSTORE_KEY_ID`, `APPSTORE_PRIVATE_KEY` and
    `APPSTORE_VENDOR_NUMBER`.
- **Microsoft Store** (ManimStudio, t-SNE Visualization, Generalized Covariance Matrix):
  - The Partner Center funnel — page views → install attempts → successful installs (= downloads) → first launches —
    plus weekly installs for ManimStudio.
  - **Manual** (a personal Microsoft account can't get API access): export the CSVs, then run
    `python3 scripts/build_store_stats_from_csv.py`. App versions are automated.
- The two stores count differently, so the page keeps their wording separate. Charts are hand-drawn SVG
  (`assets/js/stats-core.js`).

### 📦 PyPI Stats
- **Package cards and a "real installs, mirrors removed" panel** — read from same-origin snapshots that
  `refresh-pypi-stats.yml` takes from pypistats.org twice a day.
- **Country / version / Python breakdowns** — queried live from the public ClickPy ClickHouse dataset in the browser.
- Guarded by **Byte**, a canvas robot that watches your cursor.

---

## Apps on stores

| App | Platform | Store | Source |
|-----|----------|-------|--------|
| ManimStudio | iOS / iPadOS | [App Store](https://apps.apple.com/app/manimstudio/id6764472686) | [GitHub (ios)](https://github.com/yu314-coder/manim_app/tree/ios) |
| ManimStudio | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9NZFT55DVCBS) | [GitHub](https://github.com/yu314-coder/manim_app) |
| WhisperKit | iOS | [App Store](https://apps.apple.com/app/whisperkit/id6764759491) | [GitHub](https://github.com/yu314-coder/WhisperKit) |
| SidecarBridge | iOS / iPadOS / macOS | [App Store](https://apps.apple.com/app/sidecarbridge/id6792298083) | [GitHub](https://github.com/yu314-coder/SidecarBridge) |
| GPS-location-app | iOS / watchOS | [App Store](https://apps.apple.com/app/gps-location-app/id6764729098) | [GitHub](https://github.com/yu314-coder/GPS-location-app) |
| EigenDenoise | macOS | [Mac App Store](https://apps.apple.com/app/eigendenoise/id6764759636) | [GitHub](https://github.com/yu314-coder/EigenDenoise) |
| Generalized Covariance Matrix | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9nzj475s7b01) | [GitHub](https://github.com/yu314-coder/random_matrix_ESD) |
| t-SNE Visualization | Windows 10+ | [Microsoft Store](https://apps.microsoft.com/detail/9P969D6N7P6J) | [GitHub](https://github.com/yu314-coder/t-sne) |

Current versions are on the site; the snapshots refresh them hourly.

## Other projects

| Project | What it is | Links |
|---------|------------|-------|
| CodeBench | Offline developer / scientific / AI workstation for iPad and Mac | [GitHub](https://github.com/yu314-coder/CodeBench) |
| python-ios-lib | Python 3.14 for iOS / iPadOS with native offline libraries, including PyTorch with a Metal bridge | [GitHub](https://github.com/yu314-coder/python-ios-lib) · [torchmetal](https://github.com/yu314-coder/torchmetal) |
| Bootbox | A boot manager for iPad: real operating systems (64-bit Linux, Android 12, classic Windows) in a WebKit-hosted emulation stack | [GitHub](https://github.com/yu314-coder/Bootbox) |
| Apple on-device model teardown | A static reverse-engineering of Apple's on-device foundation model (the sparse Mixture-of-Experts backbone in Apple Intelligence), down to a component-validated PyTorch forward pass | [GitHub](https://github.com/yu314-coder/afm-ifp-teardown) |
| py2bin | Stdlib-only Python compiler to ELF / PE / Mach-O | [GitHub](https://github.com/yu314-coder/python_to_binary) · [PyPI](https://pypi.org/project/python-to-binary/) |
| NeonScribe | Creative writing and text processing tool | [GitHub](https://github.com/yu314-coder/NeonScribe) |
| Sound Transfer | TCP audio streaming between devices | [GitHub](https://github.com/yu314-coder/sound_transfer) |
| Google Drive Download | Downloading from Google Drive in Python | [GitHub](https://github.com/yu314-coder/google_drive_download) |

## PyPI packages

| Package | What it is | Links |
|---------|------------|-------|
| rmt-denoise | Image denoising via random matrix theory (MP law + generalized covariance) | [GitHub](https://github.com/yu314-coder/rmt-denoise) · [PyPI](https://pypi.org/project/rmt-denoise/) |
| cairometal | pycairo-compatible 2D graphics on the Apple GPU via Metal (macOS arm64) | [GitHub](https://github.com/yu314-coder/cairometal) · [PyPI](https://pypi.org/project/cairometal/) |
| narrate | Local text-to-speech (Kokoro, Chatterbox) | [GitHub](https://github.com/yu314-coder/narrate) · [PyPI](https://pypi.org/project/narrate/) |
| ollama-installer | Install Ollama from a Python CLI | [GitHub](https://github.com/yu314-coder/python-ollama) · [PyPI](https://pypi.org/project/ollama-installer/) |
| python-to-binary | The py2bin compiler | [GitHub](https://github.com/yu314-coder/python_to_binary) · [PyPI](https://pypi.org/project/python-to-binary/) |

---

## Automation (GitHub Actions)

| Workflow | When | What it does |
|----------|------|--------------|
| `refresh-typhoon-archive.yml` | daily | Rebuilds the recent IBTrACS seasons and bumps the tracker's cache tokens |
| `refresh-typhoon-forecast.yml` | every 20 min (GitHub runs it every few hours in practice) | Runs Trackformer 1.1 on the live JMA storm and commits the fallback forecast |
| `build-trackformer11-history.yml` | hourly schedule | Adds Trackformer 1.1 history hindcasts (CFSR/CDAS reanalysis, plus recovered live runs) |
| `backfill-tf11-gfs.yml` | manual | Batch hindcasts from the GFS archive, one commit |
| `refresh-appstore-stats.yml` | hourly, and after the other refreshes | App Store sales and analytics, app versions on both stores, PyPI versions |
| `refresh-pypi-stats.yml` | twice a day | pypistats snapshots for my packages |
| `refresh-data.yml` | every 2 h on weekdays | Refreshes data embedded in the home page |
| `bench-autopilot.yml` | daily, and on arcade changes | Plays the home-page arcade headless to check its autopilot still reaches a floor level |
| `train-arcade-policy.yml` | weekly | Trains the arcade's aiming policy; commits it only if it beats the incumbent on held-out seeds |
| `probe-*.yml` | manual | Read-only probes of the App Store analytics and the NCEI analysis archives |

## Project structure

```
yu314-coder.github.io/
├── index.html · about.html · projects.html · trackformer.html · privacy.html · 404.html
├── typhoon-tracks.html           # wrapper for assets/typhoon-tracker/
├── store-stats.html · pypi-stats.html
├── assets/
│   ├── css/style.css             # also the @font-face rules for assets/fonts
│   ├── js/                       # ui.js (hero spiral, counters), main.js (navbar, visitor panel),
│   │                             #   arcade.js (the hidden arcade, fetched only when opened),
│   │                             #   stats-core.js (store / PyPI charts)
│   ├── fonts/                    # self-hosted WOFF2 + each family's OFL licence
│   ├── vendor/bootstrap-5.3.3/   # Bootstrap CSS + JS bundle, served from here
│   ├── typhoon-tracker/          # the explorer (index.html · app.js · styles.css)
│   │   └── model/                #   Trackformer 1.1 live forecast + history hindcasts
│   ├── data/typhoons/            # IBTrACS season shards, index, climatology
│   ├── appstore-tracker/data/    # App Store snapshots
│   ├── store-tracker/            # Microsoft Store snapshots (+ the CSVs they're built from)
│   ├── pypi-tracker/             # PyPI snapshots + the ClickHouse iframe app (Byte lives here)
│   ├── img/                      # app icons, store badges, typhoon figures, og-image
│   ├── afm/                      # Apple on-device model teardown paper
│   └── docs/                     # research paper PDF
├── scripts/                      # the refresh / build scripts the workflows run
├── .github/workflows/
├── sitemap.xml · robots.txt · favicon.svg · favicon.ico
├── .nojekyll                     # Pages serves the files as they are; no Jekyll build
└── README.md
```

## Tech stack

- Static HTML / CSS / JavaScript on **GitHub Pages** — no build step, no framework, no server of my own.
- **Bootstrap 5.3.3**, served from this repository. **Plotly 2.35.2** (geo and basic bundles, from its CDN) for the
  typhoon map and the PyPI iframe charts. Hand-drawn SVG for the store and PyPI dashboards.
- **Fonts** — Space Grotesk, Sora, JetBrains Mono, Source Serif 4 (SIL OFL), self-hosted as variable WOFF2; the
  first screen needs nothing from another host. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- **Live sources** — NOAA NCEI IBTrACS (archive and active storms), JTWC b-deck via UCAR/RAL, JMA *bosai* forecasts,
  Digital Typhoon (NII), UW-CIMSS ADT, NOAA CPC ONI, the Trackformer Weather Lab API, App Store Connect,
  Microsoft Partner Center exports, pypistats.org and ClickPy ClickHouse.

Every figure on the data pages traces to a named source.

---

## License

This project is open source. Feel free to use it as a starting point for your own portfolio.

---

© 2026 Yu, Yao-Hsing 尤耀星. All rights reserved.
