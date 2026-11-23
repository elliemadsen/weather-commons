"""Summarise the Hirasawa et al. (2023) tipping-element metrics into data/tipping.json.

Follows the authors' notebook (Zenodo 8384453, Figure 3):
- MCB period: 2034-2043 (the decade in which MCB in all three regions holds
  global temperature near its 1995-2014 level).
- Warming effect: mean of 16 SSP2-4.5 runs (2034-2043) minus mean of 50
  historical runs (1995-2014).
- MCB effect: mean of 3 MCB runs minus mean of the 16 SSP2-4.5 runs, same decade.
- Significance: two-sample t-test with pooled variance on decade means.

Run from the sketch folder after tools/fetch_data.py:
    python3 tools/make_tipping.py
"""
import argparse
import json
import pathlib
import zipfile
from datetime import datetime

import numpy as np
import xarray as xr
from scipy import stats

HERE = pathlib.Path(__file__).resolve().parent
SKETCH = HERE.parent

Y1, Y2 = 2034, 2043
B1, B2 = 1995, 2014
EXPS = ["R1", "R2", "R3", "R1R2R3"]
MCB_MEMBERS = ["1011.001", "1031.002", "1051.003"]
SSP_MEMBERS = [f"{i:03d}" for i in range(1, 17)]
HIST_MEMBERS = (
    [f"LE2-{1011 + (i - 1) * 20}.{i:03d}" for i in range(1, 11)]
    + [f"LE2-{start}.{i:03d}" for start in (1231, 1251, 1281, 1301) for i in range(11, 21)]
)

# id: file key, variable, tipping element, indicator (as in the authors' notebook), unit conversion,
# unit, box (lat, lon in -180..180), surface, sign of the change the authors treat as increased risk.
METRICS = [
    ("Amazon_MCWD", "MCWD", "Amazon rainforest", "Annual maximum cumulative water deficit (MCWD)", 1, "mm", [-7, 7], [-70, -45], "land", -1),
    ("Sahel_P", "PRECT", "Sahel / West African monsoon", "Annual mean precipitation", 1, "mm/day", [10, 20], [-15, 35], "land", 1),
    ("caribbean_meandhw", "DHW", "Caribbean Sea coral reefs", "Annual maximum degree heating weeks (DHW)", 1, "°C-weeks", [12, 25], [-85, -65], "ocean", 1),
    ("coralsea_meandhw", "DHW", "Coral Sea coral reefs", "Annual maximum degree heating weeks (DHW)", 1, "°C-weeks", [-25, -10], [145, 165], "ocean", 1),
    ("westindian_meandhw", "DHW", "West Indian Ocean coral reefs", "Annual maximum degree heating weeks (DHW)", 1, "°C-weeks", [-25, 0], [35, 60], "ocean", 1),
    ("AMOC", "AMOC", "Atlantic Meridional Overturning Circulation (AMOC)", "Annual mean maximum overturning streamfunction at 30°N", 1, "Sv", [27, 33], [-80, -5], "ocean", -1),
    ("NAtl_HBLT", "maxHBLT", "North Atlantic subpolar gyre convection", "Annual maximum monthly mixed-layer depth", 1, "cm", [45, 60], [-50, -20], "ocean", -1),
    ("Barents_MA_SIC", "sea_ice_area", "Barents Sea winter sea ice", "March–April sea-ice area", 1e-12, "million km²", [70, 80], [10, 60], "ocean", -1),
    ("Greenland_Ts", "TREFHT", "Greenland Ice Sheet", "Annual mean 2 m air temperature", 1, "K", [60, 80], [-60, -20], "land", 1),
    ("NAmerica_PF_soilice", "permafrost_area", "North American permafrost", "Permafrost area", 1e-12, "million km²", [60, 75], [-160, -60], "land", -1),
    ("Eurasia_PF_soilice", "permafrost_area", "Eurasian permafrost", "Permafrost area", 1e-12, "million km²", [60, 80], [65, 180], "land", -1),
    ("Amundsen_wind", "U", "Amundsen Sea (West Antarctic Ice Sheet)", "Annual mean surface zonal wind speed", 1, "m/s", [-71.8, -70.2], [-115, -102], "ocean", 1),
    ("EastAntarctic_JetLat", "Usurf_maxlat", "East Antarctica (Southern Hemisphere westerly jet)", "Latitude of the annual mean surface zonal jet", 1, "°", [-70, -50], [0, 160], "ocean", -1),
]


