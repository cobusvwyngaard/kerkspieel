/* The map report: one pin per congregation, coloured or sized by that
   congregation's own answer to the chosen question. */

// Two-option questions get two categorical hues; an ordered scale gets a
// single hue running light to dark, so "more" reads darker rather than
// asking the reader to learn an arbitrary colour order.
const BINARY_COLOURS = ["var(--series-1)", "var(--series-2)"];
const ORDINAL_RAMP = ["#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c", "#08306b"];
const NUMERIC_COLOUR = "#3182bd";
const NO_ANSWER = "#9a9a95";
const ALL_SYNODS = "__all__";
const SA_VIEW = [[-35.2, 15.5], [-21.5, 33.5]];

const state = { data: null, map: null, layer: null, pins: [], legend: [] };

async function boot() {
  try {
    state.data = await loadJSON("map.json");
  } catch (e) {
    failed(e.message);
    return;
  }
  fillQuestions();
  fillWaves();
  fillSynods();
  ["question", "wave", "synod"].forEach((id) =>
    el(id).addEventListener("change", id === "question" ? onQuestionChange : render));
  initMap();
  render();
}

function initMap() {
  state.map = L.map("map", { scrollWheelZoom: true }).fitBounds(SA_VIEW);
  L.tileLayer(TILE_URL, {
    maxZoom: 17, attribution: "&copy; OpenStreetMap",
    // Every tile is fetched as a CORS request, including the ones the map
    // itself draws, so the export can read them back off a canvas. Without
    // this the browser may serve the export a cached CORS-less copy and the
    // canvas is tainted.
    crossOrigin: "anonymous",
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
}

const KIND_LABEL = { binary: "Ja/Nee", ordinal: "Skaal", numeric: "Getal" };

function fillQuestions() {
  // Grouped by how they draw, because that is what decides whether the
  // reader is looking at colours or at pin sizes.
  const groups = { binary: [], ordinal: [], numeric: [] };
  state.data.questions.forEach((q) => groups[q.kind].push(q));
  el("question").innerHTML = Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([kind, list]) =>
      `<optgroup label="${KIND_LABEL[kind]} (${list.length})">` +
      list.map((q) => `<option value="${q.id}">${escapeHtml(trim(q.label, 95))}</option>`).join("") +
      `</optgroup>`).join("");
}

function current() {
  return state.data.questions.find((q) => q.id === el("question").value);
}

function fillWaves() {
  const q = current();
  const have = state.data.waves.filter((w) => (state.data.values[q.id] || {})[w]);
  const keep = el("wave").value;
  el("wave").innerHTML = have.map((w) =>
    `<option value="${w}">${w}</option>`).join("");
  if (have.includes(keep)) el("wave").value = keep;
}

function fillSynods() {
  const synods = [...new Set(state.data.congregations.map((c) => c.synod))].sort();
  el("synod").innerHTML = `<option value="${ALL_SYNODS}">Almal</option>` +
    synods.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join("");
}

function onQuestionChange() {
  fillWaves();
  render();
}

/* ---------- encoding ---------- */

function ordinalRamp(count) {
  // Spread the ramp's steps evenly, so a three-point scale uses light,
  // middle and dark rather than only its pale end.
  if (count >= ORDINAL_RAMP.length) return ORDINAL_RAMP.slice(0, count);
  const step = (ORDINAL_RAMP.length - 1) / (count - 1 || 1);
  return Array.from({ length: count }, (_, i) => ORDINAL_RAMP[Math.round(i * step)]);
}

function encoder(question, wave) {
  if (question.kind === "numeric") {
    const { min, p95 } = question.scale;
    const span = Math.max(1, p95 - min);
    return {
      // Area, not radius, carries magnitude, and the p95 cap stops one very
      // large congregation shrinking everything else to a dot.
      radius: (v) => 4 + 9 * Math.sqrt(Math.min(1, Math.max(0, (v - min) / span))),
      colour: () => NUMERIC_COLOUR,
      describe: (v) => String(v),
    };
  }
  // Each wave has its own scale; a value only means something inside its
  // own year's option list.
  const options = [...(question.options[wave] || [])].sort((a, b) => a.rank - b.rank);
  const palette = question.kind === "binary" ? BINARY_COLOURS : ordinalRamp(options.length);
  const slot = new Map(options.map((o, i) => [o.value, i]));
  const name = new Map(options.map((o) => [o.value, o.label || `Opsie ${o.value}`]));
  return {
    radius: () => 6,
    colour: (v) => palette[slot.get(v)] ?? NO_ANSWER,
    describe: (v) => name.get(v) ?? "—",
    options, palette,
  };
}

/* ---------- render ---------- */

function render() {
  const question = current();
  const wave = el("wave").value;
  const synod = el("synod").value;
  const column = (state.data.values[question.id] || {})[wave];

  el("map-title").textContent = trim(question.label, 150);
  el("map-sub").textContent =
    `${wave} · ${KIND_LABEL[question.kind]}` +
    (synod === ALL_SYNODS ? "" : ` · ${synod}`);
  el("footer").textContent = "Veranderlike " + state.data.waves
    .filter((w) => question.codes[w]).map((w) => `${w}: ${question.codes[w]}`).join(" · ") +
    ". Kodes word elke opname hernommer, so 'n kode geld net saam met sy jaar.";

  if (!column) {
    el("legend").innerHTML = "";
    state.layer.clearLayers();
    el("map-meta").textContent = "Hierdie vraag is nie in hierdie jaar gevra nie.";
    return;
  }

  const enc = encoder(question, wave);
  renderLegend(question, enc);

  state.layer.clearLayers();
  state.pins = [];
  let shown = 0, answered = 0;
  const bounds = [];
  state.data.congregations.forEach((c, i) => {
    if (synod !== ALL_SYNODS && c.synod !== synod) return;
    shown += 1;
    const value = column[i];
    const has = value !== null && value !== undefined;
    if (has) answered += 1;
    bounds.push([c.lat, c.lon]);
    const pin = {
      lat: c.lat, lon: c.lon,
      radius: has ? enc.radius(value) : 3.5,
      fillColor: has ? enc.colour(value) : NO_ANSWER,
      fillOpacity: has ? 0.85 : 0.45,
      color: "var(--surface-1)", weight: has ? 1.5 : 0.5,
    };
    state.pins.push(pin);
    L.circleMarker([c.lat, c.lon], pin).bindPopup(
      `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.ring || "—")} · ${escapeHtml(c.synod)}` +
      `<br>${has ? escapeHtml(enc.describe(value)) : "<i>geen antwoord</i>"}`
    ).addTo(state.layer);
  });

  fitToPoints(bounds);
  addMapExport();
  el("map-meta").textContent =
    `${answered} van ${shown} gemeentes op die kaart het hierdie vraag in ${wave} beantwoord. ` +
    `Gemeentes sonder 'n antwoord is klein en grys. ` +
    `196 gemeentes het nog geen koördinate nie en verskyn glad nie.`;
}

/** Frame the bulk of the points, not the strays.
 *
 * A handful of dissolved congregations sit in Zimbabwe and Malawi. Fitting
 * to the full extent squeezes South Africa, where all but a few
 * congregations are, into a corner -- so frame the middle 98% and let the
 * outliers fall outside the initial view.
 */
function fitToPoints(points) {
  if (!points.length) return;
  if (points.length < 8) {
    state.map.fitBounds(points, { padding: [30, 30], maxZoom: 11 });
    return;
  }
  const at = (values, q) => values[Math.min(values.length - 1,
    Math.max(0, Math.round(q * (values.length - 1))))];
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lons = points.map((p) => p[1]).sort((a, b) => a - b);
  state.map.fitBounds(
    [[at(lats, 0.01), at(lons, 0.01)], [at(lats, 0.99), at(lons, 0.99)]],
    { padding: [26, 26], maxZoom: 11 });
}

function renderLegend(question, enc) {
  const target = el("legend");
  if (question.kind === "numeric") {
    const { min, p50, p95 } = question.scale;
    state.legend = [min, p50, p95].map((v) =>
      ({ colour: NUMERIC_COLOUR, size: 2 * enc.radius(v), label: String(v) }));
    state.legend.push({ label: `Groter kring = groter getal. ` +
      `Bo ${p95} bly die kring dieselfde grootte.` });
  } else {
    state.legend = enc.options.map((o, i) =>
      ({ colour: enc.palette[i], size: 13, label: o.label || `Opsie ${o.value}` }));
    state.legend.push({ colour: NO_ANSWER, size: 8, label: "geen antwoord" });
  }
  target.innerHTML = state.legend.map((item) => `<span class="legend-item">` +
    (item.colour ? `<i class="legend-dot" style="background:${item.colour};` +
      `width:${item.size}px;height:${item.size}px"></i>` : "") +
    `${escapeHtml(item.label)}</span>`).join("");
}

/* ---------- PowerPoint export ----------
   The map is a picture rather than a chart, so it exports as one: the
   basemap tiles and the pins are drawn onto a canvas at exactly the
   framing on screen. The legend is rebuilt out of PowerPoint shapes and
   text instead of being baked into the image, so the recipient can
   restyle it, and the title, subtitle and source match the chart
   exports. */

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE = 256;
// One zoom level deeper doubles the linear resolution, which is the
// difference between a legible slide and a blurred one, but it also
// quadruples the tile count. Take the deeper level only where it stays
// within a request count that is polite to a free tile service.
const MAX_TILES = 90;
const BASEMAP_FALLBACK = "#e9e5df";
const ATTRIBUTION = "Kaartagtergrond © OpenStreetMap-bydraers";

function addMapExport() {
  const panel = el("map").closest(".panel");
  if (!panel || panel.querySelector(".export-pptx") || typeof PptxGenJS === "undefined") return;
  const button = document.createElement("button");
  button.className = "export-pptx";
  button.type = "button";
  button.textContent = "Stoor as PowerPoint";
  button.addEventListener("click", () => withBusyButton(button, exportMap));
  panel.querySelector("h2").insertAdjacentElement("afterend", button);
}

/** Which tiles the current view needs at a given zoom, and where each sits. */
function tileGrid(zoom) {
  const map = state.map;
  const size = map.getSize();
  const scale = Math.pow(2, zoom - map.getZoom());
  const width = Math.round(size.x * scale);
  const height = Math.round(size.y * scale);
  const origin = map.project(map.getCenter(), zoom)
    .subtract(L.point(width / 2, height / 2));
  const span = Math.pow(2, zoom);
  const tiles = [];
  for (let x = Math.floor(origin.x / TILE); x * TILE < origin.x + width; x += 1) {
    for (let y = Math.floor(origin.y / TILE); y * TILE < origin.y + height; y += 1) {
      if (y < 0 || y >= span) continue;   // above the pole or below it
      tiles.push({ x: ((x % span) + span) % span, y,
                   left: x * TILE - origin.x, top: y * TILE - origin.y });
    }
  }
  return { zoom, width, height, origin, tiles };
}

function exportGrid() {
  const shallow = tileGrid(Math.round(state.map.getZoom()));
  const deep = tileGrid(Math.min(shallow.zoom + 1, state.map.getMaxZoom()));
  return deep.tiles.length <= MAX_TILES ? deep : shallow;
}

// A tile server that answers slowly must not leave the button stuck on
// "Besig..." for ever; past this the export goes ahead without that tile.
const TILE_TIMEOUT = 8000;

/** A tile as an image the canvas is allowed to read back. */
const loadTile = (zoom, t) => new Promise((resolve) => {
  const img = new Image();
  const timer = setTimeout(() => resolve(null), TILE_TIMEOUT);
  const done = (value) => { clearTimeout(timer); resolve(value); };
  img.crossOrigin = "anonymous";
  img.onload = () => done(img);
  img.onerror = () => done(null);   // one missing tile must not fail the export
  img.src = TILE_URL.replace("{z}", zoom).replace("{x}", t.x).replace("{y}", t.y);
});

async function mapCanvas() {
  const grid = exportGrid();
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BASEMAP_FALLBACK;
  ctx.fillRect(0, 0, grid.width, grid.height);

  const images = await Promise.all(grid.tiles.map((t) => loadTile(grid.zoom, t)));
  images.forEach((img, i) => {
    if (img) ctx.drawImage(img, grid.tiles[i].left, grid.tiles[i].top, TILE, TILE);
  });

  // The pins are the ones render() actually drew, so the slide cannot drift
  // from the screen.
  const scale = grid.width / state.map.getSize().x;
  const stroke = `#${resolveColour("var(--surface-1)")}`;
  state.pins.forEach((pin) => {
    const p = state.map.project([pin.lat, pin.lon], grid.zoom).subtract(grid.origin);
    ctx.beginPath();
    ctx.arc(p.x, p.y, pin.radius * scale, 0, 2 * Math.PI);
    ctx.globalAlpha = pin.fillOpacity;
    ctx.fillStyle = `#${resolveColour(pin.fillColor)}`;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = pin.weight * scale;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  });

  drawAttribution(ctx, grid, scale);
  return canvas;
}

/** OpenStreetMap's licence asks for the credit to travel with the image. */
function drawAttribution(ctx, grid, scale) {
  const size = Math.round(11 * scale);
  ctx.font = `${size}px system-ui, sans-serif`;
  const text = ATTRIBUTION;
  const w = ctx.measureText(text).width + size;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(grid.width - w, grid.height - size * 2, w, size * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#3f3e3b";
  ctx.textBaseline = "middle";
  ctx.fillText(text, grid.width - w + size / 2, grid.height - size);
}

/** The legend as shapes and text, laid out in rows across the slide. */
function addLegendShapes(pptx, slide, y) {
  const CHAR = 0.072;          // inches per character at 10pt, near enough
  const ROW = 0.26;
  const MAX_ROWS = 3;
  let x = 0.5, row = 0;
  for (const item of state.legend) {
    const label = trim(item.label, 60);
    const dot = item.colour ? Math.max(0.08, Math.min(0.2, (item.size || 13) / 72)) : 0;
    const w = dot + 0.08 + label.length * CHAR;
    if (x + w > 9.5 && x > 0.5) { x = 0.5; row += 1; }
    if (row >= MAX_ROWS) break;
    const mid = y + row * ROW;
    if (item.colour) {
      slide.addShape(pptx.ShapeType.ellipse, {
        x, y: mid + (ROW - dot) / 2 - 0.03, w: dot, h: dot,
        fill: { color: resolveColour(item.colour) }, line: { width: 0 },
      });
    }
    slide.addText(label, {
      x: x + dot + 0.06, y: mid, w: w - dot, h: ROW,
      fontSize: 10, color: "52514E", valign: "middle",
    });
    x += w + 0.12;
  }
  return row + 1;
}

async function exportMap() {
  const question = current();
  const title = trim(question.label, 150);
  const subtitle = el("map-sub").textContent.trim();
  const { pptx, slide } = newDeck(title, subtitle);

  const rows = addLegendShapes(pptx, slide, 1.5);
  const canvas = await mapCanvas();

  const top = 1.5 + rows * 0.26 + 0.08;
  const available = 4.95 - top;
  const aspect = canvas.width / canvas.height;
  let w = 9, h = w / aspect;
  if (h > available) { h = available; w = h * aspect; }
  slide.addImage({ data: canvas.toDataURL("image/png"),
                   x: (10 - w) / 2, y: top, w, h });

  const codes = state.data.waves.filter((wave) => question.codes[wave])
    .map((wave) => `${wave}: ${question.codes[wave]}`).join(" · ");
  await saveDeck(pptx, slide,
    `Bron: Gemeentevraelys, veranderlike ${codes}. ${ATTRIBUTION}.`,
    `kaart-${question.id}-${el("wave").value}`);
}

boot();
