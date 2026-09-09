/* Kerkspieël Ringsverslag — reads the pre-aggregated dataset and renders a
   ring's answers against its synod and the church as a whole.

   The published data holds counts per ring, per synod and nationally, never
   a congregation's own answers. */

const WAVES = ["2018", "2022", "2026"];
// Below this, a single congregation moves the share by 10 points or more.
const SMALL_N = 10;
const ALL_SYNODS = "__all_synods__";
const state = { scopes: [], byKey: new Map(), questions: [], counts: {},
                numeric: [], numericStats: null };

async function boot() {
  const payload = await fetch("data/aggregates.json").then((r) => r.json());
  state.scopes = payload.scopes;
  state.byKey = new Map(payload.scopes.map((s) => [s.key, s]));
  state.questions = payload.questions;
  state.counts = payload.counts;
  state.numeric = payload.numericQuestions || [];

  fillSynods();
  fillQuestions();
  ["synod", "ring", "question"].forEach((id) =>
    el(id).addEventListener("change", id === "synod" ? onSynodChange : render));
  onSynodChange();
}

const synodScopes = () => state.scopes.filter((s) => s.kind === "synod");
const ringScopes = (synod) =>
  state.scopes.filter((s) => s.kind === "ring" && s.synod === synod);

function fillSynods() {
  // "Algemene Sinode" selects the whole church rather than one synod.
  el("synod").innerHTML =
    `<option value="${ALL_SYNODS}">Algemene Sinode (almal)</option>` +
    synodScopes()
      .sort((a, b) => a.name.localeCompare(b.name, "af"))
      .map((s) => `<option value="${s.key}">${escapeHtml(s.name)}</option>`).join("");
}

// The questions the two published reports put on their slides: the four in
// the Power BI Ringsverslag, then the three the Skuiwe in die Kerk deck adds.
// Matched on wording rather than on question id, because the ids are
// regenerated whenever the crosswalk is rebuilt and a stale id would
// silently point at a different question.
const RECOMMENDED = [
  /huidige rigting tipeer/i,
  /finansiële posisie/i,
  /missionale gemeente wat sy bestaan/i,
  /betrokkenheid by gemeenskapsorganisasies/i,
  /^Belydende Lidmate$/i,
  /Betaalde persone vir andertalige of kruiskulturele/i,
  /^Oorweeg vir voortbestaan: diensleraar$/i,
];

/** Every question the page can draw, counted ones included. */
const allQuestions = () => state.questions.concat(state.numeric);

const isNumeric = (q) => q != null && !q.options;

function recommendedQuestions() {
  const found = [];
  for (const pattern of RECOMMENDED) {
    const hit = allQuestions().find((q) => pattern.test(q.label));
    if (hit && !found.includes(hit)) found.push(hit);
    // A question can be reworded when the crosswalk is rebuilt. Silence
    // would just drop it from the list; say so where a maintainer looks.
    else if (!hit) console.warn(`recommended question not found: ${pattern}`);
  }
  return found;
}

function option(q) {
  const mark = isNumeric(q) ? " №"
    : q.comparable === "scale-changed" ? " ⚠"
    : q.comparable === "single-wave" ? ` (${Object.keys(q.codes)[0]})` : "";
  return `<option value="${q.id}">${escapeHtml(trim(q.label, 110))}${mark}</option>`;
}

function fillQuestions() {
  const recommended = recommendedQuestions();
  const chosen = new Set(recommended.map((q) => q.id));
  const rest = state.questions
    .filter((q) => !chosen.has(q.id))
    // Questions asked the same way in every wave come first; the ones whose
    // scale moved, and the ones asked in only one wave, are still offered
    // but behind a warning.
    .sort((a, b) => rank(a) - rank(b));
  const counted = state.numeric.filter((q) => !chosen.has(q.id));
  el("question").innerHTML =
    (recommended.length
      ? `<optgroup label="Aanbevole vrae — uit die gepubliseerde verslae">` +
        recommended.map(option).join("") + `</optgroup>`
      : "") +
    `<optgroup label="Gekose antwoorde (${rest.length})">` +
    rest.map(option).join("") + `</optgroup>` +
    `<optgroup label="Getalle wat getel is (${counted.length})">` +
    counted.map(option).join("") + `</optgroup>`;
  const opener = recommended[0] || rest[0];
  if (opener) el("question").value = opener.id;
}

