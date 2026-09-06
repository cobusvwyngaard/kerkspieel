/* Kerkspieël Ringsverslag — reads the pre-aggregated dataset and renders a
   ring's answers against its synod and the church as a whole.

   The published data holds counts per ring, per synod and nationally, never
   a congregation's own answers. */

const WAVES = ["2018", "2022", "2026"];
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const NATIONAL = "__all__";
// Below this, a single congregation moves the share by 10 points or more.
const SMALL_N = 10;

const el = (id) => document.getElementById(id);
const state = { scopes: [], byKey: new Map(), questions: [], counts: {} };

async function boot() {
  const payload = await fetch("data/aggregates.json").then((r) => r.json());
  state.scopes = payload.scopes;
  state.byKey = new Map(payload.scopes.map((s) => [s.key, s]));
  state.questions = payload.questions;
  state.counts = payload.counts;

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
  el("synod").innerHTML = synodScopes()
    .sort((a, b) => a.name.localeCompare(b.name, "af"))
    .map((s) => `<option value="${s.key}">${escapeHtml(s.name)}</option>`).join("");
}

function fillQuestions() {
  const usable = [...state.questions]
    // Questions asked the same way in every wave come first; the ones whose
    // scale moved are still offered, but behind a warning.
    .sort((a, b) => (a.comparable === b.comparable ? 0
                     : a.comparable === "yes" ? -1 : 1));
  el("question").innerHTML = usable
    .map((q) => `<option value="${q.id}">${escapeHtml(trim(q.label, 110))}` +
                `${q.comparable === "scale-changed" ? " ⚠" : ""}</option>`).join("");
  const opener = usable.find((q) => /huidige rigting/i.test(q.label));
  if (opener) el("question").value = opener.id;
}

function onSynodChange() {
  const synod = state.byKey.get(el("synod").value);
  el("ring").innerHTML = [`<option value="${synod.key}">Hele sinode</option>`]
    .concat(ringScopes(synod.name)
      .sort((a, b) => a.name.localeCompare(b.name, "af"))
      .map((r) => `<option value="${r.key}">${escapeHtml(r.name)}</option>`))
    .join("");
  render();
}

/* ---------- selection ---------- */

function scopes() {
  const synod = state.byKey.get(el("synod").value);
  const chosen = state.byKey.get(el("ring").value) || synod;
  const national = state.byKey.get(NATIONAL);
  const all = [
    { scope: chosen, label: `Ring ${chosen.name}`, short: "Ring" },
    { scope: synod, label: `Sinode ${synod.name}`, short: "Sinode" },
    { scope: national, label: national.name, short: "AS" },
  ];
  // Choosing the whole synod makes the ring scope the synod scope; showing
  // both would just repeat every column.
  return chosen.key === synod.key ? all.slice(1) : all;
}

function distribution(question, scope, wave) {
  const counts = (state.counts[question.id] || {})[scope.key];
  const bucket = counts && counts[wave];
  if (!bucket) return null;
  const n = bucket.reduce((a, b) => a + b, 0);
  if (!n) return null;
  return { n, share: bucket.map((c) => (100 * c) / n) };
}

function orderedOptions(question) {
  // The published report orders options worst-first; the raw codes of
  // several questions run the other way.
  const order = question.order || {};
  return question.options
    .map((o, index) => ({ ...o, index, rank: order[o.value] ?? o.value }))
    .sort((a, b) => a.rank - b.rank);
}

/* ---------- render ---------- */