# Indicator definitions from the authors' code (tippnt_utils.py, calc_tipping_points.MCB.py), shown in the panel.
NOTES = {
    "caribbean_meandhw": "Degree heating weeks (DHW) measure accumulated thermal stress on corals. Sustained high water temperature causes corals to expel their symbiotic algae (bleaching), which can lead to coral death. The authors compute DHW from daily surface temperature as the 12-week running sum of the anomaly relative to a bleaching threshold: the maximum of the 1990–1999 monthly climatology plus 1 °C. They take the annual maximum and average it over ocean cells in the box. Unlike NOAA Coral Reef Watch's DHW, which accumulates only positive exceedances and treats 4 °C-weeks as the level at which significant bleaching is likely, this index also sums negative anomalies. It can therefore be negative, and its values aren't directly comparable to NOAA thresholds. Higher DHW is treated as increased tipping risk.",
    "Amazon_MCWD": "Monthly precipitation minus evapotranspiration over land, accumulated through each calendar year. The indicator is the annual minimum of this cumulative sum, in mm. Positive values mean no seasonal water deficit. Lower values mean a stronger dry-season deficit, which the authors treat as increased risk of Amazon rainforest dieback.",
    "Sahel_P": "Annual mean precipitation over land. The authors treat increased Sahel precipitation as increased risk for the Sahel / West African monsoon tipping element: a shift to a wetter, vegetated (\"greening\") state. Such a change may be beneficial locally.",
    "AMOC": "The annual mean of the maximum Atlantic meridional overturning streamfunction at 30°N, in sverdrups (1 Sv = 10⁶ m³/s). A weaker AMOC is treated as increased tipping risk.",
    "NAtl_HBLT": "The annual maximum of the monthly ocean mixed-layer (boundary-layer) depth, averaged over 45–60°N, 50–20°W. Shoaling, meaning weaker deep convection, is treated as increased risk of subpolar gyre convection collapse.",
    "Barents_MA_SIC": "Sea-ice area in late winter (March–April, as labelled in the authors' notebook). It is the area of ocean cells with more than 50% sea-ice concentration. Lower area is treated as increased tipping risk.",
    "Greenland_Ts": "Annual mean 2 m air temperature over land cells in 60–80°N, 60–20°W. Warming is treated as increased risk of Greenland Ice Sheet loss.",
    "NAmerica_PF_soilice": "Permafrost is diagnosed in the land model where the annual minimum soil ice at about 3.5 m depth is above zero, in the current or previous year. The indicator is the total area of such cells. Loss of area is treated as increased tipping risk.",
    "Amundsen_wind": "Annual mean surface zonal (westerly) wind over the ocean near the Amundsen Sea ice shelves. Stronger westerlies are treated as increased risk for the West Antarctic Ice Sheet, because they favour warm-water intrusion beneath the ice shelves.",
    "EastAntarctic_JetLat": "The latitude of the maximum annual mean surface zonal wind between 0° and 160°E. A poleward (more negative) shift is treated by the authors as increased tipping risk.",
}
NOTES["coralsea_meandhw"] = NOTES["westindian_meandhw"] = NOTES["caribbean_meandhw"]
NOTES["Eurasia_PF_soilice"] = NOTES["NAmerica_PF_soilice"]


def ensure_extracted(src):
    folder = src / "tipping_points"
    if not folder.exists():
        with zipfile.ZipFile(src / "tipping_points.zip") as z:
            z.extractall(src)
    return folder


def made_on(path):
    # File names end in the date the authors computed them, e.g. ...2015-2064.2023Mar03.nc
    return datetime.strptime(path.name.rsplit(".", 2)[-2], "%Y%b%d")


