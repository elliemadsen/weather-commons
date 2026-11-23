# Notes

Working notes for sketch 11. Read this first. Date each entry, and move items to Done when they ship.

## Next

- Places, if wanted on the page: the seeded boxes, the Amazon, the Sahel, the Great Barrier Reef trials, the Alameda test (2024, to check), and NCAR.
- Second view: Chen (2024, Zenodo 10961156), five "susceptibility" seeding strategies with monthly masks. One run each, 2035–2069.
- Multi-model check: Wang et al. (2026, Zenodo 23889423), monsoon metrics for four models under GeoMIP G6-1.5K-MCB. Small CSVs.
- Literature review and wider plan: `~/Documents/mcb-precipitation-lit-review-and-plan.md`. Move the useful parts here or into the README.

## Decisions

- 2026-11-23: map restyle. The map is cropped to 84°N–80°S (every tipping element and the Antarctic coast fit), with a faint 30° grid and no degree labels, under thinner coastlines. Tipping-element outlines are black, softened into a white halo (`HALO` in `app.js`): thickest for increased risk, thinnest for reduced risk (dashed and dotted lines were tried and dropped). The hovered or selected element is yellow (`#ffd400`), in neither colour scale, with a thin dark halo; its name sits on a yellow tab above the box, and the others fade while one is selected. In the panel its name has a thick yellow underline. Brightened regions keep the white band and grey-blue glow and are filled with soft cloud drifting slowly westward: blurred puffs only, white to very light grey, gathered in flattened clusters that vary in density, spread, size and opacity, in two layers at different speeds (`FOG_LAYERS` in `app.js`; still for people who ask their system for reduced motion). The particles are decoration for the brightened region, not model output, with their name (no "Brightened:") on a small white tab just below the box, outside its glow, shrunk to be no wider than the box (left out when it would be too small to read, as on phones). The panel's groups carry the same line samples as the legend. This supersedes the outline and selection colours below.
- 2026-11-23: no hatching; non-significant cells are shown only in lighter colours. The panel shows the result sentence, the four-region table and the indicator definition. The number line and the 2015–2064 chart were removed for now (the yearly series are still in `data/tipping.json`). Brightened regions are white bands with a soft grey-blue glow. Tipping elements are outlined by a lightly blurred grey line that fades into a soft white halo on both sides: thickest and darkest for increased risk, medium for no significant change, thinnest and lightest for reduced risk. The hovered or selected one glows green. Colours are set once, in `index.html` (`--tipping-increased`, `--tipping-unclear`, `--tipping-reduced`, `--sel-map`, `--sel-map-text`, `--sel`, `--brightened-edge`). The legend has two rows: the brightened region and the colour scale, then tipping risk (increased, no significant change, reduced). References are checked against Crossref.

- 2026-11-23: page language follows the paper's terms: MCB, tipping elements and indicators, increased or reduced tipping risk, no significant change, ensemble members, SSP2-4.5. Indicator definitions come from the authors' code (`tippnt_utils.py`). Mixed-layer depth is in cm, as in the paper. The About window has About, Method, Limitations and Sources (Data, References).

- 2026-11-23: on the page: no tag boxes, no start date or "(with Claude)" in the footer, and the site header hides until you scroll up or move the pointer to the top. Brightened regions have a white band with black edges; tipping elements have plain black outlines (solid, dashed or dotted). "Precipitation" replaces "rainfall", because PRECT is rain and snow together.
- 2026-11-23: use Hirasawa et al. (2023), Zenodo 8384453, as the main source. It has raw monthly output for three separate regions plus the authors' tipping-element measures. Xing et al. (2025) has code only; its data is on NCAR systems.
- 2026-11-23: follow the authors' notebook exactly: decade 2034–2043, baseline 1995–2014, pooled t-test, p < 0.05.
- 2026-11-23: colour only in the map, using the paper's scales (BrBG precipitation, RdBu temperature) as "source colours of scientific imagery". Everything else is black and white. The map keeps a light surface in dark mode.
- 2026-11-23: coastlines come from the model's own land mask, not an outside basemap, so the page shows the world as the model sees it.
- 2026-11-23: layout is a single-screen web map, not a scrolling page. The downstream places are selectable boxes whose outline shows the result (line weight by result, see below); the selected element is magenta. Details open in a side panel, below the map on phones. The About window has About, Method, Limitations and Sources.
- 2026-11-23: raw files stay in `assets/` (git-ignored), rebuilt with `tools/fetch_data.py`. There's no Box access on this computer, so `assets.json` has no items.

## Questions

- Small boxes (the Amundsen Sea wind box, the Caribbean) are hard to tap on phones. Their names in the overview panel work as a fallback. Is that enough?
- The sketch number 11 was chosen without a facilitator. Confirm it before opening a pull request to the shared site.
- Is the map's colour acceptable in the shared look?
- The Sahel: the authors count wetter as increased risk ("greening"). How should the page talk about a change that may be welcome locally?
- Check the field-test facts (Great Barrier Reef trials, Alameda 2024) before Situate.

## Done

- 2026-11-23: started from the template.
- 2026-11-23: first version. Map of rainfall and temperature change for each region, a ledger of 13 tipping elements, a year-by-year chart, and Sources and limits. Views can be linked with `?exp=R3&var=TREFHT&place=Sahel_P` (`var=NONE` shows only land, coastlines and boxes).
- 2026-11-23: checked the authors' decade. All three regions give −1.08 °C, against +1.08 °C of warming. SE Atlantic alone cools the globe by only 0.02 °C but dries the Amazon (MCWD −73 mm, p < 0.001). `check-sketches` and `check-sizes` pass. The page fits a 390 px phone screen.
- 2026-11-23: `tools/fetch_data.py` now resumes interrupted downloads, times out silent connections after 60 s and downloads in parallel. Zenodo was slow and the connection dropped several times.
