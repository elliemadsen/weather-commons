// Downstream of marine cloud brightening: a single-screen web map.
// Data: data/maps.json and data/tipping.json, made by the scripts in tools/ from Hirasawa et al. (2023).

const EXPS = {
  R1: { name: 'NE Pacific', where: 'in the NE Pacific', subject: 'MCB in the NE Pacific', boxes: [{ lat: [0, 30], lon: [-150, -110], label: 'NE Pacific' }] },
  R2: { name: 'SE Pacific', where: 'in the SE Pacific', subject: 'MCB in the SE Pacific', boxes: [{ lat: [-30, 0], lon: [-110, -70], label: 'SE Pacific' }] },
  R3: { name: 'SE Atlantic', where: 'in the SE Atlantic', subject: 'MCB in the SE Atlantic', boxes: [{ lat: [-30, 0], lon: [-25, 15], label: 'SE Atlantic' }] },
  R1R2R3: { name: 'All three', where: 'in all three regions', subject: 'MCB in all three regions', boxes: [] },
  SSP: { name: 'None (warming alone)', where: 'nowhere', subject: 'SSP2-4.5 warming without MCB', boxes: [] },
};
EXPS.R1R2R3.boxes = [...EXPS.R1.boxes, ...EXPS.R2.boxes, ...EXPS.R3.boxes];
const MCB_EXPS = ['R1', 'R2', 'R3', 'R1R2R3'];

// Colour scales from the paper's figures (ColorBrewer, 11 classes). Negative first.
const SCALES = {
  PRECT: {
    label: 'Precipitation change', unit: 'mm/day', step: 0.25,
    colors: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'],
  },
  TREFHT: {
    label: 'Temperature change', unit: '°C', step: 0.5,
    colors: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'],
  },
};

// Outline style for tipping elements, by the sign of the change in tipping risk (the paper's terms).
const STYLES = {
  // A soft black line in a white halo: thickest for increased risk, thinnest for reduced risk.
  // Colours are set in index.html (--tipping-increased, --tipping-unclear, --tipping-reduced).
  toward: { width: 3.5, blur: 1, color: getComputedStyle(document.documentElement).getPropertyValue('--tipping-increased').trim() || '#000', word: 'Increased risk', verb: 'increases the tipping risk for' },
  unclear: { width: 2.5, blur: 0.9, color: getComputedStyle(document.documentElement).getPropertyValue('--tipping-unclear').trim() || '#000', word: 'No significant change', verb: 'has no significant effect on the tipping risk for' },
  away: { width: 1.6, blur: 0.8, color: getComputedStyle(document.documentElement).getPropertyValue('--tipping-reduced').trim() || '#000', word: 'Reduced risk', verb: 'reduces the tipping risk for' },
};
// Highlight colour for the hovered or selected tipping element. Set it in index.html (--sel-map).
const SEL = getComputedStyle(document.documentElement).getPropertyValue('--sel-map').trim() || '#ffd400';
// Edge colour of the white band around brightened regions. Set it in index.html (--brightened-edge).
const EDGE = getComputedStyle(document.documentElement).getPropertyValue('--brightened-edge').trim() || '#5f7590';
const EDGE_TEXT = getComputedStyle(document.documentElement).getPropertyValue('--brightened-text').trim() || '#2f4057';

const state = { exp: 'R1R2R3', variable: 'PRECT', place: null, hover: null };
const params = new URLSearchParams(location.search);
if (params.get('exp') in EXPS) state.exp = params.get('exp');
if (params.get('var') in SCALES || params.get('var') === 'NONE') state.variable = params.get('var');
if (params.get('place')) state.place = params.get('place');

let MAPS, TIP, grid;
const canvas = document.getElementById('map');
const vctx = canvas.getContext('2d'); // what you see: map cells, fog and the overlay, put together in composite()
const overlay = document.createElement('canvas'); // outlines and labels, redrawn only when the view changes
const ctx = overlay.getContext('2d');
const base = document.createElement('canvas'); // cells and coastlines, redrawn only when the view changes
const bctx = base.getContext('2d');
let W = 1200, H = 600, DPR = 1;
const LON0 = 59.375; // left edge of the map, on a grid-cell edge; keeps every box in one piece
// The map is cropped to 84°N–80°S: every tipping element and the Antarctic coast fit, the empty polar bands don't.
const LAT_N = 84, LAT_S = -80, SPAN = LAT_N - LAT_S;