def series(folder, sub, case, key, var, period):
    # Some metrics were recomputed; the authors' notebook uses the newest version.
    files = sorted((folder / sub).glob(f"{case}.{key}.{period}.*.nc"), key=made_on)
    if not files:
        raise FileNotFoundError(f"{sub}/{case}.{key}.{period}: no file")
    with xr.open_dataset(files[-1]) as ds:
        da = ds[var].load()
    return da


def stack(das, years):
    # Some coral files start a year later; line every run up on the same years.
    return np.array([d.reindex(year=years).values for d in das], dtype=float)


def decade_mean(da, y1, y2):
    return float(da.sel(year=slice(y1, y2)).mean())


def rnd(x, sig=4):
    if x is None or not np.isfinite(x):
        return None
    return float(f"{x:.{sig}g}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SKETCH / "assets" / "hirasawa2023"))
    ap.add_argument("--out", default=str(SKETCH / "data" / "tipping.json"))
    args = ap.parse_args()

    folder = ensure_extracted(pathlib.Path(args.src))
    out = {
        "about": "Tipping-element metrics from CESM2 MCB simulations (Hirasawa et al. 2023, GRL, doi:10.1029/2023GL104314; data Zenodo 8384453, CC BY 4.0). Modelled. Decade means 2034-2043; baseline 1995-2014. Made by tools/make_tipping.py.",
        "period": [Y1, Y2],
        "baseline": [B1, B2],
        "metrics": [],
    }

    for key, var, name, measure, conv, unit, lat, lon, surface, toward in METRICS:
        hist = [decade_mean(series(folder, "cesm2ssp245", f"b.e21.BHISTsmbb.f09_g17.{m}", key, var, "1950-2014"), B1, B2) * conv for m in HIST_MEMBERS]
        ssp_da = [series(folder, "cesm2ssp245", f"b.e21.BSSP245smbb.f09_g17.{m}", key, var, "2015-2064") for m in SSP_MEMBERS]
        ssp = [decade_mean(d, Y1, Y2) * conv for d in ssp_da]
        t = stats.ttest_ind(ssp, hist, equal_var=True)

        years = list(range(2015, 2065))
        ssp_stack = stack(ssp_da, years) * conv

        entry = {
            "id": key,
            "name": name,
            "measure": measure,
            "note": NOTES.get(key, ""),
            "unit": unit,
            "box": {"lat": lat, "lon": lon},
            "surface": surface,
            "toward": toward,
            "hist": rnd(np.mean(hist)),
            "ssp": {
                "mean": rnd(np.mean(ssp)),
                "runs": [rnd(v) for v in ssp],
                "change": rnd(np.mean(ssp) - np.mean(hist)),
                "p": rnd(t.pvalue, 2),
            },
            "mcb": {},
            "series": {
                "years": years,
                "ssp_mean": [rnd(v) for v in np.nanmean(ssp_stack, 0)],
                "ssp_p05": [rnd(v) for v in np.nanpercentile(ssp_stack, 5, axis=0)],
                "ssp_p95": [rnd(v) for v in np.nanpercentile(ssp_stack, 95, axis=0)],
            },
        }
        for exp in EXPS:
            das = [series(folder, "mcb", f"b.e21.BSSP245smbb_MCB600cm_{exp}.f09_g17.LE2-{m}", key, var, "2015-2064") for m in MCB_MEMBERS]
            runs = [decade_mean(d, Y1, Y2) * conv for d in das]
            tt = stats.ttest_ind(runs, ssp, equal_var=True)
            effect = np.mean(runs) - np.mean(ssp)
            entry["mcb"][exp] = {
                "mean": rnd(np.mean(runs)),
                "runs": [rnd(v) for v in runs],
                "effect": rnd(effect),
                "p": rnd(tt.pvalue, 2),
            }
            entry["series"][exp] = [rnd(v) for v in np.nanmean(stack(das, years) * conv, 0)]
        out["metrics"].append(entry)
        e = entry
        print(f"{name:38s} hist {e['hist']:>10} ssp {e['ssp']['mean']:>10} (p {e['ssp']['p']})  " +
              "  ".join(f"{x}:{e['mcb'][x]['effect']:+.3g} (p {e['mcb'][x]['p']})" for x in EXPS))

    path = pathlib.Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
