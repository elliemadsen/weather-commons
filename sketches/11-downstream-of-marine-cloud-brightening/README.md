# 11 · Downstream of marine cloud brightening

Author: Ellie Madsen · Started: 2026-11-23 · Status: sketch · Stack: static HTML + JS, Python for data

In a climate model, brightening low clouds over one patch of ocean moves precipitation, warmth and sea ice far away, and which places gain or lose depends on where the clouds are brightened. The sketch is a single-screen web map of the modelled change in precipitation and temperature for three ocean regions. The 13 downstream tipping elements, from the Amazon and the Sahel to coral reefs, Arctic sea ice and the Atlantic overturning circulation, are boxes on the map. Select one to see what happens there.

## Run

Online, once published: `https://<github-username>.github.io/weather-commons/11-downstream-of-marine-cloud-brightening/`

On your computer:

```bash
cd sketches/11-downstream-of-marine-cloud-brightening
python -m http.server 8000
```

Then open http://localhost:8000. A view can be linked: `?exp=R3&var=TREFHT&place=Sahel_P` (regions `R1`, `R2`, `R3`, `R1R2R3`, `SSP`), and `#a-sources` opens the About window at a section.

### Rebuild the data

The page reads two small files in `data/`. To make them again from the original model output (about 3.5 GB, downloaded into `assets/`, which git ignores):

```bash
python3 tools/fetch_data.py     # downloads from Zenodo 8384453 and checks each file's checksum
python3 tools/make_maps.py      # data/maps.json: precipitation and temperature change maps
python3 tools/make_tipping.py   # data/tipping.json: the 13 tipping-element measures
```

The scripts need Python 3 with numpy, scipy, xarray and netCDF4.

## 1. Event

Marine cloud brightening (MCB) means spraying fine sea-salt particles into low clouds over the ocean, so they hold more, smaller droplets and reflect more sunlight. It's proposed to slow warming or to protect coral reefs, and has only been tested at small scale.

The event here is a model experiment: Hirasawa et al. (2023) brightened clouds in the CESM2 climate model in three ocean regions, alone and together, from 2015 to 2064 under SSP2-4.5. They then measured the effects far away. The question for this sketch is what happens downstream, and how that depends on where the brightening is done.

| Region | Box | Where |
| --- | --- | --- |
| NE Pacific (R1) | 0–30°N, 110–150°W | west of Mexico |
| SE Pacific (R2) | 30°S–0, 70–110°W | off Peru and northern Chile |
| SE Atlantic (R3) | 30°S–0, 25°W–15°E | off Angola and Namibia |

In each box, every low cloud over the ocean has its droplet number set to 600 per cm³ (from the authors' model code, `SourceMods.zip`).

## 2. Simulate

The page doesn't run a model. It shows what the authors' model calculated, summarised the same way as in their notebook.

- **Inputs:** monthly total precipitation, rain and snow (`PRECT`) and 2 m air temperature (`TREFHT`) from 3 runs of each MCB experiment. The comparison is the SSP2-4.5 ensemble mean (CESM2 Large Ensemble) and its decade-mean spread across 16 runs, plus the historical ensemble mean (1995–2014) and its spread across 50 runs. There are also yearly tipping-element measures for every run, made by the authors.
- **Period:** 2034–2043, the decade the authors chose. In their notebook it is the decade in which MCB in all three regions holds global temperature near its 1995–2014 level. Checked with this sketch's own maps (`tools/make_maps.py` prints global means):

  | 2034–2043 | Temperature | Precipitation |
  | --- | --- | --- |
  | Warming alone (vs 1995–2014) | +1.08 °C | +0.058 mm/day |
  | All three regions (vs no MCB) | −1.08 °C | −0.099 mm/day |
  | SE Pacific | −0.74 °C | −0.062 mm/day |
  | NE Pacific | −0.19 °C | −0.019 mm/day |
  | SE Atlantic | −0.02 °C | −0.022 mm/day |

  Brightening all three regions cancels the decade's warming but cuts global precipitation by more than warming adds.
- **Rule:** MCB effect = mean of 3 MCB runs minus mean without MCB. Warming alone = mean without MCB (2034–2043) minus the historical mean (1995–2014).
- **Uncertainty:** a two-sample t-test with pooled standard deviation, as in the notebook. The map shows cells with p ≥ 0.05 in lighter colours; the panel reports "no significant change" for indicators with p ≥ 0.05.
- **Resolution:** the model's own grid, 192 × 288 cells (about 0.94° × 1.25°), annual means. No interpolation. Missing years at the start of some coral series are left out.
- **Units:** precipitation in mm/day; temperature in °C; sea-ice and permafrost area in million km²; mixed-layer depth in cm (as in the paper); AMOC in sverdrups (Sv, million m³ of water per second).
- **Tipping-element indicators** are listed in `tools/make_tipping.py`, each with its box, its definition from the authors' code, and the sign of change the authors treat as increased tipping risk.

## 3. Situate

Not on the page yet. Candidate places are listed in NOTES.md.

## 4. Narrate

The page's About window has a short About section, Method, Limitations and Sources. What the model calculates and what it can't establish are under Limitations.

## Sources and limits

- **Model output, modelled.** Hirasawa, H., Hingmire, D., Singh, H., Rasch, P. J. and Mitra, P. (2023). "Effect of regional marine cloud brightening interventions on climate tipping elements." *Geophysical Research Letters* 50, e2023GL104314. https://doi.org/10.1029/2023GL104314. Data and code: Zenodo record 8384453, https://zenodo.org/records/8384453, published 2023-05-01, licence CC BY 4.0, downloaded 2026-11-23. CESM2 (CAM6) at f09_g17 resolution. Runs without MCB are from the CESM2 Large Ensemble (smbb members), included in the record.
- **What was changed:** the files were averaged over 2034–2043 (and 1995–2014), differenced, tested and rounded to hundredths for the maps (`tools/make_maps.py`). Tipping measures were decade-averaged and converted to the units above (`tools/make_tipping.py`). Where the record holds several versions of one measure, the newest by file date is used, following the authors' notebook. Nothing else was changed.
- **Coastlines, cartographic:** the model's land fraction (> 0.5), from `cam_gridinfo.nc` in the same record.
- **Colours:** the paper's figure scales, RdBu (temperature) and BrBG (precipitation), from ColorBrewer.
- **Interpretive:** the wording of each tipping element's result sentence, and the drifting cloud drawn over brightened regions (decoration, not model output).

What this sketch can't show:

- It shows one model. Other models may respond differently. Jones, Haywood and Boucher (2009, JGR) also found that South Atlantic brightening dried the Amazon, in the Met Office model.
- Setting droplet numbers is an idealisation. Real spraying might brighten clouds less, or even darken them (Feingold et al. 2024, *Science Advances*, to read).
- Three runs per experiment only partly separate the effect from natural variability.
- Fixed boxes held for 50 years don't resemble any real plan, with its seasons, stops and starts.
- "Increased risk" is the sign of change the authors associate with tipping risk for each indicator. It doesn't mean a threshold is crossed, and it doesn't quantify impacts on people or ecosystems.
- Nothing here shows harm to any person or place.