const xOf = (lon) => ((((lon - LON0) % 360) + 360) % 360) / 360 * W;
const yOf = (lat) => (LAT_N - lat) / SPAN * H;

// ---------- numbers ----------

function fmt(v, digits = 3) {
  if (v == null || !isFinite(v)) return '–';
  const a = Math.abs(v);
  const s = (a !== 0 && (a >= 1e4 || a < 1e-3)) ? v.toExponential(1)
    : Number(v.toPrecision(digits)).toLocaleString('en', { maximumFractionDigits: 3 });
  return s.replace('-', '−');
}
const signed = (v, d) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d);
const pText = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${fmt(p, 2)}`);
const latText = (lat) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
const lonText = (lon) => { const l = ((lon + 540) % 360) - 180; return `${Math.abs(l).toFixed(1)}°${l >= 0 ? 'E' : 'W'}`; };
const boxText = (b) => `${latText(b.lat[0]).replace('.0', '')}–${latText(b.lat[1]).replace('.0', '')}, ${lonText(b.lon[0]).replace('.0', '')}–${lonText(b.lon[1]).replace('.0', '')}`;

function result(m, exp = state.exp) {
  const e = exp === 'SSP' ? { effect: m.ssp.change, p: m.ssp.p } : m.mcb[exp];
  const kind = e.p >= 0.05 ? 'unclear' : Math.sign(e.effect) === m.toward ? 'toward' : 'away';
  return { kind, ...e };
}

// ---------- map ----------

function buildGrid() {
  const lat = MAPS.lat, lon = MAPS.lon, nlat = lat.length, nlon = lon.length;
  const latEdge = [-90];
  for (let i = 1; i < nlat; i++) latEdge.push((lat[i - 1] + lat[i]) / 2);
  latEdge.push(90);
  const dlon = 360 / nlon;
  const isLand = (i, j) => MAPS.land[i * nlon + (((j % nlon) + nlon) % nlon)] === '1';
  const segs = [];
  for (let i = 0; i < nlat; i++) {
    for (let j = 0; j < nlon; j++) {
      const here = isLand(i, j);
      if (here !== isLand(i, j + 1)) { const lo = lon[j] + dlon / 2; segs.push([lo, latEdge[i], lo, latEdge[i + 1]]); }
      if (i + 1 < nlat && here !== isLand(i + 1, j)) { const la = latEdge[i + 1]; segs.push([lon[j] - dlon / 2, la, lon[j] + dlon / 2, la]); }
    }
  }
  grid = { lat, lon, nlat, nlon, latEdge, dlon, isLand, segs };
}

const classOf = (v, step) => Math.max(-5, Math.min(5, Math.round(v / step))) + 5;

function mix(hex, toward, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toward.slice(1), 16);
  const m = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

function cellRect(i, j) {
  const { lon, latEdge, dlon } = grid;
  const y0 = yOf(latEdge[i + 1]), y1 = yOf(latEdge[i]);
  return [xOf(lon[j] - dlon / 2), y0, dlon / 360 * W + 0.6, y1 - y0 + 0.6];
}

function drawBase() {
  base.width = canvas.width; base.height = canvas.height;
  bctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, W, H);
  const sc = SCALES[state.variable];
  if (!sc) { // Variable: None. Only the model's land grid, in light grey.
    bctx.fillStyle = '#e6e6e6';
    for (let i = 0; i < grid.nlat; i++) for (let j = 0; j < grid.nlon; j++) if (grid.isLand(i, j)) bctx.fillRect(...cellRect(i, j));
  }
  const field = sc ? MAPS.vars[state.variable].fields[state.exp] : null;
  const buckets = new Map();
  if (sc) {
  for (let i = 0; i < grid.nlat; i++) {
    for (let j = 0; j < grid.nlon; j++) {
      const k = i * grid.nlon + j;
      const key = classOf(field.v[k] * MAPS.scale, sc.step) * 2 + (field.sig[k] === '1' ? 1 : 0);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push([i, j]);
    }
  }
  for (const [key, cells] of buckets) {
    bctx.fillStyle = key & 1 ? sc.colors[key >> 1] : mix(sc.colors[key >> 1], '#f2f2f2', 0.55);
    for (const [i, j] of cells) bctx.fillRect(...cellRect(i, j));
  }
  }
  drawGraticule(bctx);
  buildFog();
  bctx.strokeStyle = 'rgba(0,0,0,0.8)'; bctx.lineWidth = 0.7; bctx.beginPath();
  for (const [lo0, la0, lo1, la1] of grid.segs) {
    const x0 = xOf(lo0), x1 = xOf(lo1);
    if (Math.abs(x1 - x0) > W / 2) continue;
    bctx.moveTo(x0, yOf(la0)); bctx.lineTo(x1, yOf(la1));
  }
  bctx.stroke();
}

// Faint lines every 30°.
// Cloud over each brightened region: soft white to light grey puffs gathered in flattened clusters, drifting
// slowly westward with the trade winds. Each region has two layers that move at different speeds, for depth.
// Each layer is drawn once into a small tile; animation only slides the tiles, so it stays cheap.
// The pattern comes from a seeded random sequence, so it is the same on every redraw.
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOG_LAYERS = [
  { speed: 2.5, size: 1.25, alpha: [0.18, 0.42] },  // far: larger, fainter, slower (px per second)
  { speed: 4.5, size: 0.85, alpha: [0.28, 0.6] },   // near: smaller, a little stronger, faster
];
let fog = [];
function buildFog() {
  const k = Math.max(0.7, Math.min(1.3, W / 1000)); // scales sizes with the map
  fog = EXPS[state.exp].boxes.map((b) => {
    const [x, y, w, h] = boxRect(b);
    let seed = [...b.label].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
    const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(6.2832 * rand());
    // A soft round puff: strongest in the middle, fading to nothing at the edge.
    const puff = (c, px, py, r, a, rgb) => {
      for (const dx of [-w, 0, w]) { // drawn three times, so the tile wraps without a seam
        const g = c.createRadialGradient(px + dx, py, 0, px + dx, py, r);
        g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(0.5, `rgba(${rgb},${a * 0.8})`); g.addColorStop(1, `rgba(${rgb},0)`);
        c.fillStyle = g; c.beginPath(); c.arc(px + dx, py, r, 0, Math.PI * 2); c.fill();
      }
    };
    const layers = FOG_LAYERS.map((L) => {
      const tile = document.createElement('canvas');
      tile.width = Math.ceil(w * DPR); tile.height = Math.ceil(h * DPR);
      const c = tile.getContext('2d');
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      // Clusters of puffs, flattened like rows of low cloud. Each has its own density, spread and shade.
      const nc = Math.max(3, Math.round(w * h / (1000 * k * k)));
      for (let j = 0; j < nc; j++) {
        const cx = rand() * w, cy = rand() * h;
        const sx = (5 + rand() * 16) * k, sy = sx * (0.3 + rand() * 0.3);
        const m = 4 + Math.floor(rand() * rand() * 22);           // a few sparse wisps, some dense clumps
        const grey = 255 - Math.floor(rand() * rand() * 70);       // mostly white, some very light grey
        const dense = 0.7 + rand() * 0.6;                          // some clusters stronger than others
        for (let i = 0; i < m; i++) {
          const r = (2.5 + rand() * rand() * 12) * k * L.size;     // mostly small puffs, a few large
          const a = Math.min(0.75, (L.alpha[0] + rand() * (L.alpha[1] - L.alpha[0])) * dense);
          const g = Math.max(180, grey - Math.floor(rand() * 12));
          puff(c, ((cx + gauss() * sx) % w + w) % w, cy + gauss() * sy, r, a.toFixed(3), `${g},${Math.min(255, g + 2)},${Math.min(255, g + 5)}`);
        }
      }
      return { tile, speed: REDUCED_MOTION ? 0 : L.speed, phase: rand() * 6.28 };
    });
    return { x, y, w, h, layers };
  });
}

// Puts the frame together: map cells, then fog, then outlines and labels.
function composite(t) {
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.drawImage(base, 0, 0);
  for (const f of fog) {
    vctx.save();
    vctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    vctx.beginPath(); vctx.rect(f.x + 3, f.y + 3, f.w - 6, f.h - 6); vctx.clip();
    for (const L of f.layers) {
      const off = (t / 1000 * L.speed) % f.w;
      const bob = L.speed ? Math.sin(t / 4000 + L.phase) * 1.2 : 0; // a slight rise and fall
      vctx.drawImage(L.tile, f.x - off, f.y + bob, f.w, f.h);
      vctx.drawImage(L.tile, f.x - off + f.w, f.y + bob, f.w, f.h);
    }
    vctx.restore();
  }
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.drawImage(overlay, 0, 0);
}
let raf = null, lastFrame = 0;
function tick(t) {
  raf = null;
  if (t - lastFrame >= 33) { composite(t); lastFrame = t; } // about 30 frames a second is plenty for slow fog
  if (fog.length && !REDUCED_MOTION) raf = requestAnimationFrame(tick);
}
function startFog() { if (!raf && fog.length && !REDUCED_MOTION) raf = requestAnimationFrame(tick); }

function drawGraticule(c) {
  c.save();
  c.lineWidth = 0.5; c.strokeStyle = 'rgba(0,0,0,0.13)'; c.beginPath();
  for (let la = -60; la <= 60; la += 30) { const y = Math.round(yOf(la)) + 0.25; c.moveTo(0, y); c.lineTo(W, y); }
  for (let lo = -180; lo < 180; lo += 30) { const x = Math.round(xOf(lo)) + 0.25; c.moveTo(x, 0); c.lineTo(x, H); }
  c.stroke();
  c.restore();
}

function boxRect(b) {
  let x0 = xOf(b.lon[0]), x1 = xOf(b.lon[1]);
  if (x1 <= x0) x1 += W;
  return [x0, yOf(b.lat[1]), x1 - x0, yOf(b.lat[0]) - yOf(b.lat[1])];
}

function label(text, x, y, bold = true, color = '#000', size = 13) {
  ctx.save();
  ctx.font = `${bold ? 600 : 400} ${W < 700 ? size - 2 : size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  x = Math.max(3, Math.min(W - w - 3, x));
  ctx.lineWidth = size < 13 ? 2 : 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineJoin = 'round'; ctx.fillStyle = color;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  ctx.restore();
}