const rank = (q) => (q.comparable === "yes" ? 0
                     : q.comparable === "scale-changed" ? 1 : 2);

function onSynodChange() {
  const chosen = el("synod").value;
  const ring = el("ring");
  if (chosen === ALL_SYNODS) {
    // Every congregation is in scope, so there is no ring to narrow to.
    ring.innerHTML = `<option value="${NATIONAL}">Alle gemeentes</option>`;
    ring.disabled = true;
  } else {
    const synod = state.byKey.get(chosen);
    ring.disabled = false;
    ring.innerHTML = [`<option value="${synod.key}">Hele sinode</option>`]
      .concat(ringScopes(synod.name)
        .sort((a, b) => a.name.localeCompare(b.name, "af"))
        .map((r) => `<option value="${r.key}">${escapeHtml(r.name)}</option>`))
      .join("");
  }
  render();
}

/* ---------- selection ---------- */

function scopes() {
  const national = state.byKey.get(NATIONAL);
  if (el("synod").value === ALL_SYNODS) {
    return [{ scope: national, label: national.name, short: "AS" }];
  }
  const synod = state.byKey.get(el("synod").value);
  const chosen = state.byKey.get(el("ring").value) || synod;
  const all = [
    { scope: chosen, label: `Ring ${chosen.name}`, short: "Ring" },
    { scope: synod, label: `Sinode ${synod.name}`, short: "Sinode" },
    { scope: national, label: national.name, short: "AS" },
  ];
  // Choosing the whole synod makes the ring scope the synod scope; showing
  // both would just repeat every column.
  return chosen.key === synod.key ? all.slice(1) : all;
}

/** One wave's answers, keyed by option label rather than by position.
 *
 *  Each wave is counted against its own scale, because the scales move --
 *  2022 inserts "Gereeld" into grids that read "Altyd / Soms / Nooit"
 *  either side of it. Keying on the label is what lets the waves be drawn
 *  on one axis anyway: a wave that never offered an option simply has no
 *  bar there.
 */
function distribution(question, scope, wave) {
  const counts = (state.counts[question.id] || {})[scope.key];
  const bucket = counts && counts[wave];
  const options = (question.options || {})[wave];
  if (!bucket || !options) return null;
  const n = bucket.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const share = new Map();
  options.forEach((o, i) => share.set(o.label, (100 * bucket[i]) / n));
  return { n, share };
}

/** The labels a chart puts on its axis, in the questionnaire's order. */
const categoriesOf = (question) => question.categories || [];

/* ---------- render ---------- */

function render() {
  const question = allQuestions().find((q) => q.id === el("question").value);
  const scopeList = scopes();
  const primary = scopeList[0];

  renderTiles(primary.scope);
  if (!question) return;

  el("chart-title").textContent = trim(question.label, 150);
  el("chart-sub").textContent = primary.label;

  if (isNumeric(question)) { renderNumeric(question, scopeList); return; }

  el("note-slot").innerHTML =
    question.comparable === "scale-changed"
      ? `<p class="note"><strong>Skale verskil tussen jare.</strong> Hierdie vraag
         is nie in elke jaar met dieselfde aantal antwoordopsies gevra nie
         (${WAVES.filter((w) => question.optionCounts[w])
                .map((w) => `${w}: ${question.optionCounts[w]}`).join(", ")}).
         Elke jaar word teen sy eie skaal getel, en 'n jaar wat 'n opsie nie
         aangebied het nie, het geen staaf daar nie — maar die jare bly
         daarmee nie streng vergelykbaar nie.</p>`
      : question.comparable === "single-wave"
      ? `<p class="note"><strong>Net in ${Object.keys(question.codes).join(", ")} gevra.</strong>
         Daar is niks om oor tyd mee te vergelyk nie; wat wel vergelyk kan word
         is die ring teenoor sy sinode en die hele kerk in daardie jaar.</p>`
      : "";

  const options = categoriesOf(question);
  const series = WAVES
    .map((wave) => ({ wave, data: distribution(question, primary.scope, wave) }))
    .filter((s) => s.data);

  const thin = series.filter((s) => s.data.n < SMALL_N);
  if (thin.length) {
    el("note-slot").insertAdjacentHTML("beforeend",
      `<p class="note"><strong>Klein getalle.</strong> ${
        thin.map((s) => `${s.wave} (n=${s.data.n})`).join(", ")} — met so min
        gemeentes skuif elke antwoord die persentasie met
        ${round1(100 / Math.min(...thin.map((s) => s.data.n)))} persentasiepunte.
        Lees die getalle, nie die persentasies nie.</p>`);
  }

  renderLegend(series);
  renderChart(options, series);
  renderTable(question, options, scopeList);
  renderFooter(question);

  addExportButtons();
}

