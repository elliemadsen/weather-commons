"""Make data/maps.json: modelled change in annual precipitation and temperature, 2034-2043.

Source: Hirasawa et al. (2023), Zenodo 8384453 (CC BY 4.0), CESM2 at about 1 degree.
Follows the authors' notebook (Figure 2):
- MCB effect   = mean of 3 MCB runs (2034-2043)  minus  SSP2-4.5 ensemble mean (2034-2043)
- Warming alone = SSP2-4.5 ensemble mean (2034-2043)  minus  historical ensemble mean (1995-2014)
- p-value: t-test with pooled standard deviation, using the decade-mean ensemble spread
  files (16 SSP2-4.5 runs, 50 historical runs) and the spread of the 3 MCB runs.

Values are stored as integers in hundredths (0.01 mm/day, 0.01 degC). A string of 0/1
marks cells where p < 0.05. The land mask is the model's own (LANDFRAC > 0.5).

Run from the sketch folder after tools/fetch_data.py:
    python3 tools/make_maps.py
"""
import argparse
import json
import pathlib

import numpy as np
import xarray as xr
from scipy import stats

HERE = pathlib.Path(__file__).resolve().parent
SKETCH = HERE.parent

Y1, Y2 = 2034, 2043
B1, B2 = 1995, 2014
N_SSP, N_HIST, N_MCB = 16, 50, 3
EXPS = ["R1", "R2", "R3", "R1R2R3"]
MCB_MEMBERS = ["1011.001", "1031.002", "1051.003"]
VARS = {"PRECT": (8.64e7, "mm/day"), "TREFHT": (1.0, "°C")}


def open_monthly(path, var):
    ds = xr.open_dataset(path)
    da = ds[var]
    # CESM stamps monthly means at the end of the month; use the middle of the bounds instead.
    bnds = next((b for b in ("time_bnds", "time_bounds") if b in ds), None)
    if bnds is not None:
        mid = ds[bnds].mean(dim=ds[bnds].dims[-1])
        da = da.assign_coords(time=mid.values)
    return da


def annual_mean(da, y1, y2):
    sel = da.sel(time=slice(f"{y1}-01-01", f"{y2}-12-31"))
    years = sel.groupby("time.year").mean()
    assert years.sizes["year"] == y2 - y1 + 1, f"expected {y2 - y1 + 1} years, got {years.sizes['year']}"
    return years


def squeeze_std(path, var):
    with xr.open_dataset(path) as ds:
        da = ds[var].load()
    for d in list(da.dims):
        if d not in ("lat", "lon"):
            da = da.isel({d: 0})
    return da.values


def pvalue(diff, pooled, n1, n2):
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.abs(diff) / pooled / np.sqrt(1 / n1 + 1 / n2)
    return stats.t.sf(t, n1 + n2 - 2) * 2


def pack(values, conv, p):
    ints = np.round(values * conv * 100).astype(int)
    sig = "".join("1" if x < 0.05 else "0" for x in np.nan_to_num(p, nan=1).ravel())
    return {"v": ints.ravel().tolist(), "sig": sig}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SKETCH / "assets" / "hirasawa2023"))
    ap.add_argument("--out", default=str(SKETCH / "data" / "maps.json"))
    ap.add_argument("--exps", default=",".join(EXPS), help="for testing, e.g. R1")
    args = ap.parse_args()
    src = pathlib.Path(args.src)

    with xr.open_dataset(src / "cam_gridinfo.nc") as g:
        land = g["LANDFRAC"].load()
        lat = g["lat"].values
        lon = g["lon"].values
    land = land.isel({d: 0 for d in land.dims if d not in ("lat", "lon")}).values

    out = {
        "about": "Modelled change in annual mean precipitation (rain and snow) and 2 m air temperature, CESM2 (Hirasawa et al. 2023, GRL, doi:10.1029/2023GL104314; data Zenodo 8384453, CC BY 4.0). Made by tools/make_maps.py.",
        "period": [Y1, Y2],
        "baseline": [B1, B2],
        "lat": [round(float(x), 3) for x in lat],
        "lon": [round(float(x), 3) for x in lon],
        "land": "".join("1" if x > 0.5 else "0" for x in land.ravel()),
        "scale": 0.01,
        "vars": {},
    }

    for var, (conv, unit) in VARS.items():
        ssp = annual_mean(open_monthly(src / f"b.e21.BSSP245smbb.f09_g17.ensmean.cam.h0.{var}.201501-206412.nc", var), Y1, Y2).mean("year").values
        hist = annual_mean(open_monthly(src / f"b.e21.BHISTsmbb.f09_g17.LE2-ENSMEAN.cam.h0.{var}.199001-201412.nc", var), B1, B2).mean("year").values
        ssp_std = squeeze_std(src / f"b.e21.BSSP245smbb.f09_g17.decmean_ensstd.cam.h0.{var}.{Y1}-{Y2}.nc", var)
        hist_std = squeeze_std(src / f"b.e21.BHISTsmbb.f09_g17.decmean_ensstd.cam.h0.{var}.{B1}-{B2}.nc", var)

        fields = {}
        diff = ssp - hist
        pooled = np.sqrt((ssp_std**2 * (N_SSP - 1) + hist_std**2 * (N_HIST - 1)) / (N_SSP + N_HIST - 2))
        fields["SSP"] = pack(diff, conv, pvalue(diff, pooled, N_SSP, N_HIST))

        for exp in args.exps.split(","):
            runs = np.array([
                annual_mean(open_monthly(src / f"b.e21.BSSP245smbb_MCB600cm_{exp}.f09_g17.LE2-{m}.cam.h0.{var}.2015-2064.nc", var), Y1, Y2).mean("year").values
                for m in MCB_MEMBERS
            ])
            diff = runs.mean(0) - ssp
            mcb_std = runs.std(0)  # as in the authors' notebook (np.std)
            pooled = np.sqrt((mcb_std**2 * (N_MCB - 1) + ssp_std**2 * (N_SSP - 1)) / (N_MCB + N_SSP - 2))
            fields[exp] = pack(diff, conv, pvalue(diff, pooled, N_MCB, N_SSP))

        out["vars"][var] = {"unit": unit, "fields": fields}
        w = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, lon.size))
        summary = {k: round(float((np.array(f["v"]).reshape(w.shape) * w).sum() / w.sum() * 0.01), 3) for k, f in fields.items()}
        print(var, "global mean change:", summary)

    path = pathlib.Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