// A rectangle drawn only as a blurred glow, with no crisp line. The stroke is drawn far off the canvas,
// and its shadow is offset back into place; repeating it makes the glow stronger.
// The halo is white for tipping elements; the highlight gets a dark one, so yellow holds on pale cells.
const HALO = { color: 'rgba(255,255,255,0.8)', extra: 4, blur: 1.5 };
// dash: solid, dashed or dotted line (the halo stays continuous); cap 'round' turns zero-length dashes into dots.
function fuzzyRect(x, y, w, h, color, width, blur, times = 1, halo = HALO, dash = [], cap = 'butt') {
  const off = 10000;
  const glow = (c, lw, bl, n, d = []) => {
    ctx.save();
    ctx.lineWidth = lw; ctx.strokeStyle = '#000'; ctx.setLineDash(d); ctx.lineCap = cap;
    ctx.shadowColor = c; ctx.shadowBlur = bl * DPR; ctx.shadowOffsetX = off * DPR;
    for (let i = 0; i < n; i++) ctx.strokeRect(x - off, y, w, h);
    ctx.restore();
  };
  glow(halo.color, width + halo.extra, blur + halo.blur, 1); // a soft halo underneath, on both sides
  glow(color, width, blur, times, dash);                      // the black (or highlight) line, blurring into it
}

