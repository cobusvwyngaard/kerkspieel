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

const state = { data: null, map: null, layer: null };

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
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, attribution: "&copy; OpenStreetMap",
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

function encoder(question) {
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
  const options = [...question.options].sort((a, b) => a.rank - b.rank);
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

  const enc = encoder(question);
  renderLegend(question, enc);

  state.layer.clearLayers();
  let shown = 0, answered = 0;
  const bounds = [];
  state.data.congregations.forEach((c, i) => {
    if (synod !== ALL_SYNODS && c.synod !== synod) return;
    shown += 1;
    const value = column[i];
    const has = value !== null && value !== undefined;
    if (has) answered += 1;
    bounds.push([c.lat, c.lon]);
    L.circleMarker([c.lat, c.lon], {
      radius: has ? enc.radius(value) : 3.5,
      fillColor: has ? enc.colour(value) : NO_ANSWER,
      fillOpacity: has ? 0.85 : 0.45,
      color: "var(--surface-1)", weight: has ? 1.5 : 0.5,
    }).bindPopup(
      `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.ring || "—")} · ${escapeHtml(c.synod)}` +
      `<br>${has ? escapeHtml(enc.describe(value)) : "<i>geen antwoord</i>"}`
    ).addTo(state.layer);
  });

  fitToPoints(bounds);
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
    target.innerHTML = [min, p50, p95].map((v) =>
      `<span class="legend-item"><i class="legend-dot" style="background:${NUMERIC_COLOUR};` +
      `width:${2 * enc.radius(v)}px;height:${2 * enc.radius(v)}px"></i>${v}</span>`).join("") +
      `<span class="legend-item">Groter kring = groter getal. ` +
      `Bo ${p95} bly die kring dieselfde grootte.</span>`;
    return;
  }
  target.innerHTML = enc.options.map((o, i) =>
    `<span class="legend-item"><i class="legend-dot" style="background:${enc.palette[i]};` +
    `width:13px;height:13px"></i>${escapeHtml(o.label || `Opsie ${o.value}`)}</span>`).join("") +
    `<span class="legend-item"><i class="legend-dot" style="background:${NO_ANSWER};` +
    `width:8px;height:8px"></i>geen antwoord</span>`;
}

boot();
