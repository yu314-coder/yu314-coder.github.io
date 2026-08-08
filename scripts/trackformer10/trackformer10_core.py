#!/usr/bin/env python3
"""TrackFormer Trackformer1.0 inference core, vendored into this repo.

Why vendored: this used to be imported from yu314-coder/typhoon-predict's
models/run_v23.py, but that repo was restructured (models/ became models/v10 +
models/Trackformer1.0) and run_v23.py, trackformer10_terrain_wp.npz and models/trackformer10.py no
longer exist there at all. The scheduled workflow only kept working because
actions/cache still held a pre-restructure copy; the next cache eviction would
have broken it silently. Only the 10 seed checkpoints are still fetched
remotely -- everything needed to *run* them now lives here.

dist2land/build_window/run_forecast below are the same implementations that
were verified bit-identical to run_v23.py's own output on a real storm before
being relied on. Keep them in lockstep with the research repo if it changes.
"""
import math
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
R = 111.2       # km per degree latitude
HIST = 9        # kinematic-history window length the model was trained with

_terrain = np.load(HERE / "trackformer10_terrain_wp.npz")
_T_LAT, _T_LON, _LSM = _terrain["lat"], _terrain["lon"], _terrain["lsm"]
_LAND = _LSM > 0.5
_LAND_LAT = _T_LAT[np.where(_LAND)[0]]
_LAND_LON = _T_LON[np.where(_LAND)[1]]


def dist2land(lat_i, lon_i):
    if len(_LAND_LAT) == 0:
        return 3000.0
    import math
    dlat = _LAND_LAT - lat_i
    dlon = (_LAND_LON - lon_i) * math.cos(math.radians(lat_i))
    return float(np.hypot(dlon * R, dlat * R).min())

def build_window(times, tns, lat, lon, vmax, pres):
    """Verbatim from models/run_v23.py — kept in lockstep with the verified reference script."""
    import math
    n = len(times)
    base = n - 1
    hidx = [max(0, base - HIST + 1 + k) for k in range(HIST)]
    n_padded = max(0, HIST - 1 - base)
    t0 = int(tns[base])
    doy = (np.datetime64(times[base]) - np.datetime64(times[base][:4] + "-01-01")).astype(int) + 1
    phase = 2 * math.pi * doy / 365.25
    seq = np.zeros((HIST, 54), dtype="float32")
    prev, pdir = -1, None

    def mkm(a, b, c, d):
        dlat = c - a; dlon = ((d - b + 180) % 360) - 180
        return dlon * R * math.cos(math.radians((a + c) / 2)), dlat * R

    for i, idx in enumerate(hidx):
        e, n_ = mkm(lat[base], lon[base], lat[idx], lon[idx])
        se, sn = (0., 0.) if prev < 0 else mkm(lat[prev], lon[prev], lat[idx], lon[idx])
        f = seq[i]; f[0:4] = [e, n_, se, sn]
        vv = [vmax[idx], pres[idx], np.nan, np.nan]
        for j in range(4):
            f[4 + j] = vv[j] if np.isfinite(vv[j]) else 0.
        f[24:28] = [float(np.isfinite(x)) for x in vv]
        f[21:23] = [math.sin(phase), math.cos(phase)]; f[23] = (t0 - int(tns[idx])) / 3.6e12
        sp = math.hypot(se, sn); hs, hc = (se / sp, sn / sp) if (sp > 1e-3 and prev >= 0) else (0., 0.)
        f[40], f[41], f[42] = hs, hc, sp
        f[43] = (pdir[0] * hc - pdir[1] * hs) if (pdir and (hs or hc) and (pdir[0] or pdir[1])) else 0.
        if prev >= 0:
            dv = np.isfinite(vmax[prev]) and np.isfinite(vmax[idx])
            dp = np.isfinite(pres[prev]) and np.isfinite(pres[idx])
            f[44] = vmax[idx] - vmax[prev] if dv else 0.
            f[45] = pres[idx] - pres[prev] if dp else 0.
            f[46], f[47] = float(dv), float(dp)
        lat_i, lon_i = lat[idx], lon[idx]
        m = np.datetime64(times[idx]).astype("datetime64[M]").astype(int) % 12 + 1
        d2l = dist2land(lat_i, lon_i % 360)
        thermal = 0.5 * 23.44 * math.sin(2 * math.pi * (m - 3) / 12.0)
        f[48] = lat_i; f[49] = abs(lat_i); f[50] = math.sin(math.radians(lon_i)); f[51] = math.cos(math.radians(lon_i))
        f[52] = d2l; f[53] = max(0., min(31., 30. - 0.30 * abs(lat_i - thermal) ** 1.4))
        if hs or hc:
            pdir = (hs, hc)
        prev = idx

    from trackformer10 import TMEAN, TSTD
    seq_n = (seq - TMEAN) / TSTD
    vpair = np.concatenate([seq[-1, 2:4], seq[-2, 2:4]]).astype("float32")
    return seq_n, vpair, n_padded

@torch.no_grad()
def run_forecast(models, times, tns, lat, lon, vmax, pres):
    from trackformer10 import TARGET_SCALE
    import math
    seq_n, vpair, n_padded = build_window(times, tns, lat, lon, vmax, pres)
    tr = torch.from_numpy(seq_n[None]); vp = torch.from_numpy(vpair[None])
    slp = torch.zeros((1, 4, 17, 17), dtype=torch.float32)
    hist = torch.zeros((1, 8, 17, 17), dtype=torch.float32)
    have = torch.zeros((1, 2), dtype=torch.float32)
    args = [tr, vp, slp, hist, have]
    motion = torch.stack([m(*args)[0] for m in models]).mean(0)[0] * TARGET_SCALE
    motion = motion.float().numpy()
    la, lo = float(lat[-1]), float(lon[-1])
    lats, lons, vmaxs, presses = [], [], [], []
    for L in range(20):
        e, n_ = motion[L, 0], motion[L, 1]
        la = la + n_ / R; lo = lo + e / (R * math.cos(math.radians(la)))
        lats.append(la); lons.append(lo)
        vmaxs.append(float(motion[L, 2])); presses.append(float(motion[L, 3]))
    return lats, lons, vmaxs, presses, n_padded