function drawMap() {
  if (!MAPS) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const labels = [];
  if (TIP) {
    for (const m of TIP.metrics) {
      const st = STYLES[result(m).kind];
      const [x, y, w, h] = boxRect(m.box);
      const active = m.id === state.place || m.id === state.hover;
      if (active) continue; // drawn last, on top
      ctx.save();
      if (state.place) ctx.globalAlpha = 0.45; // with one element selected, the others step back
      fuzzyRect(x, y, w, h, st.color, st.width, st.blur, 2, HALO, st.dash, st.cap);
      ctx.restore();
    }
  }
  const brightLabels = [];
  for (const b of EXPS[state.exp].boxes) {
    const [x, y, w, h] = boxRect(b);
    ctx.save(); // a white band with a soft grey-blue glow, unlike the grey outlines of tipping elements
    // The glow shows only outside the box: everything inside the band's inner edge is clipped away.
    ctx.beginPath(); ctx.rect(-10, -10, W + 20, H + 20); ctx.rect(x + 2.25, y + 2.25, w - 4.5, h - 4.5); ctx.clip('evenodd');
    ctx.shadowColor = EDGE; ctx.shadowBlur = 6 * DPR;
    ctx.lineWidth = 4.5; ctx.strokeStyle = '#fff';
    for (let i = 0; i < 3; i++) ctx.strokeRect(x, y, w, h); // three times, for a glow that holds on pale cells
    ctx.shadowBlur = 0; ctx.strokeRect(x, y, w, h);
    ctx.restore();
    brightLabels.push([b.label, x, y, w, h]);
  }
  // The hovered or selected tipping element goes on top of everything, in its own colour.
  if (TIP) for (const m of TIP.metrics) {
    if (m.id !== state.place && m.id !== state.hover) continue;
    const [x, y, w, h] = boxRect(m.box);
    fuzzyRect(x, y, w, h, SEL, 3.5, 0.9, 2, { color: 'rgba(0,0,0,0.4)', extra: 1, blur: 0.6 });
    labels.push([m.name, x, y, h]);
  }
  // Each brightened region's name sits on a small white tab just below the box, outside its glow, at the left.
  // The text shrinks until the tab is no wider than the box; if it would be too small to read, it is left out.
  for (const [text, x, y, w, h] of brightLabels) {
    ctx.save();
    let size = 11, tw;
    for (; size >= 7; size -= 0.5) {
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      tw = ctx.measureText(text).width;
      if (tw + 8 <= w) break;
    }
    if (size >= 7) {
      const th = Math.round(size * 1.5);
      const ty = y + h + 7;
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 2.25, ty, tw + 8, th);
      ctx.fillStyle = EDGE_TEXT; ctx.fillText(text, x + 1.75, ty + th - Math.round(size * 0.45));
    }
    ctx.restore();
  }
  // The hovered or selected element's name, on a yellow tab above its box (below it near the top edge).
  for (const [text, x0, y, h] of labels) {
    ctx.save();
    const size = W < 700 ? 11 : 12;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width, th = Math.round(size * 1.6);
    const x = Math.max(1, Math.min(W - tw - 11, x0 - 2));
    const ty = y - th - 4 >= 0 ? y - th - 4 : y + h + 4;
    ctx.fillStyle = SEL; ctx.fillRect(x, ty, tw + 10, th);
    ctx.fillStyle = '#000'; ctx.fillText(text, x + 5, ty + th - Math.round(size * 0.45));
    ctx.restore();
  }
  composite(performance.now());
  startFog();
}