function renderTiles(scope) {
  const tiles = [`<div class="tile"><div class="k">Gemeentes</div>
     <div class="v">${scope.congregations}</div><div class="s">in hierdie keuse</div></div>`];
  WAVES.forEach((wave) => {
    const n = scope.responded[wave] || 0;
    const pct = scope.congregations ? Math.round((100 * n) / scope.congregations) : 0;
    tiles.push(`<div class="tile"><div class="k">${wave} deelname</div>
      <div class="v">${n}</div><div class="s">${pct}% van gemeentes</div></div>`);
  });
  el("tiles").innerHTML = tiles.join("");
}

function renderLegend(series) {
  el("legend").innerHTML = series.map((s, i) =>
    `<span><i class="swatch" style="background:${SERIES[i]}"></i>${s.wave} (n=${s.data.n})</span>`
  ).join("");
}

function renderChart(options, series) {
  if (!options.length || !series.length) {
    el("chart").innerHTML = `<p class="empty">Geen antwoorde vir hierdie keuse nie.</p>`;
    return;
  }
  const pad = { top: 12, right: 12, bottom: 64, left: 42 };
  const groupW = Math.max(96, Math.min(190, 700 / options.length));
  const width = pad.left + pad.right + groupW * options.length;
  const height = 300;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(20, ...series.flatMap((s) => [...s.data.share.values()])));
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const step = max / 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const gridlines = ticks.map((t) => `
    <line class="axis-line" x1="${pad.left}" x2="${width - pad.right}"
          y1="${y(t)}" y2="${y(t)}"></line>
    <text x="${pad.left - 7}" y="${y(t) + 4}" text-anchor="end">${round1(t)}%</text>`).join("");

  // 2px of surface between neighbouring bars keeps the groups legible.
  const gap = 2;
  const inner = groupW - 18;
  const barW = (inner - gap * (series.length - 1)) / series.length;

  const bars = options.map((name, oi) => {
    const x0 = pad.left + oi * groupW + 9;
    return series.map((s, si) => {
      const v = s.data.share.get(name);
      // A wave that never offered this option gets no bar, which is what a
      // changed scale looks like on the chart.
      if (v == null) return "";
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
      const x = x0 + si * (barW + gap);
      return `<rect class="bar" x="${x}" y="${y(v)}" width="${barW}" height="${h}"
        fill="${SERIES[si]}" tabindex="0" role="img"
        aria-label="${escapeHtml(name)}, ${s.wave}: ${v.toFixed(1)} persent"
        data-tip="${escapeHtml(`${s.wave} · ${name}: ${v.toFixed(1)}% (n=${s.data.n})`)}"></rect>`;
    }).join("");
  }).join("");

  const labels = options.map((name, oi) => {
    const cx = pad.left + oi * groupW + groupW / 2;
    return wrap(name, Math.floor(groupW / 6), 3)
      .map((line, li) =>
        `<text x="${cx}" y="${height - pad.bottom + 16 + li * 13}"
               text-anchor="middle">${escapeHtml(line)}</text>`).join("");
  }).join("");

  el("chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Verspreiding van antwoorde per jaar">
       ${gridlines}${bars}${labels}
     </svg>`;
  attachTooltips(el("chart"));
  // This page draws its own bars rather than using the shared helper, so it
  // has to record its chart itself for the PowerPoint export.
  registerChart(el("chart"), {
    type: "bar", unit: "%",
    categories: options,
    series: series.map((s, i) => ({
      name: s.wave, values: options.map((name) => s.data.share.get(name) ?? null),
      colour: SERIES[i % SERIES.length],
    })),
  });
}

function renderTable(question, options, scopeList) {
  el("table-sub").textContent =
    "Persentasie van gemeentes wat elke opsie gekies het, per vlak en per jaar.";
  const cols = [];
  scopeList.forEach((sc) => WAVES.forEach((wave) => {
    const d = distribution(question, sc.scope, wave);
    if (d) cols.push({ head: `${sc.short} ${wave}`, d });
  }));
  if (!cols.length) { el("table").innerHTML = ""; return; }

  const head = `<thead><tr><th>Beskrywing</th>${
    cols.map((c) => `<th>${escapeHtml(c.head)}</th>`).join("")}</tr></thead>`;
  const body = options.map((name) => `<tr>
      <td>${escapeHtml(name)}</td>
      ${cols.map((c) => {
        const v = c.d.share.get(name);
        return `<td>${v == null ? "—" : `${v.toFixed(2)}%`}</td>`;
      }).join("")}
    </tr>`).join("");
  const foot = `<tr><td>Aantal gemeentes</td>${
    cols.map((c) => `<td>${c.d.n}</td>`).join("")}</tr>`;
  el("table").innerHTML = `${head}<tbody>${body}${foot}</tbody>`;
}

/* ---------- counted questions ----------
   A count has no options to share out, so the comparison is a different
   one: how large the average congregation is here, against the synod and
   the church. Totals are in the table, where a ring's is not silently set
   next to the whole church's. */

async function renderNumeric(question, scopeList) {
  el("legend").innerHTML = "";
  el("note-slot").innerHTML = "";
  el("chart").innerHTML = `<p class="empty">Besig om die getalle te laai…</p>`;
  renderFooter(question);

  if (!state.numericStats) {
    try {
      state.numericStats = (await loadJSON("numeric.json")).stats;
    } catch (e) {
      el("chart").innerHTML = `<p class="empty">Kon nie die getalle laai nie.</p>`;
      return;
    }
  }
  // The selection can have moved while the file was in flight.
  if (el("question").value !== question.id) return;

  const stats = state.numericStats[question.id] || {};
  const at = (scope, wave) => (stats[scope.key] || {})[wave] || null;
  const waves = WAVES.filter((w) => scopeList.some((sc) => at(sc.scope, w)));
  if (!waves.length) {
    el("chart").innerHTML = `<p class="empty">Geen getalle vir hierdie keuse nie.</p>`;
    el("table").innerHTML = "";
    return;
  }

  const series = scopeList.map((sc) => ({
    name: sc.label,
    values: waves.map((w) => {
      const row = at(sc.scope, w);
      return row && row[0] ? Math.round((row[1] / row[0]) * 10) / 10 : null;
    }),
  }));
  el("note-slot").innerHTML =
    `<p class="note"><strong>Hierdie vraag tel iets; dit kies nie.</strong>
     Die grafiek wys die <em>gemiddeld per gemeente</em>, want 'n ring se
     totaal en die hele kerk se totaal is nie vergelykbaar nie. Die totale,
     die mediaan en hoeveel gemeentes geantwoord het staan in die tabel.</p>`;
  legend(el("legend"), series);
  groupedBars(el("chart"), waves.map(String), series, { unit: "", maxLines: 1 });

  el("table-sub").textContent =
    "Getalle per vlak en per jaar. Die mediaan is die middelste gemeente; " +
    "die gemiddeld is die totaal gedeel deur die gemeentes wat geantwoord het.";
  const rows = [
    ["Gemeentes wat geantwoord het", (r) => r[0]],
    ["Totaal", (r) => r[1].toLocaleString("af-ZA")],
    ["Gemiddeld per gemeente", (r) => (r[0] ? round1(r[1] / r[0]) : "—")],
    ["Mediaan", (r) => round1(r[2])],
  ];
  const cols = [];
  scopeList.forEach((sc) => waves.forEach((wave) => {
    const row = at(sc.scope, wave);
    if (row) cols.push({ head: `${sc.short} ${wave}`, row });
  }));
  el("table").innerHTML =
    `<thead><tr><th>Beskrywing</th>${cols.map((c) =>
      `<th>${escapeHtml(c.head)}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map(([name, read]) => `<tr><td>${name}</td>${
      cols.map((c) => `<td>${read(c.row)}</td>`).join("")}</tr>`).join("")}</tbody>`;

  addExportButtons();
}

function renderFooter(question) {
  const codes = WAVES.filter((w) => question.codes[w])
    .map((w) => `${w}: ${question.codes[w]}`).join(" · ");
  el("footer").textContent =
    `Veranderlike ${codes}. Kodes word elke opname hernommer, so 'n kode geld net saam met sy jaar.`;
}

/* ---------- helpers ---------- */




boot();