function render() {
  const question = state.questions.find((q) => q.id === el("question").value);
  const scopeList = scopes();
  const primary = scopeList[0];

  renderTiles(primary.scope);
  if (!question) return;

  el("chart-title").textContent = trim(question.label, 150);
  el("chart-sub").textContent = primary.label;

  el("note-slot").innerHTML = question.comparable === "scale-changed"
    ? `<p class="note"><strong>Skale verskil tussen jare.</strong> Hierdie vraag
       is nie in elke jaar met dieselfde aantal antwoordopsies gevra nie
       (${WAVES.filter((w) => question.optionCounts[w])
              .map((w) => `${w}: ${question.optionCounts[w]}`).join(", ")}),
       so die jare is nie direk vergelykbaar nie.</p>`
    : "";

  const options = orderedOptions(question);
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
  const max = niceMax(Math.max(20, ...series.flatMap((s) => s.data.share)));
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

  const bars = options.map((opt, oi) => {
    const x0 = pad.left + oi * groupW + 9;
    return series.map((s, si) => {
      const v = s.data.share[opt.index];
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * plotH);
      const x = x0 + si * (barW + gap);
      const name = opt.label || `Opsie ${opt.value}`;
      return `<rect class="bar" x="${x}" y="${y(v)}" width="${barW}" height="${h}"
        fill="${SERIES[si]}" tabindex="0" role="img"
        aria-label="${escapeHtml(name)}, ${s.wave}: ${v.toFixed(1)} persent"
        data-tip="${escapeHtml(`${s.wave} · ${name}: ${v.toFixed(1)}% (n=${s.data.n})`)}"></rect>`;
    }).join("");
  }).join("");

  const labels = options.map((opt, oi) => {
    const cx = pad.left + oi * groupW + groupW / 2;
    return wrap(opt.label || `Opsie ${opt.value}`, Math.floor(groupW / 6), 3)
      .map((line, li) =>
        `<text x="${cx}" y="${height - pad.bottom + 16 + li * 13}"
               text-anchor="middle">${escapeHtml(line)}</text>`).join("");
  }).join("");

  el("chart").innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
          role="img" aria-label="Verspreiding van antwoorde per jaar">
       ${gridlines}${bars}${labels}
     </svg>`;
  attachTooltips();
}

function renderTable(question, options, scopeList) {
  const cols = [];
  scopeList.forEach((sc) => WAVES.forEach((wave) => {
    const d = distribution(question, sc.scope, wave);
    if (d) cols.push({ head: `${sc.short} ${wave}`, d });
  }));
  if (!cols.length) { el("table").innerHTML = ""; return; }

  const head = `<thead><tr><th>Beskrywing</th>${
    cols.map((c) => `<th>${escapeHtml(c.head)}</th>`).join("")}</tr></thead>`;
  const body = options.map((opt) => `<tr>
      <td>${escapeHtml(opt.label || `Opsie ${opt.value}`)}</td>
      ${cols.map((c) => `<td>${c.d.share[opt.index].toFixed(2)}%</td>`).join("")}
    </tr>`).join("");
  const foot = `<tr><td>Aantal gemeentes</td>${
    cols.map((c) => `<td>${c.d.n}</td>`).join("")}</tr>`;
  el("table").innerHTML = `${head}<tbody>${body}${foot}</tbody>`;
}

function renderFooter(question) {
  const codes = WAVES.filter((w) => question.codes[w])
    .map((w) => `${w}: ${question.codes[w]}`).join(" · ");
  el("footer").textContent =
    `Veranderlike ${codes}. Kodes word elke opname hernommer, so 'n kode geld net saam met sy jaar.`;
}

/* ---------- helpers ---------- */

function attachTooltips() {
  const tip = el("tooltip");
  const show = (e) => {
    const t = e.target.dataset.tip;
    if (!t) return;
    const box = e.target.getBoundingClientRect();
    tip.textContent = t;
    tip.style.opacity = "1";
    tip.style.left = `${Math.min(box.left, window.innerWidth - 240)}px`;
    tip.style.top = `${box.top - 34}px`;
  };
  const hide = () => { tip.style.opacity = "0"; };
  el("chart").querySelectorAll("[data-tip]").forEach((node) => {
    node.addEventListener("mouseenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("mouseleave", hide);
    node.addEventListener("blur", hide);
  });
}

function wrap(text, perLine, maxLines) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if ((line + " " + word).trim().length > perLine && line) {
      out.push(line);
      line = word;
      if (out.length === maxLines - 1 && out.length) break;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) out.push(line);
  return out.slice(0, maxLines);
}

function niceMax(value) {
  // Round the axis up to something a reader can divide into quarters.
  for (const candidate of [20, 25, 40, 50, 60, 75, 80, 100]) {
    if (value <= candidate) return candidate;
  }
  return 100;
}

const round1 = (v) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, "");
const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

boot();