function resize() {
  DPR = window.devicePixelRatio || 1;
  W = canvas.clientWidth; H = W * SPAN / 360;
  canvas.width = overlay.width = Math.round(W * DPR); canvas.height = overlay.height = Math.round(H * DPR);
  if (MAPS) { drawBase(); drawMap(); }
}
new ResizeObserver(resize).observe(canvas);

// A short sample of a tipping-element outline, for the legend and the panel.
const dashAttr = (st) => (st.dash && st.dash.length ? ` stroke-dasharray="${st.dash.join(' ')}"` : '') + (st.cap ? ` stroke-linecap="${st.cap}"` : '');
function lineSample(st, k) {
  return `<svg width="30" height="16" aria-hidden="true"><defs>` +
    `<filter id="tw${k}" filterUnits="userSpaceOnUse" x="0" y="0" width="30" height="16"><feGaussianBlur stdDeviation="${(st.blur + HALO.blur) / 2.5}"/></filter>` +
    `<filter id="tb${k}" filterUnits="userSpaceOnUse" x="0" y="0" width="30" height="16"><feGaussianBlur stdDeviation="${st.blur / 2.5}"/></filter></defs>` +
    `<line x1="4" y1="8" x2="26" y2="8" stroke="#fff" stroke-opacity=".8" stroke-width="${st.width + HALO.extra}" filter="url(#tw${k})"/>` +
    `<line x1="4" y1="8" x2="26" y2="8" stroke="${st.color}" stroke-width="${st.width}"${dashAttr(st)} filter="url(#tb${k})"/>` +
    `<line x1="4" y1="8" x2="26" y2="8" stroke="${st.color}" stroke-width="${st.width}"${dashAttr(st)} filter="url(#tb${k})"/></svg>`;
}

