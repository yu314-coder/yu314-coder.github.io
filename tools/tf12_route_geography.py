"""Reconstruct the eight route-geography channels from a 0.25 deg land mask.

The release derives these from Natural Earth 50m land plus ESA WorldCover on a
global 0.25 deg grid. This uses NOAA's own 0.25 deg land-sea mask, which is the
same resolution but not the same coastline, so these are a reconstruction of
the documented quantities rather than the exact training map. Anything built on
it has to be labelled that way.
"""
import numpy as np
from scipy.ndimage import uniform_filter, maximum_filter, distance_transform_edt

CHANNELS = ("land_fraction", "coast_proximity", "land_fraction_75km",
            "land_fraction_150km", "land_fraction_300km", "land_buffer_25km",
            "land_buffer_50km", "land_local_std_150km")
DEG_KM = 111.195


def build(lsm, lat, lon, lat_lo=-5.0, lat_hi=65.0, lon_lo=85.0, lon_hi=245.0):
    """Crop to the route domain (plus margin for the 300 km kernels) and derive."""
    if lat[0] > lat[-1]:                       # incoming mask is 90..-90
        lat, lsm = lat[::-1], lsm[::-1, :]
    ys = np.where((lat >= lat_lo) & (lat <= lat_hi))[0]
    xs = np.where((lon >= lon_lo) & (lon <= lon_hi))[0]
    sub = lsm[np.ix_(ys, xs)].astype("float32")
    slat, slon = lat[ys], lon[xs]
    dlat_km = float(np.abs(slat[1] - slat[0])) * DEG_KM
    dlon_deg = float(np.abs(slon[1] - slon[0]))

    # A kernel in cells is latitude dependent because longitude spacing shrinks
    # with cos(lat); do each latitude band with its own width rather than
    # pretending the grid is square.
    def ring(radius_km, op):
        out = np.empty_like(sub)
        ny = max(1, int(round(radius_km / dlat_km)))
        for i, la in enumerate(slat):
            km_per_lon = DEG_KM * max(np.cos(np.deg2rad(la)), 0.05) * dlon_deg
            nx = max(1, int(round(radius_km / km_per_lon)))
            lo, hi = max(0, i - ny), min(sub.shape[0], i + ny + 1)
            band = sub[lo:hi, :]
            if op == "mean":
                out[i] = uniform_filter(band, size=(band.shape[0], 2 * nx + 1),
                                        mode="nearest")[band.shape[0] // 2 if band.shape[0] > 1 else 0]
            elif op == "max":
                out[i] = maximum_filter(band, size=(band.shape[0], 2 * nx + 1),
                                        mode="nearest")[band.shape[0] // 2 if band.shape[0] > 1 else 0]
            elif op == "std":
                m = uniform_filter(band, size=(band.shape[0], 2 * nx + 1), mode="nearest")
                m2 = uniform_filter(band * band, size=(band.shape[0], 2 * nx + 1), mode="nearest")
                v = np.maximum(m2 - m * m, 0.0)
                out[i] = np.sqrt(v)[band.shape[0] // 2 if band.shape[0] > 1 else 0]
        return out

    land = (sub > 0.5).astype("float32")
    # distance to the nearest coast, in km, unsigned
    coast = np.zeros_like(land, dtype=bool)
    coast[:-1, :] |= land[:-1, :] != land[1:, :]
    coast[:, :-1] |= land[:, :-1] != land[:, 1:]
    if coast.any():
        d_cells = distance_transform_edt(~coast, sampling=(dlat_km, DEG_KM * dlon_deg))
    else:
        d_cells = np.full_like(land, 9999.0)

    stack = np.stack([
        sub,
        d_cells.astype("float32"),
        ring(75.0, "mean"), ring(150.0, "mean"), ring(300.0, "mean"),
        ring(25.0, "max"), ring(50.0, "max"),
        ring(150.0, "std"),
    ]).astype("float32")
    return stack, slat.astype("float32"), slon.astype("float32")


if __name__ == "__main__":
    z = np.load("landmask.npz")
    m, la, lo = build(z["lsm"], z["lat"], z["lon"])
    np.savez_compressed("geo_static.npz", static_map=m, lat=la, lon=lo,
                        names=np.array(CHANNELS))
    print(f"  static_map {m.shape}  lat {la[0]}..{la[-1]}  lon {lo[0]}..{lo[-1]}")
    for i, c in enumerate(CHANNELS):
        print(f"    {c:22} {m[i].min():8.2f} .. {m[i].max():8.2f}")