function drawLegend() {
  const sc = SCALES[state.variable];
  let cells = '', ticks = '';
  if (sc) {
    const n = sc.colors.length, half = (n - 1) / 2;
    sc.colors.forEach((c, k) => { cells += `<i style="background:${c};grid-row:1;grid-column:${k + 1}"></i>`; });
    for (let k = 1; k < n; k += 2) ticks += `<b style="grid-column:${k + 1}">${signed((k - half) * sc.step, 2)}</b>`;
  }
  const line = lineSample;
  const band = `<svg width="30" height="18" aria-hidden="true"><defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1"/></filter></defs>` +
    `<rect x="4.5" y="4.5" width="21" height="9" fill="none" stroke="${EDGE}" stroke-width="3.5" filter="url(#glow)"/>` +
    `<rect x="4.5" y="4.5" width="21" height="9" fill="none" stroke="#fff" stroke-width="3"/>` +
    [[9.5, 8.2], [15, 10.6], [20.5, 8]].map(([cx, cy]) =>
      `<circle cx="${cx}" cy="${cy}" r=".9" fill="#fff" stroke="${EDGE}" stroke-width=".5"/>`).join('') + `</svg>`;
  // A tipping-element box, drawn like the map's outlines: a soft dark grey line in a white halo.
  const st = { ...STYLES.toward, width: 2 };
  const tbox = `<svg width="30" height="18" aria-hidden="true"><defs>` +
    `<filter id="tbw" filterUnits="userSpaceOnUse" x="0" y="0" width="30" height="18"><feGaussianBlur stdDeviation="${(st.blur + HALO.blur) / 2.5}"/></filter>` +
    `<filter id="tbg" filterUnits="userSpaceOnUse" x="0" y="0" width="30" height="18"><feGaussianBlur stdDeviation="${st.blur / 2.5}"/></filter></defs>` +
    `<rect x="4.5" y="4.5" width="21" height="9" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="${st.width + HALO.extra}" filter="url(#tbw)"/>` +
    `<rect x="4.5" y="4.5" width="21" height="9" fill="none" stroke="${st.color}" stroke-width="${st.width}" filter="url(#tbg)"/></svg>`;
  document.getElementById('legend').innerHTML =
    `<div class="row scale"><span class="brightened"><span>${band}brightened region</span><span>${tbox}tipping element</span></span>` +
    (sc ? `<span class="scalelabel">${sc.label}, ${sc.unit}</span><span class="bar" aria-hidden="true">${cells}${ticks}</span>` : '') + `</div>` +
    `<div class="row tipping"><span>Tipping risk:</span><span>${line(STYLES.toward, 1)}increased</span>` +
    `<span>${line(STYLES.unclear, 2)}no significant change</span><span>${line(STYLES.away, 3)}reduced</span></div>`;
}

// ---------- pointer ----------

function pointAt(evt) {
  const r = canvas.getBoundingClientRect();
  const x = (evt.clientX - r.left) / r.width * W, y = (evt.clientY - r.top) / r.height * H;
  return { x, y, lat: LAT_N - y / H * SPAN, lon: (LON0 + x / W * 360) % 360 };
}

function placeAt(x, y) {
  if (!TIP) return null;
  const pad = 6; // small boxes get a slightly larger target
  let best = null, area = Infinity;
  for (const m of TIP.metrics) {
    const [bx, by, bw, bh] = boxRect(m.box);
    const px = Math.max(0, (14 - bw) / 2) + pad / 2, py = Math.max(0, (14 - bh) / 2) + pad / 2;
    if (x >= bx - px && x <= bx + bw + px && y >= by - py && y <= by + bh + py && bw * bh < area) { best = m; area = bw * bh; }
  }
  return best;
}

// The readout has fixed columns, so nothing shifts as values change.
function setReadout(cols) {
  document.getElementById('readout').innerHTML = cols.map((c) => `<span>${c}</span>`).join('');
}

canvas.addEventListener('mousemove', (evt) => {
  if (!MAPS) return;
  const { x, y, lat, lon } = pointAt(evt);
  const j = Math.round(lon / grid.dlon) % grid.nlon;
  let i = grid.latEdge.findIndex((e) => e > lat) - 1;
  if (i < 0) i = grid.nlat - 1;
  const k = i * grid.nlon + j;
  const sc = SCALES[state.variable];
  const f = sc ? MAPS.vars[state.variable].fields[state.exp] : null;
  const place = placeAt(x, y);
  canvas.classList.toggle('over-place', !!place);
  if ((place && place.id) !== state.hover) { state.hover = place ? place.id : null; drawMap(); }
  setReadout([latText(lat), lonText(lon), grid.isLand(i, j) ? 'Land' : 'Ocean',
    f ? `${signed(f.v[k] * MAPS.scale, 2)}\u00a0${sc.unit}` : '',
    f ? (f.sig[k] === '1' ? 'Significant (p < 0.05)' : 'Not significant (p ≥ 0.05)') : '']);
});
canvas.addEventListener('mouseleave', () => {
  state.hover = null; canvas.classList.remove('over-place'); drawMap();
  setReadout(['', '', '', '', '']);
});
canvas.addEventListener('click', (evt) => {
  const { x, y } = pointAt(evt);
  const place = placeAt(x, y);
  if (place) select(place.id);
});

// ---------- panel ----------

const panel = document.getElementById('panel');

function select(id) {
  state.place = id;
  syncURL(); drawMap(); renderPanel();
  if (id && window.matchMedia('(max-width: 900px)').matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPanel() {
  const m = TIP && state.place ? TIP.metrics.find((x) => x.id === state.place) : null;
  if (!TIP) { panel.innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (m) renderPlace(m); else renderOverview();
}

function renderOverview() {
  const groups = { toward: [], away: [], unclear: [] };
  for (const m of TIP.metrics) groups[result(m).kind].push(m);
  const who = state.exp === 'SSP'
    ? 'Change in 13 tipping-element indicators, SSP2-4.5 2034–2043 relative to 1995–2014, without MCB:'
    : `Change in 13 tipping-element indicators, 2034–2043, relative to SSP2-4.5 without MCB:`;
  // The comma stays with its name, so a line never starts with one.
  const list = (ms) => (ms.length ? ms.map((m, k) => `<span class="nw"><button type="button" data-place="${m.id}">${m.name}</button>${k < ms.length - 1 ? ',' : ''}</span>`).join(' ') : 'none');
  panel.innerHTML =
    `<h2>${EXPS[state.exp].subject}</h2>` +
    `<p>${who}</p>` +
    `<div class="groups">` +
    `<p>${lineSample(STYLES.toward, 'p1')}<strong>Increased risk (${groups.toward.length}):</strong> ${list(groups.toward)}</p>` +
    `<p>${lineSample(STYLES.away, 'p3')}<strong>Reduced risk (${groups.away.length}):</strong> ${list(groups.away)}</p>` +
    `<p>${lineSample(STYLES.unclear, 'p2')}<strong>No significant change (${groups.unclear.length}):</strong> ${list(groups.unclear)}</p>` +
    `</div>`;
}

function renderPlace(m) {
  const r = result(m);
  const vs = state.exp === 'SSP' ? 'relative to 1995–2014' : 'relative to SSP2-4.5 without MCB';
  const rows = MCB_EXPS.map((e) => {
    const x = result(m, e);
    return `<tr class="${e === state.exp ? 'current' : ''}"><td><button type="button" data-exp-switch="${e}">${EXPS[e].name}</button></td>` +
      `<td>${STYLES[x.kind].word}</td><td>${signed(x.effect)}\u00a0${m.unit}</td></tr>`;
  }).join('');
  const ww = result(m, 'SSP');
  panel.innerHTML =
    `<button type="button" class="plain close" id="closeplace" aria-label="Back to the overview">Back</button>` +
    `<h2>Tipping element</h2><h3 class="sel">${m.name}</h3>` +
    `<p class="ms"><strong>Tipping point indicator:</strong> ${/^March/.test(m.measure) ? m.measure : m.measure.charAt(0).toLowerCase() + m.measure.slice(1)}, averaged over ${m.surface} cells in ${boxText(m.box)}.</p>` +
    `<p class="verdict">${EXPS[state.exp].subject} ${STYLES[r.kind].verb} the ${m.name}.</p>` +
    `<p>${signed(r.effect)}\u00a0${m.unit} ${vs}, 2034–2043 (${pText(r.p)}).` +
    (state.exp === 'SSP' ? '' : ` SSP2-4.5 warming alone: ${signed(ww.effect)}\u00a0${m.unit} relative to 1995–2014.`) + `</p>` +
    `<table><thead><tr><th>Brightened region</th><th>Tipping risk</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>` +
    (m.note ? `<p class="small"><strong>About the indicator:</strong> ${m.note}</p>` : '') +
    `<p class="small muted">Model output: CESM2, Hirasawa et al. (2023).</p>`;
}

panel.addEventListener('click', (evt) => {
  const t = evt.target;
  if (t.closest('#closeplace')) { select(null); return; }
  const p = t.closest('[data-place]'); if (p) { select(p.dataset.place); return; }
  const e = t.closest('[data-exp-switch]'); if (e) { setExp(e.dataset.expSwitch); return; }
  const a = t.closest('[data-about]'); if (a) { evt.preventDefault(); openAbout(a.dataset.about); }
});
// Hovering a tipping element's name highlights its box on the map.
panel.addEventListener('mouseover', (evt) => {
  const p = evt.target.closest('[data-place]');
  const id = p ? p.dataset.place : null;
  if (id !== state.hover) { state.hover = id; drawMap(); }
});
panel.addEventListener('mouseleave', () => { if (state.hover) { state.hover = null; drawMap(); } });

// ---------- controls, about, URL ----------

function syncURL() {
  const q = new URLSearchParams({ exp: state.exp, var: state.variable });
  if (state.place) q.set('place', state.place);
  history.replaceState(null, '', `?${q}`);
}
function syncButtons() {
  for (const b of document.querySelectorAll('[data-exp]')) b.setAttribute('aria-pressed', b.dataset.exp === state.exp);
  for (const b of document.querySelectorAll('[data-var]')) b.setAttribute('aria-pressed', b.dataset.var === state.variable);
}
function refresh() { syncButtons(); syncURL(); drawLegend(); if (MAPS) { drawBase(); drawMap(); } renderPanel(); }
function setExp(e) { state.exp = e; refresh(); }

for (const b of document.querySelectorAll('[data-exp]')) b.addEventListener('click', () => setExp(b.dataset.exp));
for (const b of document.querySelectorAll('[data-var]')) b.addEventListener('click', () => { state.variable = b.dataset.var; refresh(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.place && !about.open) select(null); });

// The site header hides until you scroll up or move the pointer to the top of the window.
const header = document.getElementById('siteheader');
let lastY = window.scrollY;
const showHeader = (on) => header.classList.toggle('shown', on);
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y < lastY - 4) showHeader(true); else if (y > lastY + 4) showHeader(false);
  lastY = y;
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (e.clientY < 24) showHeader(true);
  else if (e.clientY > header.offsetHeight + 24) showHeader(false);
});

const about = document.getElementById('about');
function openAbout(sectionId) {
  about.showModal();
  const target = sectionId && document.getElementById(sectionId);
  about.querySelector('.about-body').parentElement.scrollTop = 0;
  if (target) target.scrollIntoView({ block: 'start' });
}
document.getElementById('aboutbtn').addEventListener('click', () => openAbout());
if (location.hash.startsWith('#a-')) openAbout(location.hash.slice(1)); // e.g. index.html#a-sources
document.getElementById('aboutclose').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); }); // click on the backdrop

const load = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });
load('data/tipping.json')
  .then((tip) => { TIP = tip; if (!TIP.metrics.some((m) => m.id === state.place)) state.place = null; refresh(); })
  .catch((err) => { panel.textContent = `Could not load the tipping data (${err.message}).`; });
load('data/maps.json')
  .then((maps) => { MAPS = maps; buildGrid(); resize(); })
  .catch((err) => { document.getElementById('readout').textContent = `Could not load the map data (${err.message}).`; });
refresh();
